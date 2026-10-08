import 'dotenv/config';
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { scryptSync, randomBytes } from 'node:crypto';
import { builtinNotation, type DiagramDocument } from '../../src/lib/notation';
import type { ModelDiagram, ModelDocument, ModelObject } from '../../src/lib/model';
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
const emails: string[] = [];
async function login(request: APIRequestContext, page?: Page) {
  const email = `model-${crypto.randomUUID()}@example.com`,
    password = 'Model-test-password-42',
    salt = randomBytes(16).toString('hex');
  emails.push(email);
  const user = await db.user.create({
    data: {
      email,
      name: 'Модель',
      emailVerified: true,
      passwordHash: `${salt}:${scryptSync(password, salt, 64).toString('hex')}`,
      settings: { theme: 'light', snapToGrid: false, autosave: true },
    },
  });
  expect((await request.post('/api/auth/login', { data: { email, password } })).status()).toBe(200);
  if (page) await page.context().addCookies((await request.storageState()).cookies);
  return user;
}
async function create(request: APIRequestContext, name = 'Модель'): Promise<ModelDiagram> {
  const r = await request.post('/api/diagrams', { data: { name } });
  expect(r.status()).toBe(201);
  return r.json();
}
async function object(
  request: APIRequestContext,
  name: string,
  parentId?: string,
): Promise<ModelObject> {
  const r = await request.post('/api/objects', { data: { name, parentId } });
  expect(r.status()).toBe(201);
  return r.json();
}
async function place(
  request: APIRequestContext,
  d: ModelDiagram,
  objectId?: string,
  bindingId = d.document.bindings[0].id,
  typeId = 'process',
): Promise<ModelDiagram> {
  const r = await request.post(`/api/diagrams/${d.id}/representations`, {
    data: {
      revision: d.revision,
      objectId,
      bindingId,
      typeId,
      position: { x: d.document.nodes.length * 250, y: 0 },
    },
  });
  expect(r.status()).toBe(201);
  return r.json();
}
async function save(
  request: APIRequestContext,
  d: ModelDiagram,
  document: ModelDocument,
): Promise<ModelDiagram> {
  const r = await request.put(`/api/diagrams/${d.id}`, {
    data: { revision: d.revision, document },
  });
  expect(r.status(), await r.text()).toBe(200);
  return r.json();
}
test.afterAll(async () => {
  await db.user.deleteMany({ where: { email: { in: emails } } });
  await db.rateLimit.deleteMany({ where: { key: { contains: 'model-' } } });
  await db.$disconnect();
});
test('shared objects, independent nesting, alias-preserving import, duplication, snapshots and archiving', async ({
  request,
}) => {
  await login(request);
  const parent = await object(request, 'Контейнер'),
    child = await object(request, 'Заказ', parent.id);
  let d = await create(request);
  d = await place(request, d, child.id);
  d = await place(request, d, child.id);
  expect(d.document.nodes.map((n) => n.objectId)).toEqual([child.id, child.id]);
  expect(d.document.objects.map((o) => o.id)).toEqual([child.id, parent.id]);
  expect(
    (
      await request.patch(`/api/objects/${parent.id}`, {
        data: { revision: parent.revision, parentId: child.id },
      })
    ).status(),
  ).toBe(400);
  const newer = await (
    await request.patch(`/api/objects/${child.id}`, {
      data: { revision: child.revision, name: 'Заказ обновлён', attributes: { automated: true } },
    })
  ).json();
  expect(
    (
      await request.patch(`/api/objects/${child.id}`, {
        data: { revision: child.revision, name: 'Устарело' },
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await request.put(`/api/diagrams/${d.id}`, {
        data: { revision: d.revision, document: d.document },
      })
    ).status(),
  ).toBe(409);
  const historical = await (
    await request.get(`/api/diagrams/${d.id}/history?number=${d.revision}`)
  ).json();
  expect(historical.document.objects.find((o: ModelObject) => o.id === child.id).name).toBe(
    'Заказ',
  );
  d = await (await request.get(`/api/diagrams/${d.id}`)).json();
  expect(d.document.objects.find((o) => o.id === child.id)!.name).toBe('Заказ обновлён');
  const local = structuredClone(d.document);
  local.nodes[0].label = 'Локальный заказ';
  local.nodes[0].size = { width: 250, height: 100 };
  d = await save(request, d, local);
  const restored = await request.post(`/api/diagrams/${d.id}/restore`, {
    data: { revision: d.revision, number: historical.revision },
  });
  expect(restored.status()).toBe(200);
  d = await restored.json();
  expect(d.document.nodes[0].label).toBeUndefined();
  expect(d.document.objects.find((o) => o.id === child.id)!.name).toBe('Заказ обновлён');
  const copied = await (await request.post(`/api/diagrams/${d.id}/duplicate`, { data: {} })).json();
  expect(copied.document.nodes[0].objectId).toBe(child.id);
  const imported = await request.post('/api/diagrams', {
    data: { name: 'Импорт', document: d.document },
  });
  expect(imported.status()).toBe(201);
  const clone = await imported.json();
  expect(clone.document.nodes[0].objectId).toBe(clone.document.nodes[1].objectId);
  expect(clone.document.nodes[0].objectId).not.toBe(child.id);
  expect(
    clone.document.objects.find((o: ModelObject) => o.id === clone.document.nodes[0].objectId)
      .parentId,
  ).not.toBe(parent.id);
  expect(clone.document.objects).toHaveLength(2);
  const usages = await (await request.get(`/api/objects/${child.id}/usages`)).json();
  expect(usages).toHaveLength(2);
  expect(usages.map((u: { count: number }) => u.count)).toEqual([2, 2]);
  const archived = await (
    await request.patch(`/api/objects/${child.id}`, {
      data: { revision: newer.revision, archived: true },
    })
  ).json();
  expect(archived.archived).toBe(true);
  expect(
    (
      await request.post(`/api/diagrams/${d.id}/representations`, {
        data: {
          revision: d.revision,
          objectId: child.id,
          bindingId: d.document.bindings[0].id,
          typeId: 'process',
          position: { x: 0, y: 0 },
        },
      })
    ).status(),
  ).toBe(404);
  d = await (await request.get(`/api/diagrams/${d.id}`)).json();
  expect(d.document.nodes).toHaveLength(2);
  d = await save(request, d, { ...d.document, nodes: [], objects: [], edges: [] });
  expect((await request.get(`/api/objects/${child.id}`)).status()).toBe(200);
  const rollback = await request.post(`/api/objects/${child.id}/restore`, {
    data: { revision: archived.revision, number: 1 },
  });
  expect(rollback.status()).toBe(200);
  expect((await rollback.json()).name).toBe('Заказ');
});
test('atomic representation creation rolls back on a stale diagram, owns references and serializes concurrent tree moves', async ({
  request,
  playwright,
}) => {
  await login(request);
  let d = await create(request);
  d = await place(request, d);
  const before = await (await request.get('/api/model')).json();
  const r = await request.post(`/api/diagrams/${d.id}/representations`, {
    data: {
      revision: 1,
      bindingId: d.document.bindings[0].id,
      typeId: 'process',
      position: { x: 0, y: 0 },
    },
  });
  expect(r.status()).toBe(409);
  expect((await (await request.get('/api/model')).json()).objects).toHaveLength(
    before.objects.length,
  );
  const other = await playwright.request.newContext({ baseURL: 'http://localhost:3000' });
  await login(other);
  const foreign = await object(other, 'Чужой');
  expect((await request.get(`/api/objects/${foreign.id}`)).status()).toBe(404);
  expect(
    (
      await request.post('/api/objects', { data: { name: 'Нельзя', parentId: foreign.id } })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.post(`/api/diagrams/${d.id}/representations`, {
        data: {
          revision: d.revision,
          bindingId: d.document.bindings[0].id,
          typeId: 'process',
          objectId: foreign.id,
          position: { x: 0, y: 0 },
        },
      })
    ).status(),
  ).toBe(404);
  const a = await object(request, 'A'),
    b = await object(request, 'B');
  const moves = await Promise.all([
    request.patch(`/api/objects/${a.id}`, { data: { revision: 1, parentId: b.id } }),
    request.patch(`/api/objects/${b.id}`, { data: { revision: 1, parentId: a.id } }),
  ]);
  expect(moves.map((m) => m.status()).sort()).toEqual([200, 400]);
  // The server-side placement command enforces the document limit and rolls back the new object.
  d = await save(request, d, {
    ...d.document,
    nodes: Array.from({ length: 1000 }, (_, i) => ({
      ...d.document.nodes[0],
      id: `limit-${i}`,
      position: { x: i * 20, y: 0 },
    })),
  });
  const countBefore = (await (await request.get('/api/model')).json()).objects.length;
  const overflow = await request.post(`/api/diagrams/${d.id}/representations`, {
    data: {
      revision: d.revision,
      bindingId: d.document.bindings[0].id,
      typeId: 'process',
      position: { x: 0, y: 0 },
    },
  });
  expect(overflow.status()).toBe(400);
  expect((await (await request.get('/api/model')).json()).objects).toHaveLength(countBefore);
  expect((await (await request.get(`/api/diagrams/${d.id}`)).json()).revision).toBe(d.revision);
  await other.dispose();
});
test('multiple pinned notations, shared attributes, cross-notation connections and safe removal', async ({
  request,
}) => {
  await login(request);
  const custom = structuredClone(builtinNotation);
  custom.id = 'other';
  custom.name = 'Другая';
  custom.nodeTypes
    .find((t) => t.id === 'process')!
    .properties.push({
      key: 'auto',
      scope: 'object',
      objectKey: 'automated',
      label: 'Авторабота',
      type: 'boolean',
      required: false,
      default: false,
    });
  const nr = await request.post('/api/notations', { data: custom });
  expect(nr.status()).toBe(201);
  const n = await nr.json();
  let d = await create(request);
  d = await place(request, d);
  const objectId = d.document.nodes[0].objectId;
  const attached = await request.post(`/api/diagrams/${d.id}/notations`, {
    data: { revision: d.revision, notationId: n.id },
  });
  expect(attached.status()).toBe(200);
  d = await attached.json();
  const second = d.document.bindings[1];
  d = await place(request, d, objectId, second.id);
  expect(d.document.nodes[1].objectId).toBe(objectId);
  const invalid = structuredClone(d.document);
  invalid.edges.push({
    id: 'e',
    bindingId: d.document.bindings[0].id,
    typeId: 'flow',
    source: d.document.nodes[0].id,
    target: d.document.nodes[1].id,
    sourcePort: 'out',
    targetPort: 'in',
    properties: { label: '' },
  });
  expect(
    (
      await request.put(`/api/diagrams/${d.id}`, {
        data: { revision: d.revision, document: invalid },
      })
    ).status(),
  ).toBe(400);
  invalid.edges[0].bindingId = null;
  invalid.edges[0].typeId = 'association';
  d = await save(request, d, invalid);
  expect(
    (
      await request.post(`/api/diagrams/${d.id}/notations`, {
        data: { revision: d.revision, removeBindingId: second.id },
      })
    ).status(),
  ).toBe(409);
  expect((await request.delete(`/api/notations/${n.id}`)).status()).toBe(409);
  custom.version = '1.0.1';
  custom.name = 'Новая версия';
  expect((await request.put(`/api/notations/${n.id}`, { data: custom })).status()).toBe(200);
  d = await (await request.get(`/api/diagrams/${d.id}`)).json();
  expect(d.document.bindings[1].document.version).toBe('1.0.0');
  const beforeRemoval = d.revision;
  d = await save(request, d, { ...d.document, nodes: [d.document.nodes[0]], edges: [] });
  const removed = await request.post(`/api/diagrams/${d.id}/notations`, {
    data: { revision: d.revision, removeBindingId: second.id },
  });
  expect(removed.status()).toBe(200);
  const detached = await removed.json();
  expect(detached.document.bindings).toHaveLength(1);
  expect((await request.delete(`/api/notations/${n.id}`)).status()).toBe(200);
  const restored = await request.post(`/api/diagrams/${d.id}/restore`, {
    data: { revision: detached.revision, number: beforeRemoval },
  });
  expect(restored.status(), await restored.text()).toBe(200);
  const restoredDiagram = await restored.json();
  expect(restoredDiagram.document.bindings[1].versionId).toBeNull();
  expect(restoredDiagram.document.bindings[1].document.version).toBe('1.0.0');
  expect(restoredDiagram.document.nodes).toHaveLength(2);
});
test('legacy migration preserves appearance, history and identities across repeat reads and restoration', async ({
  request,
}) => {
  const user = await login(request);
  const old: DiagramDocument = {
    schemaVersion: 1,
    notation: builtinNotation,
    nodes: [
      {
        id: 'a',
        typeId: 'process',
        position: { x: 15, y: 20 },
        properties: { title: 'Старый заказ' },
        size: { width: 230, height: 120 },
        layer: 4,
        label: 'Подпись',
      },
    ],
    edges: [],
  };
  const row = await db.diagram.create({
    data: {
      ownerId: user.id,
      name: 'Legacy',
      document: old,
      revisions: { create: { number: 1, document: old } },
    },
  });
  const d: ModelDiagram = await (await request.get(`/api/diagrams/${row.id}`)).json();
  expect(d.revision).toBe(2);
  expect(d.document.schemaVersion).toBe(2);
  expect(d.document.nodes[0]).toMatchObject({
    position: { x: 15, y: 20 },
    size: { width: 230, height: 120 },
    layer: 4,
    label: 'Подпись',
  });
  expect(d.document.objects[0].name).toBe('Старый заказ');
  const again = await (await request.get(`/api/diagrams/${row.id}`)).json();
  expect(again.revision).toBe(2);
  expect(again.document.nodes[0].objectId).toBe(d.document.nodes[0].objectId);
  expect(
    (await (await request.get(`/api/diagrams/${row.id}/history?number=1`)).json()).document,
  ).toEqual(old);
  const restore = await request.post(`/api/diagrams/${row.id}/restore`, {
    data: { revision: 2, number: 1 },
  });
  expect(restore.status()).toBe(200);
  expect((await restore.json()).document.nodes[0].objectId).toBe(d.document.nodes[0].objectId);
});
test('browser: create in tree, drop aliases, change shared name and local caption, switch skin, reload', async ({
  page,
  request,
}) => {
  await login(request, page);
  const d = await create(request);
  await page.goto(`/diagrams/${d.id}`);
  await page.getByRole('button', { name: 'Создать объект', exact: true }).click();
  await page.getByLabel('Имя объекта', { exact: true }).fill('Общий заказ');
  await page.getByRole('button', { name: 'Сохранить объект', exact: true }).click();
  const row = page
    .locator('.object-tree-row')
    .filter({ has: page.getByRole('button', { name: 'Общий заказ', exact: true }) });
  await expect(row).toBeVisible();
  const dt = await page.evaluateHandle(() => new DataTransfer());
  const objectId = await row.getAttribute('data-object-id');
  await page.evaluate(({ dt, id }) => dt.setData('application/maket-object', id!), {
    dt,
    id: objectId,
  });
  await page
    .locator('.flow-container')
    .dispatchEvent('drop', { dataTransfer: dt, clientX: 800, clientY: 300 });
  await expect(page.locator('.react-flow__node-notation')).toHaveCount(1);
  await row.getByRole('button', { name: 'Разместить Общий заказ', exact: true }).click();
  await expect(page.locator('.react-flow__node-notation')).toHaveCount(2);
  await expect(row.locator('.badge')).toHaveText('2');
  const first = page.locator('.react-flow__node-notation').first();
  await first.dblclick();
  await page.getByLabel('Текст объекта', { exact: true }).fill('Местная подпись');
  await page.getByLabel('Текст объекта', { exact: true }).press('Enter');
  await expect(page.locator('.inspector-type strong')).toHaveText('Местная подпись');
  await expect(page.locator('.inspector').getByLabel('Название', { exact: false })).toHaveValue(
    'Местная подпись',
  );
  await row.getByRole('button', { name: 'Изменить объект Общий заказ', exact: true }).click();
  await page.getByLabel('Имя объекта', { exact: true }).fill('Новое общее имя');
  await page.getByRole('button', { name: 'Сохранить объект', exact: true }).click();
  await expect(first.locator('.node-label')).toHaveText('Местная подпись');
  await expect(page.locator('.inspector-type strong')).toHaveText('Местная подпись');
  await expect(page.locator('.inspector').getByLabel('Название', { exact: false })).toHaveValue(
    'Местная подпись',
  );
  await expect(page.locator('.model-object-summary strong')).toHaveText('Новое общее имя');
  await expect(page.locator('.react-flow__node-notation').nth(1).locator('.node-label')).toHaveText(
    'Новое общее имя',
  );
  const beforeSkin = await first.boundingBox();
  await first.click();
  const doc = (await (await request.get(`/api/diagrams/${d.id}`)).json()).document;
  await page
    .getByLabel('Отображение объекта', { exact: true })
    .selectOption(`${doc.bindings[0].id}:event`);
  await expect(first.locator('.node-label')).toHaveText('Местная подпись');
  expect((await first.boundingBox())!.width).toBeCloseTo(beforeSkin!.width, 0);
  expect((await first.boundingBox())!.height).toBeCloseTo(beforeSkin!.height, 0);
  await expect(page.getByText(/Сохранено · ревизия/)).toBeVisible({ timeout: 15000 });
  await page.reload();
  await expect(page.locator('.react-flow__node-notation')).toHaveCount(2);
  expect(
    (await (await request.get(`/api/diagrams/${d.id}`)).json()).document.nodes[0].objectId,
  ).toBe(objectId);
  await first.click();
  const caption = page.locator('.inspector').getByLabel('Название', { exact: false });
  await expect(caption).toHaveValue('Местная подпись');
  await caption.fill('Подпись из свойств');
  await expect(first.locator('.node-label')).toHaveText('Подпись из свойств');
  await expect(page.locator('.inspector-type strong')).toHaveText('Подпись из свойств');
  await page.getByRole('button', { name: 'Сбросить локальную подпись', exact: true }).click();
  await expect(caption).toHaveValue('Новое общее имя');
  await expect(first.locator('.node-label')).toHaveText('Новое общее имя');
});
test('browser: cross-notation skin preview maps ports, preserves the edge and commits shared attributes once', async ({
  page,
  request,
}) => {
  await login(request, page);
  const notation = structuredClone(builtinNotation);
  notation.id = 'skin-test';
  notation.name = 'Другая оболочка';
  for (const t of notation.nodeTypes) {
    for (const p of t.ports) {
      if (p.id === 'in') p.id = 'receive';
      if (p.id === 'out') p.id = 'emit';
    }
  }
  for (const r of notation.connectionRules) {
    if (r.source.port === 'out') r.source.port = 'emit';
    if (r.target.port === 'in') r.target.port = 'receive';
  }
  notation.nodeTypes
    .find((t) => t.id === 'process')!
    .properties.push(
      {
        key: 'automated',
        label: 'Авторабота',
        scope: 'object',
        type: 'boolean',
        required: false,
        default: false,
      },
      {
        key: 'owner',
        label: 'Исполнитель',
        scope: 'object',
        type: 'string',
        required: false,
        default: '',
      },
    );
  const nr = await request.post('/api/notations', { data: notation });
  expect(nr.status()).toBe(201);
  const n = await nr.json();
  let d = await create(request);
  d = await place(request, d);
  d = await place(request, d, d.document.nodes[0].objectId);
  const doc = structuredClone(d.document);
  doc.edges.push({
    id: 'edge',
    bindingId: doc.bindings[0].id,
    typeId: 'flow',
    source: doc.nodes[0].id,
    target: doc.nodes[1].id,
    sourcePort: 'out',
    targetPort: 'in',
    properties: { label: 'Связь' },
  });
  d = await save(request, d, doc);
  d = await (
    await request.post(`/api/diagrams/${d.id}/notations`, {
      data: { revision: d.revision, notationId: n.id },
    })
  ).json();
  await page.goto(`/diagrams/${d.id}`);
  await expect(page.getByRole('region', { name: 'Палитра Другая оболочка' })).toBeVisible();
  const first = page.locator('.react-flow__node-notation').first();
  await first.click();
  await page
    .getByLabel('Отображение объекта', { exact: true })
    .selectOption(`${d.document.bindings[1].id}:process`);
  const dialog = page.getByRole('dialog', { name: 'Изменить отображение объекта' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Предпросмотр нового отображения')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Применить отображение' })).toBeDisabled();
  await dialog
    .getByLabel('Отображение связи edge', { exact: true })
    .selectOption('universal:association');
  await dialog.getByLabel('Выходной порт edge', { exact: true }).selectOption('emit');
  await dialog.getByRole('button', { name: 'Применить отображение' }).click();
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await page.getByLabel('Авторабота', { exact: false }).check();
  await expect(first.locator('[data-property="automated"]')).toContainText('Да');
  const patches: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'PATCH' && r.url().endsWith(`/objects/${d.document.nodes[0].objectId}`))
      patches.push(r.url());
  });
  await page.getByLabel('Исполнитель', { exact: false }).fill('Анна');
  await page.getByLabel('Исполнитель', { exact: false }).press('Tab');
  await expect(first.locator('[data-property="owner"]')).toContainText('Анна');
  expect(patches).toHaveLength(1);
  await expect(page.getByText(/Сохранено · ревизия/)).toBeVisible({ timeout: 15000 });
  await page.reload();
  await expect(first.locator('[data-property="automated"]')).toContainText('Да');
  await expect(first.locator('[data-property="owner"]')).toContainText('Анна');
  const persisted: ModelDiagram = await (await request.get(`/api/diagrams/${d.id}`)).json();
  expect(persisted.document.edges[0]).toMatchObject({
    bindingId: null,
    typeId: 'association',
    sourcePort: 'emit',
    targetPort: 'in',
  });
  expect(persisted.document.nodes[0].objectId).toBe(persisted.document.nodes[1].objectId);
});
test('browser: mandatory local and shared properties are collected before atomic placement', async ({
  request,
  page,
}) => {
  await login(request, page);
  const n = structuredClone(builtinNotation);
  n.id = 'mandatory';
  n.name = 'Обязательные поля';
  n.nodeTypes
    .find((t) => t.id === 'process')!
    .properties.push(
      { key: 'reference', label: 'Локальный код', type: 'string', required: true },
      {
        key: 'owner',
        label: 'Общий владелец',
        type: 'string',
        scope: 'object',
        required: true,
        default: '',
      },
    );
  const notation = await (await request.post('/api/notations', { data: n })).json();
  let d = await create(request);
  d = await (
    await request.post(`/api/diagrams/${d.id}/notations`, {
      data: { revision: d.revision, notationId: notation.id },
    })
  ).json();
  const invalid = await request.post(`/api/diagrams/${d.id}/representations`, {
    data: {
      revision: d.revision,
      bindingId: d.document.bindings[1].id,
      typeId: 'process',
      position: { x: 0, y: 0 },
    },
  });
  expect(invalid.status()).toBe(400);
  expect(
    (await (await request.get('/api/model')).json()).objects.filter(
      (o: ModelObject) => o.kind !== 'diagram',
    ),
  ).toHaveLength(0);
  await page.goto(`/diagrams/${d.id}`);
  await page
    .getByRole('region', { name: 'Палитра Обязательные поля' })
    .getByRole('button', { name: 'Процесс', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Свойства перед размещением' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Локальный код', { exact: true }).fill('R1');
  await dialog.getByLabel('Общий владелец', { exact: false }).fill('Анна');
  await dialog.getByRole('button', { name: 'Разместить объект', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('.react-flow__node-notation')).toHaveCount(1);
  await expect(page.locator('[data-property="reference"]')).toContainText('R1');
  const current: ModelDiagram = await (await request.get(`/api/diagrams/${d.id}`)).json();
  expect(current.document.objects[0].attributes.owner).toBe('Анна');
  expect(current.document.objects[0].revision).toBe(1);
  expect(current.document.nodes[0].properties.reference).toBe('R1');
  expect(current.document.nodes[0].properties.owner).toBeUndefined();
  const existing = await object(request, 'Существующий');
  await page.getByRole('button', { name: 'Обновить модель', exact: true }).click();
  await page.getByRole('button', { name: 'Разместить Существующий', exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Локальный код', { exact: true }).fill('R2');
  await dialog.getByLabel('Общий владелец', { exact: false }).fill('Борис');
  await dialog.getByRole('button', { name: 'Разместить объект', exact: true }).click();
  await expect(page.locator('.react-flow__node-notation')).toHaveCount(2);
  const updated: ModelObject = await (await request.get(`/api/objects/${existing.id}`)).json();
  expect(updated.attributes.owner).toBe('Борис');
  expect(updated.revision).toBe(2);
});
test('object deletion checks ownership, revisions, children and usage; history recreates deleted objects', async ({
  request,
  playwright,
}) => {
  await login(request);
  expect(
    (await (await request.get('/api/model')).json()).objects.filter(
      (o: ModelObject) => o.kind !== 'diagram',
    ),
  ).toHaveLength(0);
  let d = await create(request);
  expect(
    (await (await request.get('/api/model')).json()).objects.filter(
      (o: ModelObject) => o.kind !== 'diagram',
    ),
  ).toHaveLength(0);
  const parent = await object(request, 'Родитель'),
    child = await object(request, 'Удаляемый', parent.id);
  expect(
    (await request.delete(`/api/objects/${parent.id}`, { data: { revision: 1 } })).status(),
  ).toBe(409);
  d = await place(request, d, child.id);
  const historyNumber = d.revision;
  expect(
    (await request.delete(`/api/objects/${child.id}`, { data: { revision: 1 } })).status(),
  ).toBe(409);
  d = await save(request, d, { ...d.document, nodes: [], edges: [], objects: [] });
  expect(
    (await request.delete(`/api/objects/${child.id}`, { data: { revision: 2 } })).status(),
  ).toBe(409);
  const other = await playwright.request.newContext({ baseURL: 'http://localhost:3000' });
  await login(other);
  expect((await other.delete(`/api/objects/${child.id}`, { data: { revision: 1 } })).status()).toBe(
    404,
  );
  await other.dispose();
  expect(
    (await request.delete(`/api/objects/${child.id}`, { data: { revision: 1 } })).status(),
  ).toBe(200);
  expect((await request.get(`/api/objects/${child.id}`)).status()).toBe(404);
  expect(
    (await (await request.get('/api/model')).json()).objects.filter(
      (o: ModelObject) => o.kind !== 'diagram',
    ),
  ).toHaveLength(1);
  const historical = await (
    await request.get(`/api/diagrams/${d.id}/history?number=${historyNumber}`)
  ).json();
  expect(historical.document.objects.find((o: ModelObject) => o.id === child.id).name).toBe(
    'Удаляемый',
  );
  const restored = await request.post(`/api/diagrams/${d.id}/restore`, {
    data: { revision: d.revision, number: historyNumber },
  });
  expect(restored.status(), await restored.text()).toBe(200);
  expect((await restored.json()).document.nodes[0].objectId).toBe(child.id);
  const recreated = await (await request.get(`/api/objects/${child.id}`)).json();
  expect(recreated.incarnation).toBeTruthy();
  expect(recreated.incarnation).not.toBe(child.incarnation);
  expect(
    (
      await request.patch(`/api/objects/${child.id}`, {
        data: { revision: 1, incarnation: child.incarnation, name: 'Устаревшее изменение' },
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await request.delete(`/api/objects/${child.id}`, {
        data: { revision: 1, incarnation: child.incarnation },
      })
    ).status(),
  ).toBe(409);

  const raceObject = await object(request, 'Параллельное удаление'),
    raceDiagram = await create(request);
  const attempts = await Promise.all([
    request.delete(`/api/objects/${raceObject.id}`, { data: { revision: 1 } }),
    request.post(`/api/diagrams/${raceDiagram.id}/representations`, {
      data: {
        revision: 1,
        bindingId: raceDiagram.document.bindings[0].id,
        typeId: 'process',
        objectId: raceObject.id,
        position: { x: 0, y: 0 },
      },
    }),
  ]);
  expect([
    [200, 404],
    [409, 201],
  ]).toContainEqual(attempts.map((r) => r.status()));
});
test('browser: delete an unused tree object, including saving removal of its representation first', async ({
  request,
  page,
}) => {
  await login(request, page);
  let d = await create(request);
  const o = await object(request, 'Удалить из дерева');
  d = await place(request, d, o.id);
  await page.goto(`/diagrams/${d.id}`);
  await expect(page.locator('.react-flow__node-notation')).toHaveCount(1);
  const treeRow = page.locator(`.object-tree-row[data-object-id="${o.id}"]`);
  page.on('dialog', (dialog) => dialog.accept());
  await treeRow
    .getByRole('button', { name: 'Удалить объект Удалить из дерева', exact: true })
    .click();
  await expect(page.locator('.object-panel [role="alert"]')).toContainText('используется');
  await expect(treeRow).toBeVisible();
  await page.locator('.react-flow__node-notation').click();
  await page.getByRole('button', { name: 'Удалить элемент', exact: true }).click();
  await expect(page.locator('.react-flow__node-notation')).toHaveCount(0);
  await treeRow
    .getByRole('button', { name: 'Удалить объект Удалить из дерева', exact: true })
    .click();
  await expect(treeRow).toHaveCount(0);
  await expect(page.locator('[role="treeitem"]')).toHaveCount(1);
  expect((await request.get(`/api/objects/${o.id}`)).status()).toBe(404);
  await page.reload();
  await expect(page.locator('[role="treeitem"]')).toHaveCount(1);
  await expect(page.locator(`[data-object-id="${d.entityId}"]`)).toContainText('Диаграмма');
});

test('browser: draw a connection between representations in a secondary notation', async ({
  request,
  page,
}) => {
  await login(request, page);
  const uml = structuredClone(builtinNotation);
  uml.id = 'uml-test';
  uml.name = 'UML тест';
  uml.edgeTypes[0].id = 'association';
  uml.edgeTypes[0].name = 'Ассоциация UML';
  for (const t of uml.nodeTypes)
    for (const p of t.ports) {
      if (p.id === 'in') p.id = 'uml-in';
      if (p.id === 'out') p.id = 'uml-out';
    }
  for (const r of uml.connectionRules) {
    r.edgeType = 'association';
    if (r.source.port === 'out') r.source.port = 'uml-out';
    if (r.target.port === 'in') r.target.port = 'uml-in';
  }
  uml.edgeTypes.push({ ...uml.edgeTypes[0], id: 'dependency', name: 'Зависимость UML' });
  uml.connectionRules.push(...uml.connectionRules.map((r) => ({ ...r, edgeType: 'dependency' })));
  const nr = await request.post('/api/notations', { data: uml });
  expect(nr.status()).toBe(201);
  const notation = await nr.json();
  let d = await create(request);
  d = await (
    await request.post(`/api/diagrams/${d.id}/notations`, {
      data: { revision: d.revision, notationId: notation.id },
    })
  ).json();
  const binding = d.document.bindings[1];
  d = await place(request, d, undefined, binding.id);
  d = await place(request, d, undefined, binding.id);
  d = await place(request, d);
  d = await save(request, d, {
    ...d.document,
    nodes: d.document.nodes.map((n, i) => ({
      ...n,
      position: { x: i === 1 ? 250 : i === 2 ? 125 : 0, y: i === 2 ? 200 : 0 },
    })),
  });
  await page.goto(`/diagrams/${d.id}`);
  await expect(page.locator('.react-flow__node-notation')).toHaveCount(3);
  const chooser = page.getByRole('combobox', { name: 'Тип связи', exact: true });
  await expect(chooser.locator('optgroup[label="UML тест"] option')).toHaveCount(2);
  await page.locator('.react-flow__controls-fitview').click();
  const source = page.locator(
    `[data-id="${d.document.nodes[0].id}"] .source[data-handleid="uml-out"]`,
  );
  const target = page.locator(
    `[data-id="${d.document.nodes[1].id}"] .target[data-handleid="uml-in"]`,
  );
  const a = (await source.boundingBox())!,
    b = (await target.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 20 });
  await page.mouse.up();
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await expect(chooser).toHaveValue(`${binding.id}:association`);
  await expect(page.getByText(/Сохранено · ревизия/)).toBeVisible({ timeout: 15000 });
  const saved = await (await request.get(`/api/diagrams/${d.id}`)).json();
  expect(saved.document.edges[0]).toMatchObject({
    bindingId: binding.id,
    typeId: 'association',
    sourcePort: 'uml-out',
    targetPort: 'uml-in',
  });
  await page.reload();
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await chooser.selectOption(`${binding.id}:dependency`);
  async function connect(from: string, to: string, sourcePort: string, targetPort: string) {
    await page.locator('.react-flow__controls-fitview').click();
    const source = page.locator(`[data-id="${from}"] .source[data-handleid="${sourcePort}"]`);
    const target = page.locator(`[data-id="${to}"] .target[data-handleid="${targetPort}"]`);
    const a = (await source.boundingBox())!,
      b = (await target.boundingBox())!;
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 20 });
    await page.mouse.up();
  }
  await connect(d.document.nodes[1].id, d.document.nodes[0].id, 'uml-out', 'uml-in');
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);
  await expect(chooser).toHaveValue(`${binding.id}:dependency`);
  await expect(page.getByText(/Сохранено · ревизия/)).toBeVisible({ timeout: 15000 });
  const dependency = await (await request.get(`/api/diagrams/${d.id}`)).json();
  expect(dependency.document.edges[1]).toMatchObject({
    bindingId: binding.id,
    typeId: 'dependency',
  });
  await connect(d.document.nodes[1].id, d.document.nodes[2].id, 'uml-out', 'in');
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);
  await expect(
    page.getByText('Соединение запрещено правилами нотации', { exact: true }),
  ).toBeVisible();
  const notice = page.locator('.connection-toast');
  await notice.getByRole('button', { name: 'Закрыть уведомление' }).click();
  await expect(notice).toHaveCount(0);
  await connect(d.document.nodes[1].id, d.document.nodes[2].id, 'uml-out', 'in');
  await expect(notice).toBeVisible();
  await expect(notice).toHaveCount(0, { timeout: 5000 });
  await chooser.selectOption('universal:association');
  await connect(d.document.nodes[1].id, d.document.nodes[2].id, 'uml-out', 'in');
  await expect(page.locator('.react-flow__edge')).toHaveCount(3);
  await expect(chooser).toHaveValue('universal:association');
});

test('relation model: shared arrows, independent copies, ownership, snapshots and restoration', async ({
  request,
  playwright,
}) => {
  await login(request);
  const source = await object(request, 'Заказ'),
    target = await object(request, 'Исполнитель');
  let d = await create(request);
  d = await place(request, d, source.id);
  d = await place(request, d, target.id);
  d = await place(request, d, source.id);
  const created = await request.post('/api/relations', {
    data: {
      name: 'Участие',
      sourceId: source.id,
      targetId: target.id,
      attributes: { role: 'owner' },
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  let relation = await created.json();
  const copyResponse = await request.post('/api/relations', {
    data: {
      name: 'Копия участия',
      sourceId: source.id,
      targetId: target.id,
      attributes: { role: 'owner' },
      copyOf: relation.id,
    },
  });
  expect(copyResponse.status()).toBe(201);
  const copiedRelation = await copyResponse.json();
  expect(copiedRelation.copiedFrom).toEqual({ id: relation.id, name: 'Участие' });
  const edge = (id: string, node: string) => ({
    id,
    relationId: relation.id,
    bindingId: d.document.bindings[0].id,
    typeId: 'flow',
    source: node,
    target: d.document.nodes[1].id,
    sourcePort: 'out',
    targetPort: 'in',
    properties: { label: id },
  });
  d = await save(request, d, {
    ...d.document,
    relations: [relation],
    edges: [edge('first', d.document.nodes[0].id), edge('second', d.document.nodes[2].id)],
  });
  const historyNumber = d.revision;
  expect((await (await request.get(`/api/relations/${relation.id}/usages`)).json())[0].count).toBe(
    2,
  );
  expect(
    (await request.delete(`/api/relations/${relation.id}`, { data: { revision: 1 } })).status(),
  ).toBe(409);
  const duplicate = await (
    await request.post(`/api/diagrams/${d.id}/duplicate`, { data: {} })
  ).json();
  expect(duplicate.document.edges.map((e: { relationId: string }) => e.relationId)).toEqual([
    relation.id,
    relation.id,
  ]);
  const imported = await request.post('/api/diagrams', {
    data: { name: 'Клон модели', document: d.document },
  });
  expect(imported.status(), await imported.text()).toBe(201);
  const clone = await imported.json();
  expect(clone.document.relations).toHaveLength(1);
  expect(clone.document.relations[0].id).not.toBe(relation.id);
  expect(clone.document.edges[0].relationId).toBe(clone.document.edges[1].relationId);
  expect(clone.document.relations[0]).toMatchObject({
    sourceId: clone.document.nodes[0].objectId,
    targetId: clone.document.nodes[1].objectId,
    copiedFrom: { id: relation.id, name: relation.name },
  });
  relation = await (
    await request.patch(`/api/relations/${relation.id}`, {
      data: { revision: 1, name: 'Ответственный', attributes: { role: 'lead' } },
    })
  ).json();
  expect(relation.revision).toBe(2);
  expect(
    (
      await request.put(`/api/diagrams/${d.id}`, {
        data: { revision: d.revision, document: d.document },
      })
    ).status(),
  ).toBe(409);
  const live = await (await request.get(`/api/diagrams/${d.id}`)).json();
  expect(live.document.relations[0].name).toBe('Ответственный');
  expect(
    live.document.edges.map((e: { properties: { label: string } }) => e.properties.label),
  ).toEqual(['first', 'second']);
  const historical = await (
    await request.get(`/api/diagrams/${d.id}/history?number=${historyNumber}`)
  ).json();
  expect(historical.document.relations[0].name).toBe('Участие');
  const invalid = structuredClone(live.document);
  invalid.edges[0].target = invalid.nodes[0].id;
  expect(
    (
      await request.put(`/api/diagrams/${d.id}`, {
        data: { revision: d.revision, document: invalid },
      })
    ).status(),
  ).toBe(400);
  const other = await playwright.request.newContext({ baseURL: 'http://localhost:3000' });
  await login(other);
  expect((await other.get(`/api/relations/${relation.id}`)).status()).toBe(404);
  expect(
    (
      await other.patch(`/api/relations/${relation.id}`, { data: { revision: 2, name: 'Чужая' } })
    ).status(),
  ).toBe(404);
  expect(
    (await other.delete(`/api/relations/${relation.id}`, { data: { revision: 2 } })).status(),
  ).toBe(404);
  expect(
    (
      await other.post('/api/relations', {
        data: { name: 'Чужая', sourceId: source.id, targetId: target.id },
      })
    ).status(),
  ).toBe(404);
  expect(
    (
      await other.post('/api/objects', { data: { name: 'Чужая копия', copyOf: source.id } })
    ).status(),
  ).toBe(404);
  await other.dispose();
  relation = await (
    await request.patch(`/api/relations/${relation.id}`, { data: { revision: 2, archived: true } })
  ).json();
  d = await (await request.get(`/api/diagrams/${d.id}`)).json();
  const archivedImport = await request.post('/api/diagrams', {
    data: { name: 'Импорт архивной связи', document: d.document },
  });
  expect(archivedImport.status(), await archivedImport.text()).toBe(201);
  expect((await archivedImport.json()).document.relations[0].archived).toBe(true);
  const more = structuredClone(d.document);
  more.edges.push({ ...more.edges[0], id: 'third' });
  expect(
    (
      await request.put(`/api/diagrams/${d.id}`, { data: { revision: d.revision, document: more } })
    ).status(),
  ).toBe(400);
  d = await save(request, d, { ...d.document, edges: [] });
  expect(
    (await request.delete(`/api/objects/${source.id}`, { data: { revision: 1 } })).status(),
  ).toBe(409);
  expect(
    (await request.delete(`/api/relations/${relation.id}`, { data: { revision: 3 } })).status(),
  ).toBe(409); // another diagram still uses it
  expect((await request.delete(`/api/diagrams/${duplicate.id}`)).status()).toBe(200);
  expect(
    (await request.delete(`/api/relations/${relation.id}`, { data: { revision: 2 } })).status(),
  ).toBe(409);
  expect(
    (await request.delete(`/api/relations/${relation.id}`, { data: { revision: 3 } })).status(),
  ).toBe(200);
  const retainedCopy = await (await request.get(`/api/relations/${copiedRelation.id}`)).json();
  expect(retainedCopy).toMatchObject({
    name: 'Копия участия',
    archived: false,
    copiedFrom: { id: relation.id, name: 'Участие' },
  });
  expect(
    (
      await request.delete(`/api/relations/${copiedRelation.id}`, { data: { revision: 1 } })
    ).status(),
  ).toBe(200);
  d = await save(request, d, { ...d.document, nodes: [], edges: [], objects: [], relations: [] });
  expect(
    (await request.delete(`/api/objects/${source.id}`, { data: { revision: 1 } })).status(),
  ).toBe(200);
  expect(
    (await request.delete(`/api/objects/${target.id}`, { data: { revision: 1 } })).status(),
  ).toBe(200);
  const restored = await request.post(`/api/diagrams/${d.id}/restore`, {
    data: { revision: d.revision, number: historyNumber },
  });
  expect(restored.status(), await restored.text()).toBe(200);
  const restoredDiagram = await restored.json();
  expect(restoredDiagram.document.relations[0]).toMatchObject({
    id: relation.id,
    sourceId: source.id,
    targetId: target.id,
    name: 'Участие',
  });
  expect(restoredDiagram.document.edges.map((e: { relationId: string }) => e.relationId)).toEqual([
    relation.id,
    relation.id,
  ]);
  expect(restoredDiagram.document.relations[0].incarnation).not.toBe(relation.incarnation);
  const origin = await object(request, 'Оригинал');
  const copied = await (
    await request.post('/api/objects', { data: { name: 'Копия', copyOf: origin.id } })
  ).json();
  expect(copied.copiedFrom).toEqual({ id: origin.id, name: 'Оригинал' });
  await request.patch(`/api/objects/${origin.id}`, { data: { revision: 1, name: 'Переименован' } });
  expect((await (await request.get(`/api/objects/${copied.id}`)).json()).name).toBe('Копия');
  expect(
    (await request.delete(`/api/objects/${origin.id}`, { data: { revision: 2 } })).status(),
  ).toBe(200);
  expect((await (await request.get(`/api/objects/${copied.id}`)).json()).copiedFrom).toEqual({
    id: origin.id,
    name: 'Оригинал',
  });
});

test('legacy v2 arrows are migrated once into independent model relations', async ({ request }) => {
  await login(request);
  let d = await create(request);
  d = await place(request, d);
  d = await place(request, d);
  const old = {
    ...d.document,
    edges: [
      {
        id: 'old-arrow',
        bindingId: d.document.bindings[0].id,
        typeId: 'flow',
        source: d.document.nodes[0].id,
        target: d.document.nodes[1].id,
        sourcePort: 'out',
        targetPort: 'in',
        properties: { label: 'Старая связь' },
      },
    ],
  } as Partial<ModelDocument>;
  delete old.relations;
  await db.diagram.update({ where: { id: d.id }, data: { document: old as object } });
  await db.diagramRevision.update({
    where: { diagramId_number: { diagramId: d.id, number: d.revision } },
    data: { document: old as object },
  });
  const migrated = await (await request.get(`/api/diagrams/${d.id}`)).json();
  expect(migrated.revision).toBe(d.revision + 1);
  expect(migrated.document.relations[0].name).toBe('Старая связь');
  const id = migrated.document.edges[0].relationId;
  expect((await (await request.get(`/api/diagrams/${d.id}`)).json()).revision).toBe(
    migrated.revision,
  );
  expect((await (await request.get('/api/model')).json()).relations).toHaveLength(1);
  const restored = await request.post(`/api/diagrams/${d.id}/restore`, {
    data: { revision: migrated.revision, number: d.revision },
  });
  expect(restored.status(), await restored.text()).toBe(200);
  expect((await restored.json()).document.edges[0].relationId).toBe(id);
});

test('browser: relation explorer, nested references, shared arrow placement and copy provenance', async ({
  page,
  request,
}) => {
  await login(request, page);
  const source = await object(request, 'Заказ'),
    target = await object(request, 'Исполнитель');
  let d = await create(request);
  d = await place(request, d, source.id);
  d = await place(request, d, target.id);
  await page.goto(`/diagrams/${d.id}`);
  await expect(page.locator('.react-flow__node-notation')).toHaveCount(2);
  await page.getByRole('button', { name: 'Создать связь модели', exact: true }).click();
  await page.getByLabel('Имя связи', { exact: true }).fill('Ответственность');
  await page.getByLabel('Источник связи', { exact: true }).selectOption(source.id);
  await page.getByLabel('Назначение связи', { exact: true }).selectOption(target.id);
  await page.getByRole('button', { name: 'Сохранить связь', exact: true }).click();
  await expect(page.locator('[data-model-relation-id]')).toHaveCount(1);
  const relation = (await (await request.get('/api/model')).json()).relations[0];
  const row = page.locator(`[data-model-relation-id="${relation.id}"]`);
  await expect(row).toBeVisible();
  await expect(page.locator(`[data-relation-reference="${relation.id}"]`)).toHaveCount(2);
  for (let i = 0; i < 2; i++) {
    await row
      .getByRole('button', { name: 'Разместить связь Ответственность', exact: true })
      .click();
    await page.getByRole('button', { name: 'Разместить стрелку', exact: true }).click();
    await expect(page.locator('.react-flow__edge')).toHaveCount(i + 1);
    await expect(page.getByText(/Сохранено · ревизия/)).toBeVisible({ timeout: 15000 });
  }
  const saved = await (await request.get(`/api/diagrams/${d.id}`)).json();
  expect(saved.document.edges.map((e: { relationId: string }) => e.relationId)).toEqual([
    relation.id,
    relation.id,
  ]);
  await row.getByRole('button', { name: 'Изменить связь Ответственность', exact: true }).click();
  await page.getByLabel('Имя связи', { exact: true }).fill('Владелец заказа');
  await page.getByRole('button', { name: 'Сохранить связь', exact: true }).click();
  await expect(row.locator('.object-tree-name')).toContainText('Владелец заказа');
  await expect(page.locator(`[data-relation-reference="${relation.id}"]`)).toHaveCount(2);
  const sourceRow = page.locator(`[data-object-id="${source.id}"]`);
  await sourceRow.getByRole('button', { name: 'Копировать объект Заказ', exact: true }).click();
  await expect(page.locator('.object-tree-row[data-object-id]')).toHaveCount(4);
  const copied = (await (await request.get('/api/model')).json()).objects.find(
    (o: ModelObject) => o.copiedFrom?.id === source.id,
  );
  await page
    .locator(`[data-object-id="${copied.id}"]`)
    .getByRole('button', { name: 'Изменить объект Заказ — копия', exact: true })
    .click();
  await expect(page.locator('.copy-origin')).toContainText('Заказ');
  await expect(page.locator('.copy-origin')).toContainText(source.id);
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  page.on('dialog', (dialog) => dialog.accept());
  await row
    .getByRole('button', { name: 'Удалить связь модели Владелец заказа', exact: true })
    .click();
  await expect(page.locator('.relation-browser [role="alert"]')).toContainText('используется');
  for (let i = 1; i >= 0; i--) {
    await row.getByRole('button', { name: 'Найти связь Владелец заказа', exact: true }).click();
    await page.getByRole('button', { name: 'Удалить связь', exact: true }).click();
    await expect(page.locator('.react-flow__edge')).toHaveCount(i);
  }
  await row
    .getByRole('button', { name: 'Удалить связь модели Владелец заказа', exact: true })
    .click();
  await expect(row).toHaveCount(0);
  await expect(page.locator(`[data-relation-reference="${relation.id}"]`)).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.react-flow__edge')).toHaveCount(0);
  await expect(page.locator('[data-model-relation-id]')).toHaveCount(0);
});

test('browser: drag arrows between different model objects and their aliases', async ({
  page,
  request,
}) => {
  await login(request, page);
  const source = await object(request, 'Первый объект'),
    target = await object(request, 'Второй объект', source.id);
  let d = await create(request);
  d = await place(request, d, source.id, d.document.bindings[0].id, 'decision');
  d = await place(request, d, target.id, d.document.bindings[0].id, 'event');
  d = await place(request, d, source.id);
  d = await place(request, d, target.id);
  d = await save(request, d, {
    ...d.document,
    nodes: d.document.nodes.map((n, i) => ({
      ...n,
      position: { x: (i % 2) * 250, y: i < 2 ? 0 : 180 },
    })),
  });
  await page.goto(`/diagrams/${d.id}`);
  await expect(page.locator('.react-flow__node-notation')).toHaveCount(4);
  for (const [index, [from, to, port]] of (
    [
      [0, 1, 'yes'],
      [2, 3, 'out'],
      [0, 2, 'no'],
    ] as const
  ).entries()) {
    await page.locator('.react-flow__controls-fitview').click();
    const a = (await page
      .locator(`[data-id="${d.document.nodes[from].id}"] .source[data-handleid="${port}"]`)
      .boundingBox())!;
    const b = (await page
      .locator(`[data-id="${d.document.nodes[to].id}"] .target[data-handleid="in"]`)
      .boundingBox())!;
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 20 });
    await page.mouse.up();
    await expect(page.locator('.react-flow__edge')).toHaveCount(index + 1);
    await expect(page.getByText(/Сохранено · ревизия/)).toBeVisible({ timeout: 15000 });
    await page.reload();
    await expect(page.locator('.react-flow__edge')).toHaveCount(index + 1);
  }
  const saved = await (await request.get(`/api/diagrams/${d.id}`)).json();
  expect(saved.document.relations).toHaveLength(3);
  expect(
    saved.document.relations.filter(
      (r: { sourceId: string; targetId: string }) =>
        r.sourceId === source.id && r.targetId === target.id,
    ),
  ).toHaveLength(2);
  await page.reload();
  await expect(page.locator('.react-flow__edge')).toHaveCount(3);
});

test('browser: return a tree arrow, nest objects under it and connect objects to arrows', async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  await login(request, page);
  const a = await object(request, 'Источник'),
    b = await object(request, 'Назначение'),
    c = await object(request, 'Комментарий');
  let d = await create(request);
  for (const o of [a, b, c]) d = await place(request, d, o.id);
  d = await save(request, d, {
    ...d.document,
    nodes: d.document.nodes.map((n, i) => ({
      ...n,
      position: { x: i === 1 ? 300 : 0, y: i === 2 ? 220 : 0 },
    })),
    edges: [
      {
        id: 'primary',
        bindingId: d.document.bindings[0].id,
        typeId: 'flow',
        source: d.document.nodes[0].id,
        target: d.document.nodes[1].id,
        sourcePort: 'out',
        targetPort: 'in',
        properties: { label: '' },
      },
    ],
  });
  const primary = d.document.relations![0];
  d = await save(request, d, {
    ...d.document,
    edges: d.document.edges.map((e) => ({ ...e, properties: { label: 'Подпись стрелки' } })),
  });
  await page.goto(`/diagrams/${d.id}`);
  await expect(page.locator('.react-flow__node-notation')).toHaveCount(3);
  const caption = page.getByText('Подпись стрелки', { exact: true });
  await expect(caption).toBeVisible();
  const textBounds = (await caption.boundingBox())!;
  const connectorBounds = (await page
    .locator('[data-id="primary"] .relation-anchor')
    .boundingBox())!;
  expect(connectorBounds.y).toBeGreaterThan(textBounds.y + textBounds.height);
  async function connect(from: string, to: string, fromPort = 'out', toPort = 'in') {
    await page.locator('.react-flow__controls-fitview').click();
    const a = (await page
      .locator(`[data-id="${from}"] .react-flow__handle[data-handleid="${fromPort}"]`)
      .boundingBox())!;
    const b = (await page
      .locator(`[data-id="${to}"] .react-flow__handle[data-handleid="${toPort}"]`)
      .boundingBox())!;
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 20 });
    await page.mouse.up();
    await expect(page.getByText(/Сохранено · ревизия/)).toBeVisible({ timeout: 15000 });
  }
  await connect(d.document.nodes[2].id, 'primary', 'out', 'out');
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);
  d = await (await request.get(`/api/diagrams/${d.id}`)).json();
  const secondary = d.document.edges[1];
  expect(d.document.relations!.find((r) => r.id === secondary.relationId)).toMatchObject({
    sourceId: c.id,
    targetId: primary.id,
  });
  await connect('primary', secondary.id, 'in', 'out');
  await expect(page.locator('.react-flow__edge')).toHaveCount(3);
  d = await (await request.get(`/api/diagrams/${d.id}`)).json();
  const tertiary = d.document.edges[2];
  expect(d.document.relations!.find((r) => r.id === tertiary.relationId)).toMatchObject({
    sourceId: primary.id,
    targetId: secondary.relationId,
  });
  const primaryRow = page.locator(`[data-model-relation-id="${primary.id}"]`);
  await primaryRow
    .getByRole('button', { name: 'Создать дочерний объект связи Переход', exact: true })
    .click();
  await page.getByLabel('Имя объекта', { exact: true }).fill('Деталь связи');
  await page.getByRole('button', { name: 'Сохранить объект', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Создать объект', exact: true })).toHaveCount(0);
  const child = (await (await request.get('/api/model')).json()).objects.find(
    (o: ModelObject) => o.name === 'Деталь связи',
  );
  expect(child.parentId).toBe(primary.id);
  expect(
    (
      await request.patch(`/api/relations/${primary.id}`, {
        data: { revision: primary.revision, parentId: child.id },
      })
    ).status(),
  ).toBe(400);
  await primaryRow.getByRole('button', { name: 'Найти связь Переход', exact: true }).click();
  await page.getByRole('button', { name: 'Удалить связь', exact: true }).click();
  await expect(page.locator('.react-flow__edge')).toHaveCount(0);
  await expect(page.getByText(/Сохранено · ревизия/)).toBeVisible({ timeout: 15000 });
  await page
    .locator(`[data-relation-reference="${primary.id}"]`)
    .first()
    .getByRole('button', { name: 'Вернуть представление связи Переход', exact: true })
    .click();
  await page.getByRole('button', { name: 'Разместить стрелку', exact: true }).click();
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  for (const relationId of [secondary.relationId, tertiary.relationId]) {
    await page
      .locator(`[data-model-relation-id="${relationId}"]`)
      .getByRole('button', { name: /Разместить связь/ })
      .click();
    await page.getByRole('button', { name: 'Разместить стрелку', exact: true }).click();
  }
  await expect(page.locator('.react-flow__edge')).toHaveCount(3);
  await expect(page.getByText(/Сохранено · ревизия/)).toBeVisible({ timeout: 15000 });
  await page.reload();
  await expect(page.locator('.react-flow__edge')).toHaveCount(3);
  d = await (await request.get(`/api/diagrams/${d.id}`)).json();
  expect(d.document.edges[0].relationId).toBe(primary.id);
  const imported = await request.post('/api/diagrams', {
    data: { name: 'Импорт стрелок', document: d.document },
  });
  expect(imported.status(), await imported.text()).toBe(201);
  const copy: ModelDiagram = await imported.json();
  const root = copy.document.relations!.find((r) => r.copiedFrom?.id === primary.id)!;
  const dependent = copy.document.relations!.find(
    (r) => r.copiedFrom?.id === secondary.relationId,
  )!;
  expect(dependent.targetId).toBe(root.id);
  expect(copy.document.edges.map((e) => e.relationId)).not.toContain(primary.id);
});

