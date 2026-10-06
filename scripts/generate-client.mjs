import 'dotenv/config';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
// Generation reads the datasource URL to parse the schema, but never connects.
// npm postinstall may run before .env exists. Keep this fallback in the child
// process only; application startup and migrations still require the real URL.
const result = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'generate'], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL || 'postgresql://localhost/maket' },
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
