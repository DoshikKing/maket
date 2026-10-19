import 'dotenv/config';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { builtinNotation } from '../../src/lib/notation';
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
const emails: string[] = [];
async function login(request: APIRequestContext, name: string) {
  const email = `collaboration-${randomUUID()}@example.com`,
    password = 'Collaboration-test-password-42',
    salt = randomBytes(16).toString('hex');
  emails.push(email);
  const user = await db.user.create({
    data: {
      name,
      email,
      emailVerified: true,
      passwordHash: `${salt}:${scryptSync(password, salt, 64).toString('hex')}`,
    },
  });
  expect((await request.post('/api/auth/login', { data: { email, password } })).status()).toBe(200);
  return user;
}
async function result(
  request: APIRequestContext,
  path: string,
  method = 'GET',
  data?: unknown,
  expected = 200,
) {
  const r = await request.fetch(`/api/${path}`, { method, data });
  expect(r.status(), await r.text()).toBe(expected);
  return r.json();
}
test.afterAll(async () => {
  await db.user.deleteMany({ where: { email: { in: emails } } });
  await db.rateLimit.deleteMany({ where: { key: { contains: 'collaboration-' } } });
  await db.$disconnect();
});
test('workspace collaboration: roles, scope, locks, revocation, revisions and audit', async ({
  playwright,
  request,
}) => {
  test.setTimeout(120000);
  const owner = await login(request, 'Владелец');
  const areas = await result(request, 'workspaces');
  const area = areas[0];
  const editorClient = randomUUID(),
    ownerClient = randomUUID();
  const own = await playwright.request.newContext({
    baseURL: 'http://localhost:3000',
    storageState: await request.storageState(),
    extraHTTPHeaders: { 'X-Maket-Workspace': area.id, 'X-Maket-Client': ownerClient },
  });
  const editor = await playwright.request.newContext({
    baseURL: 'http://localhost:3000',
    extraHTTPHeaders: { 'X-Maket-Workspace': area.id, 'X-Maket-Client': editorClient },
  });
  const other = await login(editor, 'Редактор');
  try {
    await result(editor, 'model', 'GET', undefined, 404);
    await result(own, 'collaboration/members', 'POST', { email: other.email, role: 'editor' });
    const shared = await result(editor, 'workspaces');
    expect(shared.some((a: { id: string }) => a.id === area.id)).toBe(true);
    expect((await result(editor, 'collaboration')).access.role).toBe('editor');
    const a = await result(own, 'objects', 'POST', { name: 'Общий объект' }, 201);
    const b = await result(editor, 'objects', 'POST', { name: 'Объект редактора' }, 201);
    expect((await result(own, 'model')).objects.some((o: { id: string }) => o.id === b.id)).toBe(
      true,
    );
    const d = await result(own, 'diagrams', 'POST', { name: 'Общая диаграмма' }, 201);
    expect((await result(editor, `diagrams/${d.id}`)).id).toBe(d.id);
    // Collaborators can restore a shared diagram's frozen notation without owning the author's catalog.
    const notation = await result(
      own,
      'notations',
      'POST',
      { ...builtinNotation, id: 'shared-test', name: 'Нотация автора' },
      201,
    );
    const customDiagram = await result(
      own,
      'diagrams',
      'POST',
      { name: 'Общая нотация', notationIds: ['builtin', notation.id] },
      201,
    );
    const withoutNotation = await result(own, `diagrams/${customDiagram.id}/notations`, 'POST', {
      revision: customDiagram.revision,
      removeBindingId: customDiagram.document.bindings[1].id,
    });
    const restored = await result(editor, `diagrams/${customDiagram.id}/restore`, 'POST', {
      revision: withoutNotation.revision,
      number: 1,
    });
    expect(restored.document.bindings).toHaveLength(2);
    expect(restored.document.bindings[1].versionId).toBe(
      customDiagram.document.bindings[1].versionId,
    );
    await result(editor, 'collaboration/members', 'GET', undefined, 403);
    await result(
      editor,
      'collaboration/members',
      'POST',
      { email: owner.email, role: 'admin' },
      403,
    );
    await result(editor, `objects/${a.id}/share`, 'POST', { enabled: true }, 403);
    await result(editor, `objects/${b.id}`, 'DELETE', { revision: b.revision }, 403);
    // A lease is exclusive even when the second client is the owner.
    await result(editor, `collaboration/locks/${a.id}`, 'POST', {});
    await result(own, `objects/${a.id}`, 'PATCH', { revision: a.revision, name: 'Нельзя' }, 423);
    await result(own, `collaboration/locks/${a.id}`, 'POST', {}, 423);
    const updated = await result(editor, `objects/${a.id}`, 'PATCH', {
      revision: a.revision,
      name: 'Изменён редактором',
    });
    expect((await result(own, `objects/${a.id}`)).name).toBe(updated.name);
    await result(editor, `collaboration/locks/${a.id}`, 'DELETE', {});
    await result(
      own,
      `objects/${a.id}`,
      'PATCH',
      { revision: a.revision, name: 'Устаревшие данные' },
      409,
    );
    // Two independent elements can be held concurrently; diagram leases cover their objects.
    const placed = await result(
      own,
      `diagrams/${d.id}/representations`,
      'POST',
      {
        revision: d.revision,
        objectId: a.id,
        bindingId: d.document.bindings[0].id,
        typeId: 'process',
        position: { x: 0, y: 0 },
      },
      201,
    );
    await result(editor, `collaboration/locks/${d.id}`, 'POST', {});
    await result(own, `collaboration/locks/${b.id}`, 'POST', {});
    await result(
      own,
      `objects/${a.id}`,
      'PATCH',
      { revision: updated.revision, name: 'Нельзя из карточки' },
      423,
    );
    await result(
      own,
      `diagrams/${d.id}`,
      'PUT',
      { revision: placed.revision, document: placed.document },
      423,
    );
    // Closing a nested card does not release the diagram's leases.
    await result(editor, `collaboration/locks/${a.id}`, 'POST', {});
    await result(editor, `collaboration/locks/${a.id}`, 'DELETE', {});
    await result(own, `collaboration/locks/${a.id}`, 'POST', {}, 423);
    await result(editor, `collaboration/locks/${d.id}`, 'DELETE', {});
    await result(own, `collaboration/locks/${b.id}`, 'DELETE', {});
    // Expired leases can be reclaimed and old clients cannot release a new lease.
    await result(editor, `collaboration/locks/${b.id}`, 'POST', {});
    await db.workspaceLock.updateMany({
      where: { spaceId: area.id, targetId: b.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await result(own, `collaboration/locks/${b.id}`, 'POST', {});
    await result(editor, `collaboration/locks/${b.id}`, 'DELETE', {});
    await result(
      editor,
      `objects/${b.id}`,
      'PATCH',
      { revision: b.revision, name: 'Захват устаревшим клиентом' },
      423,
    );
    await result(own, `collaboration/locks/${b.id}`, 'DELETE', {});
    // Late cleanup from a previous mount must not release a newer lease in the same tab.
    const oldLease = randomUUID(),
      newLease = randomUUID();
    await result(editor, `collaboration/locks/${a.id}`, 'POST', { leaseId: oldLease });
    await result(editor, `collaboration/locks/${a.id}`, 'POST', { leaseId: newLease });
    await result(editor, `collaboration/locks/${a.id}`, 'DELETE', { leaseId: oldLease });
    await result(own, `collaboration/locks/${a.id}`, 'POST', {}, 423);
    await result(
      editor,
      `collaboration/locks/${a.id}`,
      'POST',
      { leaseId: oldLease, renew: true },
      423,
    );
    await result(own, `collaboration/locks/${a.id}`, 'DELETE', { force: true });
    const fenced = await editor.patch(`/api/objects/${a.id}`, {
      data: { revision: updated.revision, name: 'Просроченная сессия' },
      headers: { 'X-Maket-Leases': JSON.stringify([{ rootId: a.id, leaseId: newLease }]) },
    });
    expect(fenced.status()).toBe(423);
    await result(
      editor,
      `collaboration/locks/${a.id}`,
      'POST',
      { leaseId: newLease, renew: true },
      423,
    );
    // Concurrent requests have exactly one winner for a lease, and independent edits both persist.
    const attempts = await Promise.all([
      own.post(`/api/collaboration/locks/${a.id}`, { data: {} }),
      editor.post(`/api/collaboration/locks/${a.id}`, { data: {} }),
    ]);
    expect(attempts.map((r) => r.status()).sort()).toEqual([200, 423]);
    await result(
      attempts[0].status() === 200 ? own : editor,
      `collaboration/locks/${a.id}`,
      'DELETE',
      {},
    );
    const concurrent = await Promise.all([
      own.patch(`/api/objects/${a.id}`, {
        data: { revision: updated.revision, name: 'Параллельно А' },
      }),
      editor.patch(`/api/objects/${b.id}`, {
        data: { revision: b.revision, name: 'Параллельно Б' },
      }),
    ]);
    expect(concurrent.map((r) => r.status())).toEqual([200, 200]);
    expect((await result(own, `objects/${a.id}`)).name).toBe('Параллельно А');
    expect((await result(editor, `objects/${b.id}`)).name).toBe('Параллельно Б');
    const custom = await result(own, 'collaboration/roles', 'POST', {
      name: 'Правка одного объекта',
      actions: ['read', 'edit'],
      elementIds: [a.id],
    });
    await result(own, 'collaboration/members', 'PATCH', { email: other.email, role: custom.id });
    const now = await result(editor, `objects/${a.id}`);
    await result(editor, `objects/${a.id}`, 'PATCH', {
      revision: now.revision,
      name: 'Разрешённый элемент',
    });
    await result(
      editor,
      `objects/${b.id}`,
      'PATCH',
      { revision: b.revision, name: 'Нет доступа' },
      403,
    );
    await result(editor, 'objects', 'POST', { name: 'Нет создания' }, 403);
    await result(
      editor,
      `diagrams/${d.id}`,
      'PUT',
      { revision: placed.revision, document: placed.document },
      403,
    );
    const editOnly = await result(own, 'collaboration/roles', 'POST', {
      name: 'Редактирование без создания',
      actions: ['read', 'edit'],
    });
    await result(own, 'collaboration/members', 'PATCH', { email: other.email, role: editOnly.id });
    await result(
      editor,
      `diagrams/${d.id}/representations`,
      'POST',
      {
        revision: placed.revision,
        bindingId: placed.document.bindings[0].id,
        typeId: 'process',
        position: { x: 10, y: 10 },
      },
      403,
    );
    const injected = structuredClone(placed.document);
    injected.nodes[0].objectId = randomUUID();
    await result(
      editor,
      `diagrams/${d.id}`,
      'PUT',
      { revision: placed.revision, document: injected },
      403,
    );
    await result(own, 'collaboration/members', 'PATCH', { email: other.email, role: custom.id });
    await result(own, `collaboration/roles/${custom.id}`, 'DELETE', undefined, 409);
    await result(own, 'collaboration/members', 'PATCH', { email: other.email, role: 'moderator' });
    await result(editor, 'collaboration/members', 'GET', undefined, 403);
    await result(editor, 'collaboration/roles', 'POST', { name: 'Нельзя', actions: ['read'] }, 403);
    const disposable = await result(own, 'objects', 'POST', { name: 'Для модератора' }, 201);
    await result(editor, `objects/${disposable.id}`, 'DELETE', { revision: disposable.revision });
    await result(own, 'collaboration/members', 'PATCH', { email: other.email, role: 'admin' });
    expect((await result(editor, 'collaboration/members')).owner.id).toBe(owner.id);
    await result(
      editor,
      'collaboration/members',
      'PATCH',
      { email: owner.email, role: 'viewer' },
      400,
    );
    await result(own, 'collaboration/members', 'PATCH', { email: other.email, role: 'viewer' });
    await result(editor, `collaboration/locks/${a.id}`, 'POST', {}, 403);
    await result(editor, 'diagrams', 'POST', { name: 'Нет создания' }, 403);
    expect((await result(editor, `diagrams/${d.id}`)).id).toBe(d.id);
    const audit = await result(own, 'collaboration/events');
    expect(
      audit.some(
        (e: { userId: string; action: string }) =>
          e.userId === other.id && e.action === 'PATCH objects',
      ),
    ).toBe(true);
    const before = (await result(editor, 'collaboration')).revision;
    await result(own, 'objects', 'POST', { name: 'Сигнал синхронизации' }, 201);
    expect((await result(editor, 'collaboration')).revision).toBeGreaterThan(before);
    await result(own, `collaboration/members/${other.id}`, 'DELETE');
    await result(editor, `diagrams/${d.id}`, 'GET', undefined, 404);
    await result(editor, 'collaboration', 'GET', undefined, 404);
    expect((await result(editor, 'workspaces')).some((a: { id: string }) => a.id === area.id)).toBe(
      false,
    );
  } finally {
    await own.dispose();
    await editor.dispose();
  }
});

test('collaboration UI shares access and synchronizes a readonly diagram between browser sessions', async ({
  browser,
  playwright,
  request,
}) => {
  test.setTimeout(120000);
  await login(request, 'Владелец UI');
  const area = (await result(request, 'workspaces'))[0];
  const own = await playwright.request.newContext({
    baseURL: 'http://localhost:3000',
    storageState: await request.storageState(),
    extraHTTPHeaders: { 'X-Maket-Workspace': area.id, 'X-Maket-Client': randomUUID() },
  });
  const invited = await playwright.request.newContext({ baseURL: 'http://localhost:3000' });
  const user = await login(invited, 'Читатель UI');
  const ownerContext = await browser.newContext({ storageState: await request.storageState() });
  const viewerContext = await browser.newContext({ storageState: await invited.storageState() });
  const p = await ownerContext.newPage(),
    viewer = await viewerContext.newPage();
  try {
    await p.goto('/solutions');
    await p.getByRole('button', { name: /Владелец/ }).click();
    await p.getByLabel('Email участника', { exact: true }).fill(user.email);
    await p.getByLabel('Роль нового участника').selectOption('viewer');
    await p.getByRole('button', { name: 'Добавить', exact: true }).click();
    await expect(p.getByRole('button', { name: 'Отозвать доступ' })).toBeVisible({
      timeout: 15000,
    });
    await p.getByRole('button', { name: 'Закрыть', exact: true }).click();
    const d = await result(own, 'diagrams', 'POST', { name: 'Диаграмма для читателя' }, 201);
    await viewer.goto(`/api/workspaces/${area.id}/open`);
    await viewer.goto(`/diagrams/${d.id}`);
    await expect(viewer.getByText('Доступ только для просмотра', { exact: true })).toBeVisible({
      timeout: 15000,
    });
    await expect(viewer.locator('.title-button')).toBeVisible();
    await result(own, `diagrams/${d.id}`, 'PATCH', { name: 'Новое имя в другом браузере' });
    await expect(
      viewer.locator('.title-button').filter({ hasText: 'Новое имя в другом браузере' }),
    ).toBeVisible({
      timeout: 15000,
    });
    const liveObject = await result(own, 'objects', 'POST', { name: 'Живая фигура' }, 201);
    const liveDiagram = await result(
      own,
      `diagrams/${d.id}/representations`,
      'POST',
      {
        revision: d.revision,
        bindingId: d.document.bindings[0].id,
        typeId: 'process',
        objectId: liveObject.id,
        position: { x: 0, y: 0 },
      },
      201,
    );
    const liveNode = viewer.locator(
      `.react-flow__node[data-id="${liveDiagram.document.nodes[0].id}"]`,
    );
    await expect(liveNode).toBeVisible({ timeout: 15000 });
    liveDiagram.document.nodes[0].position = { x: 300, y: 140 };
    await result(own, `diagrams/${d.id}`, 'PUT', {
      revision: liveDiagram.revision,
      document: liveDiagram.document,
    });
    await expect(liveNode).toHaveAttribute('style', /translate\(300px,\s*140px\)/, {
      timeout: 15000,
    });
    await result(own, 'collaboration/members', 'PATCH', { email: user.email, role: 'editor' });
    await expect(viewer.getByText('Доступ только для просмотра', { exact: true })).not.toBeVisible({
      timeout: 15000,
    });
    expect(await db.workspaceLock.count({ where: { spaceId: area.id, targetId: d.id } })).toBe(0);
    await p.goto(`/diagrams/${d.id}`);
    await expect(
      p.locator(`.react-flow__node[data-id="${liveDiagram.document.nodes[0].id}"]`),
    ).toBeVisible();
    await expect(p.locator('.collaboration-notice')).toHaveCount(0);
    await viewer.goto('/library');
    await expect
      .poll(
        async () =>
          db.workspaceLock.count({ where: { spaceId: area.id, targetId: d.id, userId: user.id } }),
        { timeout: 15000 },
      )
      .toBe(0);
  } finally {
    await ownerContext.close();
    await viewerContext.close();
    await own.dispose();
    await invited.dispose();
  }
});

test('concurrent diagram writes merge disjoint edits, reject conflicts and respect object leases', async ({
  request,
  playwright,
}) => {
  test.setTimeout(120000);
  await login(request, 'Автор');
  const area = (await result(request, 'workspaces'))[0];
  const second = await playwright.request.newContext({
    baseURL: 'http://localhost:3000',
    extraHTTPHeaders: { 'X-Maket-Workspace': area.id, 'X-Maket-Client': randomUUID() },
  });
  const user = await login(second, 'Соавтор');
  try {
    await result(request, 'collaboration/members', 'POST', { email: user.email, role: 'editor' });
    let d = await result(
      request,
      'diagrams',
      'POST',
      { name: 'Одновременное редактирование' },
      201,
    );
    for (let i = 0; i < 2; i++)
      d = await result(
        request,
        `diagrams/${d.id}/representations`,
        'POST',
        {
          revision: d.revision,
          bindingId: d.document.bindings[0].id,
          typeId: 'process',
          position: { x: i * 300, y: 0 },
        },
        201,
      );
    const a = structuredClone(d.document),
      b = structuredClone(d.document);
    a.nodes[0].position = { x: 50, y: 100 };
    b.nodes[1].position = { x: 500, y: 300 };
    const responses = await Promise.all([
      request.put(`/api/diagrams/${d.id}`, {
        data: { revision: d.revision, document: a, concurrent: true },
      }),
      second.put(`/api/diagrams/${d.id}`, {
        data: { revision: d.revision, document: b, concurrent: true },
      }),
    ]);
    for (const response of responses) expect(response.status(), await response.text()).toBe(200);
    let live = await result(request, `diagrams/${d.id}`);
    expect(live.document.nodes.map((n: { position: unknown }) => n.position)).toEqual([
      { x: 50, y: 100 },
      { x: 500, y: 300 },
    ]);
    const left = structuredClone(live.document),
      right = structuredClone(live.document);
    left.nodes[0].position.x = 70;
    right.nodes[0].position.y = 150;
    await result(request, `diagrams/${d.id}`, 'PUT', {
      revision: live.revision,
      document: left,
      concurrent: true,
    });
    await result(
      second,
      `diagrams/${d.id}`,
      'PUT',
      { revision: live.revision, document: right, concurrent: true },
      409,
    );
    // Holding A's property card must not stop B's representation moving on the same diagram.
    await result(second, `collaboration/locks/${live.document.nodes[0].objectId}`, 'POST', {});
    live = await result(request, `diagrams/${d.id}`);
    const other = structuredClone(live.document);
    other.nodes[1].label = 'Не заблокирован';
    await result(request, `diagrams/${d.id}`, 'PUT', {
      revision: live.revision,
      document: other,
      concurrent: true,
    });
    const locked = structuredClone(live.document);
    locked.nodes[0].label = 'Нельзя';
    await result(
      request,
      `diagrams/${d.id}`,
      'PUT',
      { revision: live.revision, document: locked, concurrent: true },
      423,
    );
    await result(second, `collaboration/locks/${live.document.nodes[0].objectId}`, 'DELETE', {});
    // Stale append requests are atomic and keep both new representations.
    live = await result(request, `diagrams/${d.id}`);
    const append = {
      revision: live.revision,
      bindingId: live.document.bindings[0].id,
      typeId: 'process',
      position: { x: 0, y: 500 },
      concurrent: true,
    };
    const appended = await Promise.all([
      request.post(`/api/diagrams/${d.id}/representations`, { data: append }),
      second.post(`/api/diagrams/${d.id}/representations`, { data: append }),
    ]);
    for (const response of appended) expect(response.status(), await response.text()).toBe(201);
    expect((await result(request, `diagrams/${d.id}`)).document.nodes).toHaveLength(4);
    // A concurrent connect cannot resurrect an endpoint removed by another participant.
    live = await result(request, `diagrams/${d.id}`);
    const removed = structuredClone(live.document),
      connected = structuredClone(live.document);
    removed.nodes.shift();
    connected.edges.push({
      id: randomUUID(),
      bindingId: connected.bindings[0].id,
      typeId: builtinNotation.edgeTypes[0].id,
      source: connected.nodes[0].id,
      target: connected.nodes[1].id,
      sourcePort: 'out',
      targetPort: 'in',
      properties: {},
    });
    await result(request, `diagrams/${d.id}`, 'PUT', {
      revision: live.revision,
      document: removed,
      concurrent: true,
    });
    await result(
      second,
      `diagrams/${d.id}`,
      'PUT',
      { revision: live.revision, document: connected, concurrent: true },
      409,
    );
    expect((await result(request, `diagrams/${d.id}`)).document.edges).toHaveLength(0);
  } finally {
    await second.dispose();
  }
});

test('two editors keep unsaved edits, receive remote changes and undo only their own action', async ({
  request,
  playwright,
  browser,
}) => {
  test.setTimeout(120000);
  const author = await login(request, 'Первый редактор');
  const area = (await result(request, 'workspaces'))[0];
  const second = await playwright.request.newContext({ baseURL: 'http://localhost:3000' });
  const coauthor = await login(second, 'Второй редактор');
  await result(request, 'collaboration/members', 'POST', { email: coauthor.email, role: 'editor' });
  await db.user.updateMany({
    where: { id: { in: [author.id, coauthor.id] } },
    data: { settings: { theme: 'light', snapToGrid: false, autosave: false } },
  });
  let d = await result(request, 'diagrams', 'POST', { name: 'Два редактора' }, 201);
  for (let i = 0; i < 2; i++)
    d = await result(
      request,
      `diagrams/${d.id}/representations`,
      'POST',
      {
        revision: d.revision,
        bindingId: d.document.bindings[0].id,
        typeId: 'process',
        position: { x: i * 300, y: 0 },
      },
      201,
    );
  const firstContext = await browser.newContext({ storageState: await request.storageState() }),
    secondContext = await browser.newContext({ storageState: await second.storageState() });
  const p = await firstContext.newPage(),
    q = await secondContext.newPage();
  const node = (page: typeof p, i: number) =>
    page.locator(`.react-flow__node[data-id="${d.document.nodes[i].id}"]`);
  const edit = async (page: typeof p, i: number, label: string) => {
    await node(page, i).locator('.node-label').dblclick();
    await page.getByLabel('Текст объекта', { exact: true }).fill(label);
    await page.getByLabel('Текст объекта', { exact: true }).press('Enter');
  };
  try {
    await q.goto(`/api/workspaces/${area.id}/open`);
    await Promise.all([p.goto(`/diagrams/${d.id}`), q.goto(`/diagrams/${d.id}`)]);
    await expect(node(p, 0)).toBeVisible();
    await expect(node(q, 1)).toBeVisible();
    await expect(p.locator('.collaboration-notice')).toHaveCount(0);
    await expect(q.locator('.collaboration-notice')).toHaveCount(0);
    await edit(p, 0, 'Локальная правка А');
    await edit(q, 1, 'Правка соавтора Б');
    await q.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(node(p, 1)).toContainText('Правка соавтора Б', { timeout: 15000 });
    await expect(node(p, 0)).toContainText('Локальная правка А');
    await p.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(node(q, 0)).toContainText('Локальная правка А', { timeout: 15000 });
    await p.getByRole('button', { name: 'Отменить', exact: true }).click();
    await expect(node(p, 0)).not.toContainText('Локальная правка А');
    await expect(node(p, 1)).toContainText('Правка соавтора Б');
    await p.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(node(q, 0)).not.toContainText('Локальная правка А', { timeout: 15000 });
    // A stale append must undo only its own new figure, keeping the peer's intervening append.
    let foreignNodeId = '';
    await p.route(`**/api/diagrams/${d.id}/representations`, async (route) => {
      const current = await result(request, `diagrams/${d.id}`);
      const response = await second.post(`/api/diagrams/${d.id}/representations`, {
        headers: { 'X-Maket-Workspace': area.id },
        data: {
          revision: current.revision,
          concurrent: true,
          bindingId: current.document.bindings[0].id,
          typeId: 'process',
          position: { x: 900, y: 500 },
        },
      });
      expect(response.status(), await response.text()).toBe(201);
      const foreign = await response.json();
      foreignNodeId = foreign.document.nodes.at(-1).id;
      await route.continue();
    });
    await p
      .locator('.palette-item')
      .filter({ hasText: builtinNotation.nodeTypes.find((t) => t.id === 'process')!.name })
      .click();
    await expect(p.locator('.react-flow__node')).toHaveCount(4, { timeout: 15000 });
    await p.getByRole('button', { name: 'Отменить', exact: true }).click();
    await expect(p.locator('.react-flow__node')).toHaveCount(3);
    await expect(p.locator(`.react-flow__node[data-id="${foreignNodeId}"]`)).toBeVisible();
    await p.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect
      .poll(async () => (await result(request, `diagrams/${d.id}`)).document.nodes.length)
      .toBe(3);
    // An incoming edit to the same label produces a conflict, keeping the local draft visible.
    await edit(p, 0, 'Не потерять локальную подпись');
    await edit(q, 0, 'Сохранённая подпись соавтора');
    await q.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(p.getByText(/Конфликт совместного редактирования:/)).toBeVisible({
      timeout: 15000,
    });
    await expect(node(p, 0)).toContainText('Не потерять локальную подпись');
    expect((await result(request, `diagrams/${d.id}`)).document.nodes[0].label).toBe(
      'Сохранённая подпись соавтора',
    );
  } finally {
    await firstContext.close();
    await secondContext.close();
    await second.dispose();
  }
});