test('relation hierarchy: hidden parents survive import and historical restoration', async ({
  request,
}) => {
  await login(request);
  const a = await object(request, 'A'),
    b = await object(request, 'B');
  const r = await (
    await request.post('/api/relations', {
      data: { name: 'Родитель-связь', sourceId: a.id, targetId: b.id },
    })
  ).json();
  const child = await object(request, 'Вложенный объект', r.id);
  let d = await create(request);
  d = await place(request, d, child.id);
  expect(d.document.relations!.map((r) => r.id)).toEqual([r.id]);
  expect(d.document.objects.find((o) => o.id === child.id)?.parentId).toBe(r.id);
  expect(
    (await request.delete(`/api/relations/${r.id}`, { data: { revision: r.revision } })).status(),
  ).toBe(409);
  expect(
    (
      await request.patch(`/api/relations/${r.id}`, {
        data: { revision: r.revision, parentId: child.id },
      })
    ).status(),
  ).toBe(400);
  const copy = await request.post('/api/diagrams', {
    data: { name: 'Копия дерева', document: d.document },
  });
  expect(copy.status(), await copy.text()).toBe(201);
  const imported: ModelDiagram = await copy.json();
  expect(imported.document.objects.find((o) => o.copiedFrom?.id === child.id)?.parentId).toBe(
    imported.document.relations![0].id,
  );
  const historyNumber = d.revision;
  d = await save(request, d, { ...d.document, nodes: [], edges: [], objects: [], relations: [] });
  for (const o of [child])
    expect(
      (await request.delete(`/api/objects/${o.id}`, { data: { revision: o.revision } })).status(),
    ).toBe(200);
  expect(
    (await request.delete(`/api/relations/${r.id}`, { data: { revision: r.revision } })).status(),
  ).toBe(200);
  for (const o of [a, b])
    expect(
      (await request.delete(`/api/objects/${o.id}`, { data: { revision: o.revision } })).status(),
    ).toBe(200);
  const restored = await request.post(`/api/diagrams/${d.id}/restore`, {
    data: { revision: d.revision, number: historyNumber },
  });
  expect(restored.status(), await restored.text()).toBe(200);
  const result: ModelDiagram = await restored.json();
  expect(result.document.objects.find((o) => o.id === child.id)?.parentId).toBe(r.id);
  expect(result.document.relations![0]).toMatchObject({ id: r.id, sourceId: a.id, targetId: b.id });
  const outer = await request.post('/api/relations', {
    data: { name: 'Связь со связью', sourceId: r.id, targetId: child.id },
  });
  expect(outer.status()).toBe(201);
  expect(
    (
      await request.patch(`/api/objects/${child.id}`, {
        data: { revision: 1, parentId: 'unknown-parent' },
      })
    ).status(),
  ).toBe(400);
});

