import 'dotenv/config';
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { scryptSync, randomBytes } from 'node:crypto';
import { builtinNotation, type DiagramDocument } from '../../src/lib/notation';
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
const emails: string[] = [];
async function login(page: Page, request: APIRequestContext, dark = false) {
  const email = `presentation-${crypto.randomUUID()}@example.com`,
    password = 'Presentation-password-42',
    salt = randomBytes(16).toString('hex');
  emails.push(email);
  await db.user.create({
    data: {
      email,
      name: 'Тест оформления',
      emailVerified: true,
      passwordHash: `${salt}:${scryptSync(password, salt, 64).toString('hex')}`,
      settings: { theme: dark ? 'dark' : 'light', snapToGrid: false, autosave: true },
    },
  });
  expect((await request.post('/api/auth/login', { data: { email, password } })).status()).toBe(200);
  await page.context().addCookies((await request.storageState()).cookies);
}
async function diagram(page: Page, request: APIRequestContext, dark = false) {
  await login(page, request, dark);
  const notation = structuredClone(builtinNotation);
  notation.nodeTypes
    .find((n) => n.id === 'process')!
    .properties.push({
      key: 'automated',
      label: 'Авторабота',
      type: 'boolean',
      required: false,
      default: false,
    });
  const document: DiagramDocument = {
    schemaVersion: 1,
    notation,
    nodes: [
      {
        id: 'a',
        typeId: 'process',
        position: { x: 0, y: 0 },
        properties: { title: 'Заказ', automated: true },
      },
      {
        id: 'b',
        typeId: 'process',
        position: { x: 300, y: 0 },
        properties: { title: 'Оплата', automated: false },
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
        properties: { label: 'Переход' },
      },
    ],
  };
  const response = await request.post('/api/diagrams', { data: { name: 'Оформление', document } });
  expect(response.status()).toBe(201);
  const created = await response.json();
  await page.goto(`/diagrams/${created.id}`);
  await expect(page.locator('.react-flow__node-notation')).toHaveCount(2);
  await expect(page.locator('.react-flow__node[data-id="a"]')).toBeVisible();
  return created.id as string;
}
async function saved(page: Page) {
  await expect(page.getByText(/Сохранено · ревизия/)).toBeVisible({ timeout: 15000 });
}
test.afterAll(async () => {
  await db.user.deleteMany({ where: { email: { in: emails } } });
  await db.rateLimit.deleteMany({ where: { key: { contains: 'presentation-' } } });
  await db.$disconnect();
});
test('dark background, visible properties and drag without viewport jumps or mid-gesture saves', async ({
  page,
  request,
}) => {
  const id = await diagram(page, request, true);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const colors = await page.evaluate(() =>
    ['body', '.flow-container', '.react-flow'].map(
      (s) => getComputedStyle(document.querySelector(s)!).backgroundColor,
    ),
  );
  expect(colors.every((c) => c !== 'rgb(255, 255, 255)' && c !== 'rgba(0, 0, 0, 0)')).toBe(true);
  const node = page.locator('.react-flow__node[data-id="a"]');
  await expect(node.locator('[data-property="automated"]')).toContainText('Да');
  await node.click();
  const viewport = await page.locator('.react-flow__viewport').getAttribute('style');
  await node.evaluate((el) => {
    (window as any).__originalNode = el;
    (window as any).__originalShape = el.querySelector('.node-shape');
  });
  const puts: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'PUT' && r.url().endsWith(`/diagrams/${id}`)) puts.push(r.url());
  });
  const box = (await node.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 45, box.y + box.height / 2 + 35, { steps: 12 });
  await page.waitForTimeout(1800);
  expect(puts).toHaveLength(0);
  await page.mouse.up();
  await saved(page);
  expect(puts).toHaveLength(1);
  expect(await page.locator('.react-flow__viewport').getAttribute('style')).toBe(viewport);
  expect(
    await node.evaluate(
      (el) => el === (window as any).__originalNode && (window as any).__originalShape.isConnected,
    ),
  ).toBe(true);
  const stored = await (await request.get(`/api/diagrams/${id}`)).json();
  expect(stored.document.nodes[0].position.x).toBeGreaterThan(20);
});
test('inline text, resize, undo, layers and text styling persist', async ({ page, request }) => {
  const id = await diagram(page, request),
    node = page.locator('.react-flow__node[data-id="a"]');
  await node.dblclick();
  await page.getByLabel('Текст объекта', { exact: true }).fill('Новый заказ');
  await page.getByLabel('Текст объекта', { exact: true }).press('Enter');
  await expect(node.locator('.node-label')).toHaveText('Новый заказ');
  await node.dblclick();
  await page.getByLabel('Текст объекта', { exact: true }).fill('Отменить текст');
  await page.getByLabel('Текст объекта', { exact: true }).press('Escape');
  await expect(node.locator('.node-label')).toHaveText('Новый заказ');
  const before = (await node.boundingBox())!,
    handle = node.locator('.react-flow__resize-control.handle.bottom.right');
  await expect(handle).toBeVisible();
  const h = (await handle.boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2 + 50, h.y + h.height / 2 + 30, { steps: 10 });
  await page.mouse.up();
  await expect
    .poll(async () => (await node.boundingBox())!.width)
    .toBeGreaterThan(before.width + 30);
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  await expect.poll(async () => (await node.boundingBox())!.width).toBeCloseTo(before.width, 0);
  await page.getByLabel('Ширина объекта', { exact: true }).fill('240');
  await page.getByLabel('Высота объекта', { exact: true }).fill('130');
  await page.getByRole('button', { name: 'На передний план', exact: true }).click();
  await expect(node).toHaveCSS('z-index', '1');
  await page.getByLabel('Уровень слоя', { exact: true }).fill('42');
  await page.getByLabel('Размер текста, px', { exact: true }).fill('18');
  await page.getByLabel('Поворот текста, °', { exact: true }).fill('90');
  await page.getByLabel('Показывать атрибуты на объекте', { exact: true }).uncheck();
  await expect(node.locator('.node-attributes')).toHaveCount(0);
  await saved(page);
  await page.reload();
  await expect(node.locator('.node-label')).toHaveText('Новый заказ');
  const stored = await (await request.get(`/api/diagrams/${id}`)).json(),
    n = stored.document.nodes[0];
  expect(n.size).toEqual({ width: 240, height: 130 });
  expect(n.layer).toBe(42);
  expect(n.appearance).toMatchObject({ fontSize: 18, textRotation: 90, showAttributes: false });
  await expect(node).toHaveCSS('z-index', '42');
  await expect(node.locator('.node-content')).toHaveCSS('font-size', '18px');
});
test('connection pattern, width, route and both markers persist', async ({ page, request }) => {
  const id = await diagram(page, request);
  await page.locator('.react-flow__edge').click();
  const path = page.locator('.react-flow__edge-path');
  await page.getByLabel('Линия', { exact: true }).selectOption('dotted');
  await page.getByLabel('Толщина линии, px', { exact: true }).fill('4');
  await expect(path).toHaveCSS('stroke-dasharray', '2px, 8px');
  await expect(path).toHaveCSS('stroke-linecap', 'round');
  await page.getByLabel('Окончание связи', { exact: true }).selectOption('none');
  await expect(path).not.toHaveAttribute('marker-end');
  await page.getByLabel('Окончание связи', { exact: true }).selectOption('thick-arrow');
  await expect(page.locator(`[id="maket-${id}-e-end"] path`)).toHaveAttribute(
    'd',
    'M 0 0 L 10 5 L 0 10 L 3 5 Z',
  );
  await page.getByLabel('Линия', { exact: true }).selectOption('custom');
  await page.getByLabel('Штрихи и промежутки', { exact: true }).fill('10 3 2 3');
  await page.getByLabel('Толщина линии, px', { exact: true }).fill('4');
  await page.getByLabel('Начало связи', { exact: true }).selectOption('diamond');
  await page.getByLabel('Окончание связи', { exact: true }).selectOption('hollow-triangle');
  await page.getByLabel('Маршрут связи', { exact: true }).selectOption('straight');
  await expect(path).toHaveCSS('stroke-width', '4px');
  await expect(path).toHaveCSS('stroke-dasharray', '10px, 3px, 2px, 3px');
  await expect(path).toHaveAttribute('marker-end', new RegExp(`maket-${id}-e-end`));
  await saved(page);
  await page.reload();
  await expect(path).toHaveCSS('stroke-width', '4px');
  const stored = await (await request.get(`/api/diagrams/${id}`)).json();
  expect(stored.document.edges[0].appearance).toMatchObject({
    line: 'custom',
    dashPattern: [10, 3, 2, 3],
    width: 4,
    sourceMarker: 'diamond',
    targetMarker: 'hollow-triangle',
    routing: 'straight',
  });
});
test('notation modal stays mounted while editing, custom shape is saved and rendered', async ({
  page,
  request,
}) => {
  await login(page, request, true);
  await page.goto('/notations');
  await page.getByRole('button', { name: 'Создать нотацию', exact: true }).click();
  const dialog = page.locator('dialog[open]');
  await expect(dialog).toBeVisible();
  const before = (await dialog.boundingBox())!;
  await dialog.evaluate((el) => {
    (window as any).__dialog = el;
    (window as any).__dialogClosed = 0;
    new MutationObserver((m) => {
      (window as any).__dialogClosed += m.filter((x) => x.attributeName === 'open').length;
    }).observe(el, { attributes: true });
  });
  await dialog.getByLabel('Название', { exact: true }).first().fill('Фигуры для теста');
  expect(
    await dialog.evaluate(
      (el) => el === (window as any).__dialog && (window as any).__dialogClosed === 0,
    ),
  ).toBe(true);
  expect((await dialog.boundingBox())!.height).toBeCloseTo(before.height, 0);
  await dialog
    .getByRole('button', { name: 'Модифицировать базовую форму', exact: true })
    .nth(1)
    .click();
  const designer = page.getByRole('region', { name: 'Конструктор формы', exact: true });
  await designer.getByLabel('Название формы', { exact: true }).fill('Скошенный процесс');
  await designer.getByLabel('Координата X, %', { exact: true }).fill('15');
  await designer.getByLabel('Скругление углов, %', { exact: true }).fill('8');
  await designer
    .getByRole('button', { name: 'Добавить точку после выбранной', exact: true })
    .click();
  await designer.getByRole('button', { name: 'Сохранить форму', exact: true }).click();
  await dialog.getByRole('button', { name: 'Сохранить нотацию', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Фигуры для теста', exact: true })).toBeVisible();
  const notations = await (await request.get('/api/notations')).json(),
    custom = notations.find((n: any) => n.name === 'Фигуры для теста');
  expect(custom.document.shapes[0]).toMatchObject({ name: 'Скошенный процесс', rounding: 8 });
  expect(custom.document.shapes[0].points).toHaveLength(5);
  const d = await (
    await request.post('/api/diagrams', { data: { name: 'Форма', notationId: custom.id } })
  ).json();
  await page.goto(`/diagrams/${d.id}`);
  await page.getByRole('button', { name: 'Процесс', exact: true }).click();
  await expect(page.locator('.react-flow__node .node-shape path')).toHaveCount(1);
  await saved(page);
  await page.reload();
  await expect(page.locator('.react-flow__node .node-shape path')).toHaveCount(1);
});
