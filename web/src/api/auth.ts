export type AuthUser = { id: string; role: string; name?: string };
type TelegramApp = { initData?: string; ready?: () => void; expand?: () => void };
type AuthWindow = Window & { Telegram?: { WebApp?: TelegramApp } };

// The SDK may arrive after React (or provide initData after its first read).
// Never interpret query parameters or initDataUnsafe as authenticated identity.
export async function waitForTelegram(timeoutMs = 4000): Promise<TelegramApp | undefined> {
  const deadline = Date.now() + timeoutMs;
  do {
    const app = (window as AuthWindow).Telegram?.WebApp;
    if (app?.initData) return app;
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  // Deadline reached: return whatever the SDK has (may be undefined / missing initData)
  return (window as AuthWindow).Telegram?.WebApp;
}

async function authRequest(path: string, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    return await fetch(path, { ...init, credentials: 'same-origin', signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export async function bootstrapAuth(): Promise<AuthUser | null> {
  const me = await authRequest('/api/auth/me');
  if (me.ok) return (await me.json()).user;
  if (me.status !== 401) throw new Error(`Session check failed (HTTP ${me.status}). Retry Telegram sign-in.`);
  const app = await waitForTelegram();
  if (!app?.initData) return null;
  app.ready?.();
  app.expand?.();
  const exchange = await authRequest('/api/auth/telegram', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initData: app.initData }),
  });
  if (!exchange.ok) throw new Error(`Telegram sign-in failed (HTTP ${exchange.status}). Close this Mini App and reopen it from the bot, then retry.`);
  // Confirm the HttpOnly cookie actually round-trips before starting private polling.
  const verified = await authRequest('/api/auth/me');
  if (!verified.ok) throw new Error('Telegram session could not be saved. Reopen this Mini App from the bot and retry.');
  return (await verified.json()).user;
}