test('browser: distinct tree actions, collapsible panels, detach and rebind arrows', async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  await login(request, page);
  const a = await object(request, 'Источник'),
    b = await object(request, 'Получатель'),
    c = await object(request, 'Другой получатель');
  let d = await create(request);
  for (const o of [a, b, c, b]) d = await place(request, d, o.id);
  d = await save(request, d, {
    ...d.document,
    nodes: d.document.nodes.map((n, i) => ({
      ...n,
      position: { x: i ? 330 : 0, y: i > 1 ? (i - 1) * 220 : 0 },
    })),
    edges: [
      {
        id: 'editable',
        bindingId: d.document.bindings[0].id,
        typeId: 'flow',
        source: d.document.nodes[0].id,
        target: d.document.nodes[1].id,
        sourcePort: 'out',
        targetPort: 'in',
        properties: { label: 'Тестовая стрелка' },
      },
    ],
  });
  const original = d.document.relations![0];
  d = await save(request, d, {
    ...d.document,
    edges: [
      ...d.document.edges,
      {
        ...d.document.edges[0],
        id: 'alias',
        target: d.document.nodes[3].id,
        properties: { label: 'Другая копия' },
      },
    ],
  });
  await page.goto(`/diagrams/${d.id}`);
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);
  const row = page.locator(`[data-object-id="${a.id}"]`);
  await row.getByRole('button', { name: 'Найти объект Источник', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const folder = page.getByRole('button', { name: 'Связи объекта Источник', exact: true });
  await folder.click();
  await expect(folder).toHaveAttribute('aria-expanded', 'false');
  await folder.click();
  await expect(folder).toHaveAttribute('aria-expanded', 'true');
  const catalog = page.locator(`[data-model-relation-id="${original.id}"]`);
  await catalog
    .getByRole('button', { name: `Разместить связь ${original.name}`, exact: true })
    .click();
  await expect(
    page.getByRole('dialog', { name: `Разместить связь «${original.name}»`, exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Создать объект', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.getByText('Панели', { exact: true }).click();
  for (const [label, selector] of [
    ['Дерево объектов', '.object-panel'],
    ['Палитра объектов', '.palette'],
    ['Свойства', '.inspector'],
  ]) {
    const toggle = page.getByRole('button', { name: label, exact: true });
    await toggle.click();
    await expect(page.locator(selector)).toBeHidden();
    await toggle.click();
    await expect(page.locator(selector)).toBeVisible();
  }
  await page.getByText('Панели', { exact: true }).click();
  await page.locator('.react-flow__controls-fitview').click();
  await catalog.getByRole('button', { name: `Найти связь ${original.name}`, exact: true }).click();
  await page.getByRole('button', { name: 'Отвязать конец', exact: true }).click();
  await expect(page.getByText(/Сохранено · ревизия/)).toBeVisible({ timeout: 15000 });
  d = await (await request.get(`/api/diagrams/${d.id}`)).json();
  expect(d.document.edges.find((e) => e.id === 'editable')!.detachedTarget).toBeDefined();
  await page.reload();
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);
  await page.locator('.react-flow__controls-fitview').click();
  const updater = page.locator(
    '.react-flow__edge[data-id="editable"] .react-flow__edgeupdater-target',
  );
  await updater.hover();
  const start = (await updater.boundingBox())!;
  const end = (await page
    .locator(`[data-id="${d.document.nodes[2].id}"] .react-flow__handle[data-handleid="in"]`)
    .boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 20 });
  await page.mouse.up();
  await expect(page.getByText(/Сохранено · ревизия/)).toBeVisible({ timeout: 15000 });
  const rebound: ModelDiagram = await (await request.get(`/api/diagrams/${d.id}`)).json();
  const changed = rebound.document.edges.find((e) => e.id === 'editable')!;
  expect(changed.target).toBe(d.document.nodes[2].id);
  expect(changed.detachedTarget).toBeUndefined();
  expect(changed.properties.label).toBe('Тестовая стрелка');
  expect(rebound.document.edges.find((e) => e.id === 'alias')!.relationId).toBe(original.id);
  expect(rebound.document.relations!.find((r) => r.id === changed.relationId)).toMatchObject({
    sourceId: a.id,
    targetId: c.id,
    copiedFrom: { id: original.id, name: original.name },
  });
  await page.reload();
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);
  await page.locator('.react-flow__controls-fitview').click();
  await updater.hover();
  const attached = (await updater.boundingBox())!;
  const canvas = (await page.locator('.flow-container').boundingBox())!;
  await page.mouse.move(attached.x + attached.width / 2, attached.y + attached.height / 2);
  await page.mouse.down();
  await page.mouse.move(canvas.x + 150, canvas.y + canvas.height - 45, { steps: 20 });
  await page.mouse.up();
  await expect(page.getByText(/Сохранено · ревизия/)).toBeVisible({ timeout: 15000 });
  d = await (await request.get(`/api/diagrams/${d.id}`)).json();
  const freePoint = d.document.edges.find((e) => e.id === 'editable')!.detachedTarget!;
  expect(freePoint).toBeDefined();
  expect(d.document.edges.find((e) => e.id === 'editable')!.detachedSource).toBeUndefined();
  d = await save(request, d, {
    ...d.document,
    nodes: d.document.nodes.filter((n) => n.objectId !== c.id),
  });
  expect(d.document.edges).toHaveLength(2);
  const imported = await request.post('/api/diagrams', {
    data: { name: 'Свободный конец — импорт', document: d.document },
  });
  expect(imported.status(), await imported.text()).toBe(201);
  const copy: ModelDiagram = await imported.json();
  expect(copy.document.edges.find((e) => e.id === 'editable')!.detachedTarget).toEqual(freePoint);
});

