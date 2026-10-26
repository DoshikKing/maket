import { expect, it } from 'vitest';
import { databaseConfig } from '../scripts/database-config.mjs';
it('builds a connection from individual fields without corrupting reserved password characters', () => {
  const password = 'p%20@ss:/?#[]$ and spaces';
  const config = databaseConfig({
    POSTGRES_HOST: 'db',
    POSTGRES_PORT: '5433',
    POSTGRES_USER: 'maket_user',
    POSTGRES_PASSWORD: password,
    POSTGRES_DB: 'maket_db',
    POSTGRES_SCHEMA: 'model_schema',
  });
  const url = new URL(config.connectionString);
  expect(url.hostname).toBe('db');
  expect(url.port).toBe('5433');
  expect(decodeURIComponent(url.password)).toBe(password);
  expect(url.username).toBe('maket_user');
  expect(url.pathname).toBe('/maket_db');
  expect(url.searchParams.get('options')).toBe('-c search_path=model_schema,public');
  expect(config.schema).toBe('model_schema');
  expect(() => databaseConfig({ POSTGRES_SCHEMA: 'public; DROP TABLE x' })).toThrow();
  expect(
    databaseConfig({ DATABASE_URL: 'postgresql://u:p@db:5432/maket?schema=legacy' }).schema,
  ).toBe('legacy');
});
