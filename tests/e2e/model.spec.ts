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
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
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
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
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
  await expect(page.locator('.object-tree-row[data-object-id]')).toHaveCount(3);
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
  await expect(page.locator('.react-flow__node')).toHaveCount(4);
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
