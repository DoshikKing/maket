import { expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

it('logs one invitation only after its own server is ready, rotates on restart and forwards shutdown', async () => {
  const listener = createServer();
  await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const port = (listener.address() as { port: number }).port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  const dir = await mkdtemp(join(tmpdir(), 'maket-start-'));
  const fake = join(dir, 'server.mjs');
  await writeFile(
    fake,
    `
    import { createServer } from 'node:http';
    let ready = false;
    createServer((req, res) => {
      if(req.url === '/ready') ready = true;
      if(req.url.startsWith('/check/')) return res.end(String(req.url.slice(7) === process.env.MAKET_INVITE_CODE));
      res.statusCode = ready ? 200 : 503;
      if(req.headers['x-maket-startup'] === process.env.MAKET_STARTUP_ID) res.setHeader('X-Maket-Startup', process.env.MAKET_STARTUP_ID);
      res.end('ready');
    }).listen(Number(process.env.PORT), '127.0.0.1', () => console.log('LISTENING'));
  `,
  );
  type ProcessRun = {
    child: ReturnType<typeof spawn>;
    exit: Promise<number | null>;
    output: () => string;
    codes: () => string[];
  };
  const runs: ProcessRun[] = [];
  function run(): ProcessRun {
    const child = spawn(process.execPath, ['scripts/start-app.mjs', fake], {
      cwd: process.cwd(),
      env: { ...process.env, PORT: String(port), MAKET_INVITE_CODE: 'do-not-reuse-this-code' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', () => {});
    const exit = new Promise<number | null>((resolve, reject) => {
      child.once('exit', resolve);
      child.once('error', reject);
    });
    const result = {
      child,
      exit,
      output: () => output,
      codes: () => [...output.matchAll(/\[maket invite\] ([A-Za-z0-9_-]{32})/g)].map((m) => m[1]),
    };
    runs.push(result);
    return result;
  }
  const base = `http://127.0.0.1:${port}`;
  try {
    const first = run();
    await expect.poll(first.output).toContain('LISTENING');
    expect(first.codes()).toHaveLength(0);
    await fetch(base + '/ready');
    await expect.poll(() => first.codes().length).toBe(1);
    const original = first.codes()[0];
    expect(await (await fetch(base + '/check/' + original)).text()).toBe('true');
    for (let i = 0; i < 3; i++) await fetch(base + '/api/health');
    expect(first.codes()).toHaveLength(1);
    // A healthy old server on this port must not make a failed second startup publish a code.
    const collision = run();
    expect(await collision.exit).not.toBe(0);
    expect(collision.codes()).toHaveLength(0);
    first.child.kill('SIGTERM');
    expect(await first.exit).toBe(143);
    const second = run();
    await expect.poll(second.output).toContain('LISTENING');
    await fetch(base + '/ready');
    await expect.poll(() => second.codes().length).toBe(1);
    expect(await (await fetch(base + '/check/' + original)).text()).toBe('false');
    expect(await (await fetch(base + '/check/' + second.codes()[0])).text()).toBe('true');
    expect(second.codes()).toHaveLength(1);
  } finally {
    for (const run of runs) {
      if (run.child.exitCode === null) run.child.kill('SIGTERM');
      await run.exit;
    }
    await rm(dir, { recursive: true, force: true });
  }
}, 15000);
