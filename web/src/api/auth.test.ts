import { test, expect } from 'bun:test';
import { bootstrapAuth, waitForTelegram } from './auth';

const user = { id: 'test-owner', role: 'owner' };
function setup(app: unknown, responses: Response[]) {
  (globalThis as any).window = { Telegram: { WebApp: app } };
  const calls: { path: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (path: string, init: RequestInit) => {
    calls.push({ path, init });
    const response = responses.shift();
    if (!response) throw Error('Unexpected request');
    return response;
  }) as any;
  return calls;
}
const ok = () => Response.json({ user });
test('delayed SDK payload exchanges and confirms same-origin cookie', async () => {
  const app = { initData: '' };
  const calls = setup(app, [new Response('', { status: 401 }), ok(), ok()]);
  setTimeout(() => { app.initData = 'synthetic-client-payload'; }, 75);
  expect(await bootstrapAuth()).toEqual(user);
  expect(calls.map(c => c.path)).toEqual(['/api/auth/me', '/api/auth/telegram', '/api/auth/me']);
  expect(calls.every(c => c.init.credentials === 'same-origin')).toBe(true);
});
test('signed exchange failure is actionable, not silent password fallback', async () => {
  setup({ initData: 'invalid' }, [new Response('', { status: 401 }), new Response('', { status: 401 })]);
  await expect(bootstrapAuth()).rejects.toThrow('Close this Mini App');
});
test('missing SDK wait terminates', async () => {
  setup(undefined, []);
  expect(await waitForTelegram(60)).toBeUndefined();
});
test('ordinary browser remains unauthenticated', async () => {
  setup(undefined, [new Response('', { status: 401 })]);
  expect(await bootstrapAuth()).toBeNull();
});
test('existing session does not require Telegram SDK', async () => {
  const calls = setup(undefined, [ok()]);
  expect(await bootstrapAuth()).toEqual(user);
  expect(calls.length).toBe(1);
});
test('cookie not retained never opens private app', async () => {
  setup({ initData: 'synthetic-client-payload' }, [new Response('', { status: 401 }), ok(), new Response('', { status: 401 })]);
  await expect(bootstrapAuth()).rejects.toThrow('could not be saved');
});
