import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';

// Generate once in the parent so every Next.js worker receives the same code.
const inviteCode = randomBytes(24).toString('base64url');
const startupId = randomBytes(16).toString('hex');
const child = spawn(
  process.execPath,
  process.argv.slice(2).length ? process.argv.slice(2) : ['server.js'],
  {
    stdio: 'inherit',
    env: { ...process.env, MAKET_INVITE_CODE: inviteCode, MAKET_STARTUP_ID: startupId },
  },
);
let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    stopping = true;
    child.kill(signal);
  });
}
child.on('error', (error) => {
  console.error('Application startup failed:', error.message);
  process.exit(1);
});
child.on('exit', (code, signal) => process.exit(code ?? (signal === 'SIGTERM' ? 143 : 1)));
const portIndex = process.argv.indexOf('--port');
const port = portIndex >= 0 ? process.argv[portIndex + 1] : process.env.PORT || '3000';
while (!stopping) {
  try {
    const response = await fetch(
      `http://127.0.0.1:${port}${process.env.APP_URL || ''}/api/health`,
      {
        signal: AbortSignal.timeout(2000),
        headers: { 'X-Maket-Startup': startupId },
      },
    );
    if (response.ok && response.headers.get('X-Maket-Startup') === startupId && !stopping) {
      console.info(`[maket invite] ${inviteCode}`);
      break;
    }
  } catch {
    // Next.js or the database is not ready yet. Never print a code for a failed startup.
  }
  await setTimeout(1000);
}
