import { transport, HttpError } from './transport';

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

/**
 * Internal helper: calls transport but returns null on 401 instead of throwing.
 * Other non-ok statuses still throw (HttpError).
 * Used only inside bootstrapAuth where a 401 on /api/auth/me is expected.
 */
async function meRequest(): Promise<AuthUser | null> {
  try {
    const data = await transport<{ user: AuthUser }>('/api/auth/me');
    return data.user;
  } catch (err) {
    if (err instanceof HttpError && err.status === 401) return null;
    throw err;
  }
}

export async function bootstrapAuth(): Promise<AuthUser | null> {
  const user = await meRequest();
  if (user !== null) return user;
  // 401 on initial me — unauthenticated; try Telegram SDK
  const app = await waitForTelegram();
  if (!app?.initData) return null;
  app.ready?.();
  app.expand?.();
  // Exchange signed initData for an HttpOnly session cookie
  await transport<unknown>('/api/auth/telegram', {
    method: 'POST',
    body: { initData: app.initData },
  }).catch((err: unknown) => {
    if (err instanceof HttpError) {
      throw new Error(`Telegram sign-in failed (HTTP ${err.status}). Close this Mini App and reopen it from the bot, then retry.`);
    }
    throw err;
  });
  // Confirm the HttpOnly cookie actually round-trips before starting private polling.
  const verified = await meRequest();
  if (verified === null) throw new Error('Telegram session could not be saved. Reopen this Mini App from the bot and retry.');
  return verified;
}

/**
 * Typed login helper for password / access-token sign-in.
 * Returns the authenticated user on success; throws Error on failure.
 * Does NOT feed 401 into global query cache (this is the auth bootstrap, not a polling query).
 */
export async function loginWithPassword(secret: string): Promise<AuthUser> {
  try {
    const data = await transport<{ user: AuthUser }>('/api/auth/login', {
      method: 'POST',
      body: { password: secret, token: secret },
    });
    return data.user;
  } catch (err) {
    if (err instanceof HttpError) {
      throw new Error(err.status === 401 ? 'Invalid password or access token.' : `Login failed (HTTP ${err.status}).`);
    }
    throw err;
  }
}
