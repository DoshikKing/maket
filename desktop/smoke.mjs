import { fork } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { mkdtemp, rm, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
if (process.env.GITHUB_ACTIONS === 'true') {
  process.on('uncaughtExceptionMonitor', (error) => {
    const message = String(error?.stack ?? error)
      .replace(/%/g, '%25')
      .replace(/\r/g, '%0D')
      .replace(/\n/g, '%0A');
    console.error(`::error title=Desktop smoke::${message}`);
  });
}
const require = createRequire(import.meta.url),
  { startRuntime, portableDirectory, childEnvironment } = require('./runtime.cjs');
const version = require('./package.json').version;
const root = fileURLToPath(new URL('.', import.meta.url)),
  serverDir = path.join(root, '.build', 'server');
const dataDir = await mkdtemp(path.join(tmpdir(), 'maket desktop test-'));
let runtime;
const messages = [];
const log = (message) => messages.push(message);
const onFailure = (error) => {
  throw error;
};
async function api(route, method = 'GET', body) {
  const response = await fetch(`${runtime.origin}/api/${route}`, {
    method,
    headers: {
      'X-Maket-Desktop': runtime.token,
      Cookie: `maket_session=${runtime.sessionToken}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json();
  assert.ok(response.ok, `${route}: ${response.status} ${JSON.stringify(value)}`);
  return value;
}
try {
  assert.equal(
    portableDirectory({
      resourcesPath: '/apps/maket.app/Contents/Resources',
      executable: '/apps/maket.app/Contents/MacOS/maket',
      platform: 'darwin',
      env: {},
      portable: true,
    }),
    path.resolve('/apps'),
  );
  assert.equal(
    portableDirectory({
      resourcesPath: '/apps/resources',
      executable: '/apps/maket',
      env: {},
      portable: false,
    }),
    null,
  );
  assert.ok(!Object.hasOwn(childEnvironment(), 'DATABASE_URL'));
  assert.ok(!(await readdir(serverDir)).some((name) => /^\.env(?:\.|$)/.test(name)));
  // A running web deployment's environment must never select the desktop database.
  process.env.TZ = 'Asia/Tokyo'; // Database timestamps must stay UTC even on a non-UTC computer.
  const old = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgresql://invalid:invalid@127.0.0.1:1/do-not-use';
  runtime = await startRuntime({ dataDir, serverDir, version, log, onFailure });
  if (old === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = old;
  assert.equal((await fetch(`${runtime.origin}/api/model`)).status, 403);
  assert.equal((await fetch(`${runtime.origin}/library`)).status, 403);
  assert.equal(
    (
      await fetch(`${runtime.origin}/api/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
    ).status,
    401,
  );
  const model = await api('model');
  assert.equal(model.objects.length, 0);
  const object = await api('objects', 'POST', {
    name: 'Локальный объект',
    attributes: { department: 'ИТ' },
  });
  const diagram = await api('diagrams', 'POST', {
    name: 'Офлайн-диаграмма',
    notationIds: ['builtin', 'builtin-bpmn', 'builtin-uml'],
  });
  assert.ok(
    Math.abs(Date.now() - Date.parse(diagram.createdAt)) < 60000,
    'database timestamps must be UTC',
  );
  assert.equal(diagram.document.bindings.length, 3);
  const binding = diagram.document.bindings[0];
  await api(`diagrams/${diagram.id}/representations`, 'POST', {
    objectId: object.id,
    bindingId: binding.id,
    typeId: binding.document.nodeTypes[0].id,
    revision: diagram.revision,
    position: { x: 100, y: 100 },
  });
  const key = await api('mcp-keys', 'POST', {
    name: 'Local test',
    expiresAt: null,
    grants: [
      {
        workspaceId: model.id,
        capabilities: [
          'objects.search',
          'diagrams.export.json',
          'diagrams.export.drawio',
          'diagrams.export.png',
          'diagrams.export.jpeg',
          'diagrams.export.pdf',
          'diagrams.import.drawio',
        ],
      },
    ],
  });
  const found = await fetch(`${runtime.origin}/api/mcp`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key.secret}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'maket_search_objects',
        arguments: { workspaceId: model.id, query: 'ЛОКАЛЬНЫЙ' },
      },
    }),
  });
  const result = await found.json();
  assert.ok(
    JSON.parse(result.result.content[0].text).items.some((o) => o.id === object.id),
    'Unicode search must be case-insensitive',
  );
  for (const format of ['json', 'drawio', 'png', 'jpeg', 'pdf']) {
    const response = await fetch(`${runtime.origin}/api/mcp`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key.secret}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'maket_export_diagram',
          arguments: { workspaceId: model.id, diagramId: diagram.id, format },
        },
      }),
    });
    const exported = await response.json();
    assert.ok(!exported.result?.isError, JSON.stringify(exported));
    assert.ok(
      exported.result?.content.some((c) => c.type === 'resource'),
      JSON.stringify(exported),
    );
    if (format === 'drawio') {
      const file = exported.result.content.find((c) => c.type === 'resource').resource;
      const imported = await fetch(`${runtime.origin}/api/mcp`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key.secret}`,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: {
            name: 'maket_import_diagram',
            arguments: {
              workspaceId: model.id,
              format: 'drawio',
              filename: 'Desktop test.drawio',
              content: file.blob,
              encoding: 'base64',
            },
          },
        }),
      });
      const result = await imported.json();
      assert.ok(!result.result?.isError, JSON.stringify(result));
    }
  }
  const origin = runtime.origin;
  await runtime.stop();
  runtime = null;
  const settings = JSON.parse(await readFile(path.join(dataDir, 'desktop.json'), 'utf8'));
  settings.appVersion = '0.0.0';
  await writeFile(path.join(dataDir, 'desktop.json'), JSON.stringify(settings));
  runtime = await startRuntime({ dataDir, serverDir, version, log, onFailure });
  assert.equal(runtime.origin, origin, 'MCP endpoint remains stable after restart');
  assert.ok(
    (await api('model')).objects.some(
      (o) => o.id === object.id && o.attributes.department === 'ИТ',
    ),
  );
  assert.equal((await api(`diagrams/${diagram.id}`)).document.nodes[0].objectId, object.id);
  assert.equal(
    (await readdir(path.join(dataDir, 'backups'))).length,
    1,
    'upgrade creates a cold backup before migrations',
  );
  await runtime.stop();
  runtime = null;
  const worker = fork(path.join(root, 'smoke-child.cjs'), [dataDir, serverDir], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  worker.stdout.on('data', (chunk) => log(chunk.toString()));
  worker.stderr.on('data', (chunk) => log(chunk.toString()));
  try {
    await Promise.race([
      once(worker, 'message'),
      once(worker, 'exit').then(() => {
        throw new Error('Crash-test worker exited before startup');
      }),
      new Promise((_, reject) => {
        const t = setTimeout(() => reject(new Error('Crash-test worker timeout')), 60000);
        t.unref();
      }),
    ]);
  } finally {
    if (worker.exitCode === null) {
      const exited = once(worker, 'exit');
      worker.kill('SIGKILL');
      await exited;
    }
  }
  for (let i = 0; i < 30; i++) {
    try {
      await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(500) });
    } catch {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  runtime = await startRuntime({ dataDir, serverDir, version, log, onFailure });
  assert.ok(
    (await api('model')).objects.some((o) => o.id === object.id),
    'data survives an abrupt parent termination',
  );
  await runtime.stop();
  runtime = null;
  runtime = await startRuntime({
    dataDir,
    serverDir,
    version,
    log,
    onFailure: (error) => log(error.message),
  });
  const pgPid = Number(
    (await readFile(path.join(dataDir, 'postgres', 'postmaster.pid'), 'utf8')).split('\n')[0],
  );
  process.kill(pgPid, 'SIGKILL');
  await new Promise((resolve) => setTimeout(resolve, 300));
  await Promise.race([
    runtime.stop(),
    new Promise((_, reject) => {
      const t = setTimeout(() => reject(new Error('Shutdown hung after database crash')), 15000);
      t.unref();
    }),
  ]);
  runtime = await startRuntime({ dataDir, serverDir, version, log, onFailure });
  assert.ok(
    (await api('model')).objects.some((o) => o.id === object.id),
    'committed data survives database termination',
  );
  await runtime.stop();
  runtime = null;
  const before = await readFile(path.join(dataDir, 'postgres', 'PG_VERSION'), 'utf8');
  const newer = JSON.parse(await readFile(path.join(dataDir, 'desktop.json'), 'utf8'));
  newer.appVersion = '99.0.0';
  await writeFile(path.join(dataDir, 'desktop.json'), JSON.stringify(newer));
  await assert.rejects(
    startRuntime({ dataDir, serverDir, version, log, onFailure }),
    /более новой версии/,
  );
  assert.equal(await readFile(path.join(dataDir, 'postgres', 'PG_VERSION'), 'utf8'), before);
  console.log(
    'Desktop smoke OK: isolated DB, private HTTP, native migrations, notations, objects, representations, all exports, draw.io import, MCP, restart/crash persistence, upgrade backup and downgrade protection',
  );
} catch (error) {
  console.error(messages.join('\n').slice(-8000));
  throw error;
} finally {
  await runtime?.stop();
  await rm(dataDir, { recursive: true, force: true });
}
