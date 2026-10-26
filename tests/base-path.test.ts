import { expect, it, vi, afterEach } from 'vitest';
import { requestOrigin } from '../src/lib/request-origin';
afterEach(() => vi.unstubAllEnvs());
it('prefixes raw application paths while preserving query strings', async () => {
  vi.stubEnv('NEXT_PUBLIC_BASE_PATH', '/maket');
  vi.resetModules();
  const { appPath } = await import('../src/lib/base-path');
  expect(appPath('/api/diagrams')).toBe('/maket/api/diagrams');
  expect(appPath('/solutions?diagram=d')).toBe('/maket/solutions?diagram=d');
});
it('uses the trusted proxy origin for HTTPS cookies and same-origin checks', () => {
  expect(
    requestOrigin({
      url: 'http://app:3000/maket/api/auth/login',
      headers: new Headers({ 'X-Forwarded-Host': 'example.com', 'X-Forwarded-Proto': 'https' }),
    }),
  ).toBe('https://example.com');
  expect(requestOrigin({ url: 'http://localhost:3000/api', headers: new Headers() })).toBe(
    'http://localhost:3000',
  );
  expect(() =>
    requestOrigin({
      url: 'http://app',
      headers: new Headers({ 'X-Forwarded-Proto': 'javascript' }),
    }),
  ).toThrow();
});
