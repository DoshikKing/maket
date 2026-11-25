import { afterEach, expect, it, vi } from 'vitest';
import { api, ApiError } from '../src/lib/client';
afterEach(() => vi.unstubAllGlobals());
it('bounds a request that never responds without retrying the write', async () => {
  const fetch = vi.fn(
    (_url, options: RequestInit) =>
      new Promise((_resolve, reject) =>
        options.signal!.addEventListener('abort', () => reject(options.signal!.reason), {
          once: true,
        }),
      ),
  );
  vi.stubGlobal('fetch', fetch);
  await expect(api('diagrams/test', 'PUT', { document: {} }, { timeoutMs: 15 })).rejects.toThrow(
    'не ответил вовремя',
  );
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('keeps the deadline active while reading the response body', async () => {
  vi.stubGlobal(
    'fetch',
    async (_url: string, options: RequestInit) =>
      new Response(
        new ReadableStream({
          start(controller) {
            options.signal!.addEventListener(
              'abort',
              () => controller.error(options.signal!.reason),
              { once: true },
            );
          },
        }),
        { status: 200 },
      ),
  );
  await expect(api('diagrams/test', 'GET', undefined, { timeoutMs: 15 })).rejects.toThrow(
    'не ответил вовремя',
  );
});
it('preserves ordinary authorization errors and successful data', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(Response.json({ error: 'Нет доступа' }, { status: 403 }))
      .mockResolvedValueOnce(Response.json({ revision: 3 })),
  );
  await expect(api('diagrams/test')).rejects.toEqual(new ApiError(403, 'Нет доступа'));
  await expect(api('diagrams/test')).resolves.toEqual({ revision: 3 });
});
