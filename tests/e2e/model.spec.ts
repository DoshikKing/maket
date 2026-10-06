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
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  await row.getByRole('button', { name: 'Разместить Общий заказ', exact: true }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await expect(row.locator('.badge')).toHaveText('2');
  const first = page.locator('.react-flow__node').first();
  await first.dblclick();
  await page.getByLabel('Текст объекта', { exact: true }).fill('Местная подпись');
  await page.getByLabel('Текст объекта', { exact: true }).press('Enter');
  await row.getByRole('button', { name: 'Изменить объект Общий заказ', exact: true }).click();
  await page.getByLabel('Имя объекта', { exact: true }).fill('Новое общее имя');
  await page.getByRole('button', { name: 'Сохранить объект', exact: true }).click();
  await expect(first.locator('.node-label')).toHaveText('Местная подпись');
  await expect(page.locator('.react-flow__node').nth(1).locator('.node-label')).toHaveText(
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
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  expect(
    (await (await request.get(`/api/diagrams/${d.id}`)).json()).document.nodes[0].objectId,
  ).toBe(objectId);
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
  const first = page.locator('.react-flow__node').first();
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
  expect((await (await request.get('/api/model')).json()).objects).toHaveLength(0);
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
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
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
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  const updated: ModelObject = await (await request.get(`/api/objects/${existing.id}`)).json();
  expect(updated.attributes.owner).toBe('Борис');
  expect(updated.revision).toBe(2);
});
test('object deletion checks ownership, revisions, children and usage; history recreates deleted objects', async ({
  request,
  playwright,
}) => {
  await login(request);
  expect((await (await request.get('/api/model')).json()).objects).toHaveLength(0);
  let d = await create(request);
  expect((await (await request.get('/api/model')).json()).objects).toHaveLength(0);
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
  expect((await (await request.get('/api/model')).json()).objects).toHaveLength(1);
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
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  const treeRow = page.locator(`.object-tree-row[data-object-id="${o.id}"]`);
  page.on('dialog', (dialog) => dialog.accept());
  await treeRow
    .getByRole('button', { name: 'Удалить объект Удалить из дерева', exact: true })
    .click();
  await expect(page.locator('.object-panel [role="alert"]')).toContainText('используется');
  await expect(treeRow).toBeVisible();
  await page.locator('.react-flow__node').click();
  await page.getByRole('button', { name: 'Удалить элемент', exact: true }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(0);
  await treeRow
    .getByRole('button', { name: 'Удалить объект Удалить из дерева', exact: true })
    .click();
  await expect(treeRow).toHaveCount(0);
  await expect(page.locator('[role="treeitem"]')).toHaveCount(0);
  expect((await request.get(`/api/objects/${o.id}`)).status()).toBe(404);
  await page.reload();
  await expect(page.locator('[role="treeitem"]')).toHaveCount(0);
});