test('sharing: owner controls anonymous access, scope, rotation and revocation', async ({
  request,
  playwright,
}) => {
  await login(request);
  const parent = await object(request, 'Папка диаграммы'),
    child = await object(request, 'Публичный объект', parent.id);
  await object(request, 'Секретный объект другой диаграммы');
  let d = await create(request, 'Публичная диаграмма');
  d = await place(request, d, child.id);
  const anonymous = await playwright.request.newContext({ baseURL: 'http://localhost:3000' });
  const foreign = await playwright.request.newContext({ baseURL: 'http://localhost:3000' });
  try {
    await login(foreign);
    expect((await anonymous.get(`/api/diagrams/${d.id}/share`)).status()).toBe(401);
    expect(
      (await foreign.post(`/api/diagrams/${d.id}/share`, { data: { enabled: true } })).status(),
    ).toBe(404);
    const enable = await request.post(`/api/diagrams/${d.id}/share`, { data: { enabled: true } });
    expect(enable.status()).toBe(200);
    const sharing = await enable.json(),
      token = sharing.path.split('/').pop();
    const response = await anonymous.get(`/api/public/${token}`);
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toBe('no-store');
    const publicData = await response.json();
    expect(publicData.document.objects.map((o: ModelObject) => o.name).sort()).toEqual(
      ['Папка диаграммы', 'Публичный объект'].sort(),
    );
    expect(publicData.ownerId).toBeUndefined();
    expect(publicData.shareToken).toBeUndefined();
    expect(publicData.document.modelSpaceId).toBe('public');
    await request.patch(`/api/objects/${child.id}`, {
      data: { revision: child.revision, name: 'Изменено владельцем' },
    });
    const live = await (await anonymous.get(`/api/public/${token}`)).json();
    expect(live.document.objects.find((o: ModelObject) => o.id === child.id).name).toBe(
      'Изменено владельцем',
    );
    const duplicate = await (
      await request.post(`/api/diagrams/${d.id}/duplicate`, { data: {} })
    ).json();
    expect((await (await request.get(`/api/diagrams/${duplicate.id}/share`)).json()).enabled).toBe(
      false,
    );

    expect(
      (await anonymous.put(`/api/public/${token}`, { data: { name: 'Изменение' } })).status(),
    ).toBe(405);
    expect(
      (
        await anonymous.put(`/api/diagrams/${d.id}`, {
          data: { revision: d.revision, document: d.document },
        })
      ).status(),
    ).toBe(401);
    expect(
      (await request.post(`/api/diagrams/${d.id}/share`, { data: { enabled: true } })).status(),
    ).toBe(200);
    expect((await (await request.get(`/api/diagrams/${d.id}/share`)).json()).path).toBe(
      sharing.path,
    );
    const rotated = await (
      await request.post(`/api/diagrams/${d.id}/share`, { data: { enabled: true, rotate: true } })
    ).json();
    expect(rotated.path).not.toBe(sharing.path);
    expect((await anonymous.get(`/api/public/${token}`)).status()).toBe(404);
    const newToken = rotated.path.split('/').pop();
    expect((await anonymous.get(`/api/public/${newToken}`)).status()).toBe(200);
    await request.post(`/api/diagrams/${d.id}/share`, { data: { enabled: false } });
    expect((await anonymous.get(`/api/public/${newToken}`)).status()).toBe(404);
    const disabled = await (await request.get(`/api/diagrams/${d.id}/share`)).json();
    expect(disabled).toEqual({ enabled: false, path: rotated.path });
    const reenabled = await (
      await request.post(`/api/diagrams/${d.id}/share`, { data: { enabled: true } })
    ).json();
    expect(reenabled).toEqual({ enabled: true, path: rotated.path });
    expect((await anonymous.get(`/api/public/${newToken}`)).status()).toBe(200);
    const inactiveRotation = await (
      await request.post(`/api/diagrams/${d.id}/share`, { data: { enabled: false, rotate: true } })
    ).json();
    expect(inactiveRotation.enabled).toBe(false);
    expect(inactiveRotation.path).not.toBe(rotated.path);
    const inactiveToken = inactiveRotation.path.split('/').pop();
    expect((await anonymous.get(`/api/public/${newToken}`)).status()).toBe(404);
    expect((await anonymous.get(`/api/public/${inactiveToken}`)).status()).toBe(404);
    const final = await (
      await request.post(`/api/diagrams/${d.id}/share`, { data: { enabled: true } })
    ).json();
    expect(final.path).toBe(inactiveRotation.path);
    expect((await anonymous.get(`/api/public/${inactiveToken}`)).status()).toBe(200);
  } finally {
    await anonymous.dispose();
    await foreign.dispose();
  }
});

