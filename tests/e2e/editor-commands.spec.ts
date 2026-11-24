import 'dotenv/config';
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { scryptSync, randomBytes } from 'node:crypto';
import { databaseConfig } from '../../scripts/database-config.mjs';
import { builtinNotation, type DiagramDocument } from '../../src/lib/notation';
const { connectionString, schema } = databaseConfig();
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }, { schema }) });
const emails: string[] = [];
async function setup(page: Page, request: APIRequestContext) {
  const email = `commands-${crypto.randomUUID()}@example.com`,
    password = 'Commands-test-password-42',
    salt = randomBytes(16).toString('hex');
  emails.push(email);
  await db.user.create({
    data: {
      email,
      name: 'Команды редактора',
      emailVerified: true,
      passwordHash: `${salt}:${scryptSync(password, salt, 64).toString('hex')}`,
      settings: { theme: 'light', snapToGrid: false, autosave: false },
    },
  });
  expect((await request.post('/api/auth/login', { data: { email, password } })).status()).toBe(200);
  await page.context().addCookies((await request.storageState()).cookies);
  const document: DiagramDocument = {
    schemaVersion: 1,
    notation: structuredClone(builtinNotation),
    nodes: [
      { id: 'a', typeId: 'process', position: { x: 0, y: 0 }, properties: { title: 'Начало' } },
      { id: 'b', typeId: 'process', position: { x: 500, y: 0 }, properties: { title: 'Конец' } },
      {
        id: 'cover',
        typeId: 'process',
        position: { x: 250, y: 0 },
        properties: { title: 'Перекрытие' },
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
  };
  const response = await request.post('/api/diagrams', {
    data: { name: 'Команды и слои', document },
  });
  expect(response.status()).toBe(201);
  const created = await response.json();
  await page.goto(`/diagrams/${created.id}`);
  await expect(page.locator('.react-flow__node-notation')).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Просмотр', exact: true })).toBeEnabled();
  return created.id as string;
}
test.afterAll(async () => {
  await db.user.deleteMany({ where: { email: { in: emails } } });
  await db.$disconnect();
});

test('arrows share stacking order with shapes, including menu, keyboard and persisted reload', async ({
  page,
  request,
}) => {
  const id = await setup(page, request);
  const edge = page.locator('.react-flow__edge[data-id="e"]');
  await edge.evaluate((element) =>
    element.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, clientX: 600, clientY: 300 }),
    ),
  );
  await page.getByRole('menuitem', { name: 'На передний план', exact: true }).click();
  await expect(page.getByLabel('Уровень слоя', { exact: true })).toHaveValue('3');
  const frontmost = () =>
    page.evaluate(() => {
      const path = document.querySelector(
        '.react-flow__edge[data-id="e"] .react-flow__edge-path',
      ) as SVGPathElement;
      const p = path
        .getPointAtLength(path.getTotalLength() / 2)
        .matrixTransform(path.getScreenCTM()!);
      return document.elementFromPoint(p.x, p.y)?.closest('[data-id]')?.getAttribute('data-id');
    });
  expect(await frontmost()).toBe('e');
  await page.locator('.react-flow').focus();
  await page.keyboard.press('Control+BracketLeft');
  await expect(page.getByLabel('Уровень слоя', { exact: true })).toHaveValue('2');
  expect(await frontmost()).toBe('cover');
  await page.keyboard.press('Control+Shift+BracketRight');
  await page.keyboard.press('Control+s');
  await expect(page.getByText(/Сохранено · ревизия/)).toBeVisible();
  const saved = await (await request.get(`/api/diagrams/${id}`)).json();
  expect(saved.document.edges[0].layer).toBe(3);
  await page.reload();
  await expect(page.locator('.react-flow__node-notation')).toHaveCount(3);
  await edge.evaluate((element) =>
    element.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, clientX: 600, clientY: 300 }),
    ),
  );
  await expect(page.getByRole('menuitem', { name: 'На задний план', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  expect(await frontmost()).toBe('e');
});

test('view mode pans with left button and blocks diagram mutation; edit mode supports Space pan', async ({
  page,
  request,
}) => {
  const id = await setup(page, request);
  const node = page.locator('.react-flow__node[data-id="a"]');
  await node.click();
  await page.getByRole('button', { name: 'Просмотр', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Просмотр', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await node.dblclick();
  await expect(page.getByRole('textbox', { name: 'Текст объекта', exact: true })).toHaveCount(0);
  await expect(page.locator('.react-flow__resize-control')).toHaveCount(0);
  const viewport = page.locator('.react-flow__viewport');
  const before = await viewport.getAttribute('style');
  const box = (await node.boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 110, box.y + 65, { steps: 8 });
  await page.mouse.up();
  await expect(viewport).not.toHaveAttribute('style', before!);
  await page.locator('.react-flow').focus();
  await page.keyboard.press('Delete');
  await expect(page.locator('.react-flow__node-notation')).toHaveCount(3);
  await node.evaluate((element) =>
    element.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, clientX: 600, clientY: 300 }),
    ),
  );
  await expect(
    page.getByRole('menuitem', { name: 'Удалить представление', exact: true }),
  ).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Редактирование', exact: true }).click();
  const beforeSpace = await viewport.getAttribute('style');
  const bounds = (await node.boundingBox())!;
  await page.locator('.react-flow').focus();
  await page.keyboard.down('Space');
  await page.mouse.move(bounds.x + 40, bounds.y + 20);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 110, bounds.y + 65, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Space');
  await expect(viewport).not.toHaveAttribute('style', beforeSpace!);
  const unchanged = await (await request.get(`/api/diagrams/${id}`)).json();
  expect(unchanged.document.nodes.find((n: { id: string }) => n.id === 'a').position).toEqual({
    x: 0,
    y: 0,
  });
  await expect(page.getByText(/Сохранено · ревизия/)).toBeVisible();
});

