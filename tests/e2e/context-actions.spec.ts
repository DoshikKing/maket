import 'dotenv/config';
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomBytes, scryptSync } from 'node:crypto';
import { databaseConfig } from '../../scripts/database-config.mjs';
import { builtinNotation } from '../../src/lib/notation';
const { connectionString, schema } = databaseConfig();
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }, { schema }) });
const emails: string[] = [];
async function setup(page: Page, request: APIRequestContext) {
  const email = `context-actions-${crypto.randomUUID()}@example.com`,
    password = 'Context-actions-password-42',
    salt = randomBytes(16).toString('hex');
  emails.push(email);
  await db.user.create({
    data: {
      email,
      name: 'Контекстные действия',
      emailVerified: true,
      passwordHash: `${salt}:${scryptSync(password, salt, 64).toString('hex')}`,
      settings: { theme: 'light', snapToGrid: false, autosave: true },
    },
  });
  expect((await request.post('/api/auth/login', { data: { email, password } })).status()).toBe(200);
  await page.context().addCookies((await request.storageState()).cookies);
  const created = await request.post('/api/diagrams', {
    data: {
      name: 'Диаграмма с длинным названием для проверки действий',
      document: {
        schemaVersion: 1,
        notation: builtinNotation,
        nodes: [
          {
            id: 'a',
            typeId: 'process',
            position: { x: 0, y: 0 },
            properties: { title: 'Первый объект' },
          },
          {
            id: 'b',
            typeId: 'process',
            position: { x: 400, y: 0 },
            properties: { title: 'Второй объект' },
          },
        ],
        edges: [
          {
            id: 'e',
            typeId: 'flow',
            source: 'a',
            target: 'b',
            sourcePort: 'out',
            targetPort: 'in',
            properties: {},
          },
        ],
      },
    },
  });
  expect(created.status()).toBe(201);
  const diagram = await created.json();
  const o = await request.post('/api/objects', {
    data: { name: 'Объект без представления с очень длинным названием' },
  });
  expect(o.status()).toBe(201);
  const object = await o.json();
  const r = await request.post('/api/relations', {
    data: {
      name: 'Связь без представления с длинным названием',
      sourceId: object.id,
      targetId: diagram.entityId,
      relationType: 'Проверка',
    },
  });
  expect(r.status()).toBe(201);
  const relation = await r.json();
  await page.goto(`/diagrams/${diagram.id}`);
  await expect(page.locator('.react-flow__node-notation')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Просмотр', exact: true })).toBeEnabled();
  return { diagram, object, relation };
}
const treeRow = (page: Page, id: string) =>
  page.locator(`.object-tree [data-tree-entity="${id}"] > .object-tree-row`);
async function menu(page: Page, id: string) {
  await treeRow(page, id).click({ button: 'right' });
  return page.getByRole('menu', { name: 'Действия элемента', exact: true });
}
test.afterAll(async () => {
  await db.user.deleteMany({ where: { email: { in: emails } } });
  await db.$disconnect();
});

test('tree clicks select objects, diagrams and relations without opening properties or navigating', async ({
  page,
  request,
}) => {
  const { diagram, object, relation } = await setup(page, request);
  const originalUrl = page.url();
  let writes = 0;
  page.on('request', (r) => {
    if (r.method() === 'PUT' && r.url().endsWith(`/api/diagrams/${diagram.id}`)) writes++;
  });
  for (const id of [object.id, diagram.entityId, diagram.document.nodes[0].objectId]) {
    const row = treeRow(page, id);
    await row.locator(':scope > button.tree-label').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).toHaveURL(originalUrl);
    await expect(row).toHaveClass(/selected/);
    await row.locator(':scope > button.tree-label').dblclick();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  const owner = page.locator(`.object-tree [data-tree-entity="${object.id}"]`);
  if ((await owner.getAttribute('aria-expanded')) === 'false')
    await treeRow(page, object.id).locator('button.tree-toggle').click();
  const relations = owner.locator(':scope > [role="group"] > .system-relation-folder');
  if ((await relations.getAttribute('aria-expanded')) === 'false')
    await relations.locator(':scope > button').click();
  const reference = relations.locator(`[data-relation-reference="${relation.id}"]`);
  await reference.locator('button.tree-label').click();
  await expect(reference).toHaveClass(/selected/);
  await reference.locator('button.tree-label').dblclick();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).toHaveURL(originalUrl);
  const represented = diagram.document.nodes[0].objectId;
  const representedOwner = page.locator(`.object-tree [data-tree-entity="${represented}"]`);
  if ((await representedOwner.getAttribute('aria-expanded')) === 'false')
    await treeRow(page, represented).locator('button.tree-toggle').click();
  const folder = representedOwner.locator(':scope > [role="group"] > .representation-folder');
  await folder.locator(':scope > summary').click();
  const representation = folder.locator('.representation-entry').first();
  await representation.locator('button.tree-row').click();
  await expect(representation).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).toHaveURL(originalUrl);
  await representation.locator('button.tree-row').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Найти', exact: true }).click();
  await expect(page.locator('.react-flow__node[data-id="a"]')).toHaveClass(/selected/);
  await expect(page.locator('.editor-save-state')).toContainText('Сохранено');
  expect(writes).toBe(0);
  const actions = await menu(page, object.id);
  await actions.getByRole('menuitem', { name: 'Свойства', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: 'Общие свойства объекта', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('dialog').getByLabel('Имя объекта', { exact: true })).toHaveValue(
    object.name,
  );
});