test('browser: share viewer deep links, read-only controls and PNG JPEG PDF exports', async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(120000);
  await login(request, page);
  const o = await object(request, 'Текст вьюера');
  let d = await create(request, 'Экспорт вьюера');
  d = await place(request, d, o.id);
  d = await place(request, d, (await object(request, 'Получатель вьюера')).id);
  d = await save(request, d, {
    ...d.document,
    edges: [
      {
        id: 'public-arrow',
        bindingId: d.document.bindings[0].id,
        typeId: 'flow',
        source: d.document.nodes[0].id,
        target: d.document.nodes[1].id,
        sourcePort: 'out',
        targetPort: 'in',
        properties: { label: 'Подпись стрелки' },
        appearance: {
          line: 'dashed',
          targetMarker: 'hollow-triangle',
          sourceMarker: 'hollow-diamond',
        },
      },
    ],
    nodes: d.document.nodes.map((n) => ({ ...n, appearance: { fill: '#ff0000' } })),
  });
  await page.goto(`/diagrams/${d.id}`);
  await expect(page.locator('.react-flow__node-notation')).toHaveCount(2);
  await page.getByRole('button', { name: 'Поделиться', exact: true }).click();
  await page.getByLabel('Доступ по ссылке', { exact: true }).check();
  const field = page.getByLabel('Публичная ссылка', { exact: true });
  await expect(field).toHaveValue(/\/view\//);
  const link = await field.inputValue();
  const guest = await browser.newContext();
  try {
    const viewer = await guest.newPage();
    await viewer.goto(`${link}?element=${d.document.nodes[0].id}`);
    await expect(
      viewer.getByRole('heading', { name: 'Объекты диаграммы', exact: true }),
    ).toBeVisible();
    const figure = viewer.locator(`[data-representation-id="${d.document.nodes[0].id}"]`);
    await expect(figure.locator('rect[stroke="#7060da"]')).toBeVisible();
    await expect(viewer.locator('path[marker-end]').first()).toHaveAttribute(
      'marker-end',
      'url(#maket-svg-public-arrow-end)',
    );
    await expect(
      viewer.locator('.viewer-canvas').getByText('Подпись стрелки', { exact: true }),
    ).toBeVisible();
    await expect(viewer.getByRole('button', { name: 'Сохранить', exact: true })).toHaveCount(0);
    await expect(viewer.locator('.react-flow__handle')).toHaveCount(0);
    await viewer.getByRole('button', { name: 'Экспорт', exact: true }).click();
    const { readFile } = await import('node:fs/promises');
    for (const [label, extension] of [
      ['PNG', 'png'],
      ['JPEG', 'jpeg'],
      ['PDF', 'pdf'],
    ] as const) {
      const downloadPromise = viewer.waitForEvent('download');
      await viewer.getByRole('button', { name: label, exact: true }).click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toBe(`Экспорт вьюера.${extension}`);
      const content = await readFile((await download.path())!);
      expect(content.length).toBeGreaterThan(500);
      if (label === 'PDF') expect(content.subarray(0, 5).toString()).toBe('%PDF-');
      else {
        expect(content.subarray(0, label === 'PNG' ? 8 : 3).toString('hex')).toBe(
          label === 'PNG' ? '89504e470d0a1a0a' : 'ffd8ff',
        );
        const colored = await viewer.evaluate(
          async ({ data, type }) => {
            const image = new Image();
            image.src = `data:image/${type};base64,${data}`;
            await image.decode();
            const canvas = document.createElement('canvas');
            canvas.width = image.width;
            canvas.height = image.height;
            const ctx = canvas.getContext('2d')!;
            ctx.drawImage(image, 0, 0);
            const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            for (let i = 0; i < pixels.length; i += 4)
              if (pixels[i] > 200 && pixels[i + 1] < 80 && pixels[i + 2] < 80) return true;
            return false;
          },
          { data: content.toString('base64'), type: extension },
        );
        expect(colored).toBe(true);
      }
    }
    await viewer.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await page.getByLabel('Доступ по ссылке', { exact: true }).uncheck();
    await expect(
      viewer.getByRole('heading', { name: 'Диаграмма недоступна', exact: true }),
    ).toBeVisible({ timeout: 22000 });
    await viewer.reload();
    await expect(
      viewer.getByRole('heading', { name: 'Диаграмма недоступна', exact: true }),
    ).toBeVisible();
  } finally {
    await guest.close();
  }
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.getByRole('button', { name: 'Экспорт', exact: true }).click();
  await expect(page.getByRole('button', { name: 'JSON', exact: true })).toBeVisible();
});

