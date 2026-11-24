const { _electron: electron, expect } = require('@playwright/test');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'maket-window-test-'));
  const executable =
    process.env.MAKET_TEST_EXECUTABLE || path.join(__dirname, 'dist', 'linux-unpacked', 'maket');
  let app;
  try {
    app = await electron.launch({
      executablePath: executable,
      args:
        process.env.MAKET_TEST_HEADLESS === '1'
          ? ['--ozone-platform=headless', '--disable-gpu', '--no-sandbox']
          : [],
      env: { ...process.env, MAKET_PORTABLE_DIR: directory },
      timeout: 120000,
    });
    const deadline = Date.now() + 120000;
    let window;
    while (Date.now() < deadline) {
      window = app.windows().find((w) => w.url().endsWith('/library'));
      if (window) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    assert.ok(window, 'Desktop workspace did not open');
    await window.getByRole('heading', { name: /^Библиотека/ }).waitFor({ timeout: 30000 });
    assert.equal(await window.getByRole('button', { name: 'Выйти', exact: true }).count(), 0);
    assert.equal(await window.evaluate(() => typeof window.require), 'undefined');
    await window.goto(new URL('/settings', window.url()).href);
    await window.getByRole('heading', { name: 'Настройки', exact: true }).waitFor();
    assert.equal(await window.getByLabel('Текущий пароль', { exact: true }).count(), 0);
    await window.locator('.mcp-settings').waitFor();
    const data = await window.evaluate(async () => {
      async function api(route, body) {
        const response = await fetch(`/api/${route}`, {
          method: body ? 'POST' : 'GET',
          headers: body ? { 'Content-Type': 'application/json' } : {},
          body: body ? JSON.stringify(body) : undefined,
        });
        const result = await response.json();
        if (!response.ok) throw new Error(JSON.stringify(result));
        return result;
      }
      const model = await api('model');
      const object = await api('objects', {
        name: 'Проверка portable',
        attributes: { platform: 'desktop' },
      });
      const diagram = await api('diagrams', { name: 'Portable diagram', notationIds: ['builtin'] });
      const binding = diagram.document.bindings[0];
      await api(`diagrams/${diagram.id}/representations`, {
        objectId: object.id,
        bindingId: binding.id,
        typeId: binding.document.nodeTypes[0].id,
        revision: diagram.revision,
        position: { x: 100, y: 100 },
      });
      const key = await api('mcp-keys', {
        name: 'Native test',
        expiresAt: null,
        grants: [
          {
            workspaceId: model.id,
            capabilities: [
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
      return {
        origin: location.origin,
        workspaceId: model.id,
        diagramId: diagram.id,
        key: key.secret,
      };
    });
    for (const format of ['json', 'drawio', 'png', 'jpeg', 'pdf']) {
      const response = await fetch(`${data.origin}/api/mcp`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${data.key}`,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'maket_export_diagram',
            arguments: { workspaceId: data.workspaceId, diagramId: data.diagramId, format },
          },
        }),
      });
      const exported = await response.json();
      assert.ok(!exported.result?.isError, JSON.stringify(exported));
      const file = exported.result?.content.find((c) => c.type === 'resource')?.resource;
      assert.ok(file?.blob, JSON.stringify(exported));
      if (format === 'drawio') {
        const imported = await fetch(`${data.origin}/api/mcp`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${data.key}`,
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
                workspaceId: data.workspaceId,
                format: 'drawio',
                filename: 'Portable.drawio',
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
    await window.goto(`${data.origin}/diagrams/${data.diagramId}`);
    await window.locator('.react-flow__node-notation').waitFor({ timeout: 30000 });
    const node = window.locator('.react-flow__node-notation').first();
    const originalLabel = await node.locator('.node-label').innerText();
    await node.dblclick();
    await window
      .getByRole('textbox', { name: 'Текст объекта', exact: true })
      .fill('Проверка команд desktop');
    await window.keyboard.press('Enter');
    await window.locator('.react-flow').focus();
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await window.keyboard.press(`${modifier}+z`);
    await expect(node.locator('.node-label')).toHaveText(originalLabel);
    await window.keyboard.press(`${modifier}+Shift+z`);
    await expect(node.locator('.node-label')).toHaveText('Проверка команд desktop');
    await window.keyboard.press(`${modifier}+s`);
    await expect(window.locator('.editor-save-state')).toContainText('Сохранено');
    const saved = await window.evaluate(
      async (id) => (await (await fetch(`/api/diagrams/${id}`)).json()).document.nodes[0].label,
      data.diagramId,
    );
    assert.equal(saved, 'Проверка команд desktop');
    await window.getByRole('button', { name: 'Просмотр', exact: true }).click();
    await node.dblclick();
    await expect(window.getByRole('textbox', { name: 'Текст объекта', exact: true })).toHaveCount(
      0,
    );
    await window.getByRole('button', { name: 'Редактирование', exact: true }).click();
    await window.screenshot({
      path: process.env.MAKET_TEST_SCREENSHOT || path.join(directory, 'desktop.png'),
    });
    console.log(
      'Packaged Electron smoke OK: local workspace, session bootstrap, settings, canvas modes, native keyboard undo/redo/save, isolated renderer, MCP and all file formats',
    );
  } finally {
    if (app) {
      await app.evaluate(({ app }) => app.quit()).catch(() => {});
      await new Promise((r) => setTimeout(r, 1500));
      await app.close().catch(() => {});
    }
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