test('custom user shortcuts survive reload, match tree commands and respect text inputs and dialogs', async ({
  page,
  request,
}) => {
  const id = await setup(page, request);
  await page.goto('/settings');
  const save = page.getByLabel('Сочетание: Сохранить диаграмму', { exact: true });
  await save.focus();
  await page.keyboard.press('Control+Shift+k');
  const properties = page.getByLabel('Сочетание: Свойства объекта / связи', { exact: true });
  await properties.focus();
  await page.keyboard.press('Control+Shift+k');
  await expect(page.getByRole('alert').filter({ hasText: 'Одинаковое сочетание' })).toBeVisible();
  await properties.focus();
  await page.keyboard.press('Control+Shift+j');
  await page.getByRole('button', { name: 'Сохранить настройки', exact: true }).click();
  await expect(page.getByText('Настройки сохранены', { exact: true })).toBeVisible();
  await page.reload();
  await expect(save).toHaveValue('Ctrl+Shift+K');
  await page.goto('/solutions');
  const search = page.getByRole('textbox', { name: 'Поиск в решениях', exact: true });
  await search.fill('Начало');
  const solutionRow = page
    .locator('.solutions-tree .tree-label')
    .filter({ hasText: 'Начало' })
    .first();
  await expect(solutionRow).toBeVisible();
  await solutionRow.focus();
  await page.keyboard.press('Control+Shift+j');
  await expect(
    page.getByRole('dialog', { name: 'Общие свойства объекта', exact: true }),
  ).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.goto(`/diagrams/${id}`);
  const node = page.locator('.react-flow__node[data-id="a"]');
  await expect(node).toBeVisible();
  await node.click();
  await page.keyboard.press('Control+Shift+l');
  const row = page.locator('.object-tree-name').filter({ hasText: 'Начало' }).first();
  await expect(row).toBeVisible();
  await row.focus();
  await page.keyboard.press('Control+Shift+j');
  await expect(
    page.getByRole('dialog', { name: 'Общие свойства объекта', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Имя объекта', { exact: true }).focus();
  await page.keyboard.press('Delete');
  await expect(page.locator('.react-flow__node-notation')).toHaveCount(3);
  await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click();
  await node.dblclick();
  await page.getByRole('textbox', { name: 'Текст объекта', exact: true }).fill('Новая подпись');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Есть изменения', { exact: true })).toBeVisible();
  await page.locator('.react-flow').focus();
  await page.keyboard.press('Control+Shift+k');
  await expect(page.getByText(/Сохранено · ревизия/)).toBeVisible();
  const saved = await (await request.get(`/api/diagrams/${id}`)).json();
  expect(saved.document.nodes.find((n: { id: string }) => n.id === 'a').label).toBe(
    'Новая подпись',
  );
  await node.evaluate((element) =>
    element.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, clientX: 600, clientY: 300 }),
    ),
  );
  await expect(
    page.getByRole('menuitem', { name: 'Изменить свойства объекта', exact: true }).locator('kbd'),
  ).toHaveText('Ctrl+Shift+J');
});