test('browser: persistent share link and explicit regeneration while access is disabled', async ({
  page,
  request,
}) => {
  await login(request, page);
  const d = await create(request, 'Постоянная ссылка');
  await page.goto(`/diagrams/${d.id}`);
  await page.getByRole('button', { name: 'Поделиться', exact: true }).click();
  await page.getByRole('button', { name: 'Сгенерировать новую', exact: true }).click();
  const field = page.getByLabel('Публичная ссылка', { exact: true });
  await expect(field).toHaveValue(/\/view\//);
  const original = await field.inputValue();
  const access = page.getByLabel('Доступ по ссылке', { exact: true });
  await expect(access).not.toBeChecked();
  await access.check();
  await expect(access).toBeEnabled();
  await expect(field).toHaveValue(original);
  await access.uncheck();
  await expect(access).toBeEnabled();
  await expect(field).toHaveValue(original);
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.getByRole('button', { name: 'Поделиться', exact: true }).click();
  await expect(field).toHaveValue(original);
  await expect(access).not.toBeChecked();
  await page.getByRole('button', { name: 'Сгенерировать новую', exact: true }).click();
  await expect(field).not.toHaveValue(original);
  const regenerated = await field.inputValue();
  await expect(access).not.toBeChecked();
  await access.check();
  await expect(access).toBeEnabled();
  await expect(field).toHaveValue(regenerated);
});

test('solution hierarchy: decomposition, reuse, migration-compatible roots and safe moves', async ({
  request,
  playwright,
}) => {
  await login(request);
  const entity = async (name: string, kind: string, parentId?: string) => {
    const response = await request.post('/api/objects', { data: { name, kind, parentId } });
    expect(response.status(), await response.text()).toBe(201);
    return response.json() as Promise<ModelObject>;
  };
  expect((await (await request.get('/api/model/structure')).json()).objects).toEqual([]);
  const solution = await entity('Платформа', 'solution');
  const grouping = await entity('Разработка', 'folder', solution.id);
  const project = await entity('Платежи', 'project', grouping.id);
  const folder = await entity('Доменные объекты', 'folder', project.id);
  const order = await entity('Заказ', 'object', folder.id);
  const nested = await entity('Строка заказа', 'object', order.id);
  expect(
    (
      await request.post('/api/objects', { data: { name: 'Вне решения', kind: 'project' } })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.post('/api/objects', { data: { name: 'Ложная диаграмма', kind: 'diagram' } })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.patch(`/api/objects/${grouping.id}`, { data: { revision: 1, parentId: null } })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.patch(`/api/objects/${solution.id}`, {
        data: { revision: 1, parentId: nested.id },
      })
    ).status(),
  ).toBe(400);
  let d: ModelDiagram = await (
    await request.post('/api/diagrams', { data: { name: 'Устройство заказа', parentId: order.id } })
  ).json();
  const diagramEntity = (await (
    await request.get(`/api/objects/${d.entityId}`)
  ).json()) as ModelObject;
  expect(diagramEntity.kind).toBe('diagram');
  expect(diagramEntity.parentId).toBe(order.id);
  d = await place(request, d, solution.id);
  d = await place(request, d, project.id);
  d = await place(request, d, order.id);
  d = await place(request, d, order.id);
  expect(d.document.nodes.filter((n) => n.objectId === order.id)).toHaveLength(2);
  expect(
    (
      await request.post(`/api/diagrams/${d.id}/representations`, {
        data: {
          revision: d.revision,
          objectId: folder.id,
          bindingId: d.document.bindings[0].id,
          typeId: 'process',
          position: { x: 0, y: 100 },
        },
      })
    ).status(),
  ).toBe(400);
  const relation = await (
    await request.post('/api/relations', {
      data: { name: 'Владеет', sourceId: project.id, targetId: order.id, parentId: solution.id },
    })
  ).json();
  d = await save(request, d, {
    ...d.document,
    edges: [
      {
        id: 'ownership',
        relationId: relation.id,
        source: d.document.nodes[1].id,
        target: d.document.nodes[2].id,
        sourcePort: 'out',
        targetPort: 'in',
        bindingId: d.document.bindings[0].id,
        typeId: 'flow',
        properties: {},
      },
    ],
  });
  let other: ModelDiagram = await (
    await request.post('/api/diagrams', { data: { name: 'Обзор', parentId: project.id } })
  ).json();
  other = await place(request, other, order.id);
  other = await place(request, other, project.id);
  other = await save(request, other, {
    ...other.document,
    edges: [
      {
        id: 'ownership_alias',
        relationId: relation.id,
        source: other.document.nodes[1].id,
        target: other.document.nodes[0].id,
        sourcePort: 'out',
        targetPort: 'in',
        bindingId: other.document.bindings[0].id,
        typeId: 'flow',
        properties: {},
      },
    ],
  });
  d = await save(request, d, {
    ...d.document,
    nodes: d.document.nodes.map((n, i) => (i === 3 ? { ...n, label: 'Локальный вид заказа' } : n)),
  });
  const detail = await entity('Деталь связи', 'object', relation.id);
  const structure = await (await request.get('/api/model/structure')).json();
  expect(
    structure.representations.filter((r: { entityId: string }) => r.entityId === order.id),
  ).toHaveLength(3);
  expect(
    structure.representations.filter((r: { entityId: string }) => r.entityId === relation.id),
  ).toHaveLength(2);
  expect(structure.objects.find((o: ModelObject) => o.id === detail.id).parentId).toBe(relation.id);
  const objectRepresentations = await (
    await request.get(`/api/objects/${order.id}/representations`)
  ).json();
  expect(objectRepresentations).toHaveLength(3);
  expect(
    objectRepresentations.find((r: { id: string }) => r.id === d.document.nodes[3].id).name,
  ).toBe('Локальный вид заказа');
  expect(
    await (await request.get(`/api/relations/${relation.id}/representations`)).json(),
  ).toHaveLength(2);

  const copy = await (await request.post(`/api/diagrams/${d.id}/duplicate`, { data: {} })).json();
  expect(copy.entityId).not.toBe(d.entityId);
  expect((await (await request.get(`/api/objects/${copy.entityId}`)).json()).parentId).toBe(
    order.id,
  );
  const diagramChild = await entity('Внутренний элемент диаграммы', 'object', copy.entityId);
  expect((await request.delete(`/api/diagrams/${copy.id}`)).status()).toBe(409);
  expect(
    (
      await request.patch(`/api/objects/${diagramChild.id}`, {
        data: { revision: 1, parentId: folder.id },
      })
    ).status(),
  ).toBe(200);
  expect((await request.delete(`/api/diagrams/${copy.id}`)).status()).toBe(200);
  expect((await request.get(`/api/objects/${copy.entityId}`)).status()).toBe(404);
  expect(
    (await request.delete(`/api/objects/${order.id}`, { data: { revision: 1 } })).status(),
  ).toBe(409);
  expect(
    (
      await request.patch(`/api/objects/${diagramEntity.id}`, {
        data: { revision: 1, name: 'Декомпозиция заказа' },
      })
    ).status(),
  ).toBe(200);
  expect((await (await request.get(`/api/diagrams/${d.id}`)).json()).name).toBe(
    'Декомпозиция заказа',
  );
  expect(
    (await request.patch(`/api/diagrams/${d.id}`, { data: { name: 'Состав заказа' } })).status(),
  ).toBe(200);
  expect((await (await request.get(`/api/objects/${diagramEntity.id}`)).json()).name).toBe(
    'Состав заказа',
  );
  // Palette creation follows the decomposition container, not a notation-specific catalog.
  d = await place(request, d);
  const paletteObject = d.document.objects.find((o) => o.id === d.document.nodes.at(-1)!.objectId)!;
  expect(paletteObject.kind).toBe('object');
  expect(paletteObject.parentId).toBe(order.id);
  const diagramOwned = await entity('Деталь канваса', 'object', d.entityId!);
  d = await place(request, d, diagramOwned.id);
  expect(d.document.objects.find((o) => o.id === d.entityId)!.kind).toBe('diagram');
  const importedResponse = await request.post('/api/diagrams', {
    data: { name: 'Импорт декомпозиции', document: d.document },
  });
  expect(importedResponse.status(), await importedResponse.text()).toBe(201);
  const imported: ModelDiagram = await importedResponse.json();
  expect(imported.document.objects.find((o) => o.copiedFrom?.id === d.entityId)!.kind).toBe(
    'folder',
  );
  expect(imported.document.objects.find((o) => o.copiedFrom?.id === solution.id)!.kind).toBe(
    'solution',
  );
  expect(imported.document.objects.find((o) => o.copiedFrom?.id === project.id)!.kind).toBe(
    'project',
  );
  expect(
    imported.document.nodes.filter(
      (n) =>
        n.objectId === imported.document.objects.find((o) => o.copiedFrom?.id === order.id)!.id,
    ),
  ).toHaveLength(2);
  const foreign = await playwright.request.newContext({ baseURL: 'http://localhost:3000' });
  await login(foreign);
  expect(
    (
      await foreign.post('/api/diagrams', {
        data: { name: 'Чужая декомпозиция', parentId: order.id },
      })
    ).status(),
  ).toBe(400);
  expect((await (await foreign.get('/api/model/structure')).json()).objects).toEqual([]);
  expect((await foreign.get(`/api/objects/${order.id}/representations`)).status()).toBe(404);
  expect((await foreign.get(`/api/relations/${relation.id}/representations`)).status()).toBe(404);
  await foreign.dispose();
});

test('browser: solutions, projects, decomposition diagrams and representation deep links', async ({
  request,
  page,
}) => {
  test.setTimeout(120000);
  await login(request, page);
  await page.goto('/solutions');
  await page.getByRole('button', { name: 'Создать внутри' }).click();
  await page.getByLabel('Имя объекта', { exact: true }).fill('Магазин');
  await page.getByRole('button', { name: 'Сохранить объект', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Магазин', exact: true })).toBeVisible();
  await expect(page.getByLabel('Тип нового элемента')).toHaveValue('project');
  await page.getByRole('button', { name: 'Создать внутри' }).click();
  await page.getByLabel('Имя объекта', { exact: true }).fill('Каталог');
  await page.getByRole('button', { name: 'Сохранить объект', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Каталог', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Создать внутри' }).click();
  await page.getByLabel('Имя объекта', { exact: true }).fill('Товар');
  await page.getByRole('button', { name: 'Сохранить объект', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Товар', exact: true })).toBeVisible();
  await page.getByLabel('Тип нового элемента').selectOption('diagram');
  await page.getByRole('button', { name: 'Создать внутри' }).click();
  await page.getByRole('dialog').getByLabel('Название').fill('Состав товара');
  await page.getByRole('button', { name: 'Создать диаграмму', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Состав товара', exact: true })).toBeVisible();
  const structure = await (await request.get('/api/model/structure')).json();
  const product = structure.objects.find((o: ModelObject) => o.name === 'Товар');
  const d = structure.diagrams.find((d: { name: string }) => d.name === 'Состав товара');
  let diagram: ModelDiagram = await (await request.get(`/api/diagrams/${d.id}`)).json();
  diagram = await place(request, diagram, product.id);
  diagram = await place(request, diagram, product.id);
  await page.goto(`/solutions?parent=${product.id}`);
  await expect(page.getByRole('heading', { name: 'Товар', exact: true })).toBeVisible();
  const representations = page.locator('.solution-content .representation-folder');
  await representations.locator('summary').click();
  await expect(representations.locator('a')).toHaveCount(2);
  await representations.locator('a').nth(1).click();
  await expect(page).toHaveURL(new RegExp(`element=${diagram.document.nodes[1].id}`), {
    timeout: 30000,
  });
  await expect(page.locator('.react-flow__node-notation.selected')).toHaveCount(1);
  await expect(page.locator('.react-flow__node-notation.selected')).toHaveAttribute(
    'data-id',
    diagram.document.nodes[1].id,
  );
  const row = page.locator(`[data-object-id="${product.id}"]`);
  await expect(row.getByRole('link', { name: 'Декомпозиция Товар' })).toBeVisible();
  const folder = row.locator('..').locator(':scope > [role="group"] > .representation-folder');
  await folder.locator('summary').click();
  await expect(folder.locator('a')).toHaveCount(2);
  await folder.locator('a').first().click();
  await expect(page.locator('.react-flow__node-notation.selected')).toHaveAttribute(
    'data-id',
    diagram.document.nodes[0].id,
  );

  await row.getByRole('link', { name: 'Декомпозиция Товар' }).click();
  await expect(page.getByRole('heading', { name: 'Товар', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Открыть диаграмму →', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Свойства', exact: true }).click();
  await expect(
    page.getByLabel('Родительский объект').locator(`option[value="${product.id}"]`),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
});