test('short context commands execute once for the right object and keep dialogs and focus intact', async ({
  page,
  request,
}) => {
  const { diagram, object } = await setup(page, request);
  let actions = await menu(page, object.id);
  const labels = await actions
    .getByRole('menuitem')
    .evaluateAll((items) => items.map((e) => e.getAttribute('aria-label') || ''));
  expect(labels.length).toBeGreaterThan(8);
  if (process.env.MAKET_DESIGN_SCREENSHOTS)
    await page.screenshot({ path: '/tmp/maket-context-menu.png' });
  expect(
    labels.every((label) => label.trim().split(/\s+/).length <= 2 && !label.includes(object.name)),
  ).toBe(true);
  await actions.getByRole('menuitem', { name: 'Создать внутри', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Создать: Объект', exact: true })).toBeVisible();
  await expect(
    page.getByRole('dialog').getByLabel('Родительский объект', { exact: true }),
  ).toHaveValue(object.id);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  actions = await menu(page, object.id);
  let copies = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/api/objects')) copies++;
  });
  const copied = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith('/api/objects'),
  );
  await actions.getByRole('menuitem', { name: 'Копировать', exact: true }).click();
  const response = await copied;
  expect(response.status()).toBe(201);
  const copy = await response.json();
  expect(copy.copiedFrom.id).toBe(object.id);
  expect(copies).toBe(1);
  await expect(treeRow(page, copy.id)).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await treeRow(page, object.id).locator(':scope > button.tree-label').focus();
  await page.keyboard.press('Shift+F10');
  actions = page.getByRole('menu');
  await actions.getByRole('menuitem', { name: 'Свойства', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog').getByLabel('Имя объекта', { exact: true })).toHaveValue(
    object.name,
  );
  await page.keyboard.press('Escape');
  const trigger = treeRow(page, object.id).locator(':scope > button.tree-label');
  await trigger.focus();
  await trigger.click({ button: 'right' });
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(trigger).not.toBeFocused();
  await page.locator('.react-flow__node[data-id="a"]').click({ button: 'right' });
  actions = page.getByRole('menu');
  await actions.getByRole('menuitem', { name: 'Поверх всех', exact: true }).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect
    .poll(async () => {
      const d = await (await request.get(`/api/diagrams/${diagram.id}`)).json();
      return d.document.nodes.find((n: { id: string }) => n.id === 'a').layer;
    })
    .toBeGreaterThan(0);
});
