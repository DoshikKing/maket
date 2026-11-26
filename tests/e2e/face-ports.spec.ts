import 'dotenv/config';
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { scryptSync, randomBytes } from 'node:crypto';
import { databaseConfig } from '../../scripts/database-config.mjs';
import { builtinNotation } from '../../src/lib/notation';
const { connectionString, schema } = databaseConfig();
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }, { schema }) });
const emails: string[] = [];
async function setup(
  page: Page,
  request: APIRequestContext,
  sourceType = 'process',
  legacy = false,
) {
  const email = `face-${crypto.randomUUID()}@example.com`,
    password = 'Saving-test-password-42',
    salt = randomBytes(16).toString('hex');
  emails.push(email);
  await db.user.create({
    data: {
      email,
      name: 'Подключение к грани',
      emailVerified: true,
      passwordHash: `${salt}:${scryptSync(password, salt, 64).toString('hex')}`,
      settings: { theme: 'light', snapToGrid: false, autosave: true },
    },
  });
  expect((await request.post('/api/auth/login', { data: { email, password } })).status()).toBe(200);
  await page.context().addCookies((await request.storageState()).cookies);
  const response = await request.post('/api/diagrams', {
    data: {
      name: 'Подключение к грани',
      document: {
        schemaVersion: 1,
        notation: builtinNotation,
        nodes: [
          { id: 'c', typeId: 'process', position: { x: 400, y: 220 }, properties: { title: 'C' } },
          { id: 'a', typeId: sourceType, position: { x: 0, y: 0 }, properties: { title: 'A' } },
          { id: 'b', typeId: 'process', position: { x: 400, y: 0 }, properties: { title: 'B' } },
        ],
        edges: legacy
          ? [
              {
                id: 'legacy',
                typeId: 'flow',
                source: 'a',
                target: 'b',
                sourcePort: 'yes',
                targetPort: 'in',
                properties: {},
              },
            ]
          : [],
      },
    },
  });
  expect(response.status()).toBe(201);
  const created = await response.json();
  await page.goto(`/diagrams/${created.id}`);
  await expect(page.locator('.react-flow__node-notation')).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Просмотр', exact: true })).toBeEnabled();
  await page.locator('.react-flow__controls-fitview').click();
  await expect(page.locator('.react-flow__viewport')).not.toHaveCSS(
    'transform',
    'matrix(1, 0, 0, 1, 0, 0)',
  );
  return created.id as string;
}
async function clean(page: Page) {
  await expect(page.locator('.editor-save-state')).toContainText('Сохранено', { timeout: 15000 });
}
test.afterAll(async () => {
  await db.user.deleteMany({ where: { email: { in: emails } } });
  await db.$disconnect();
});
// Native mouse events round CSS pixels; the fixture fits the canvas at a fractional zoom.
const expectRatio = (value: number, expected: number) =>
  expect(Math.abs(value - expected)).toBeLessThan(0.025);
const point = async (page: Page, id: string, side: 'source' | 'target', ratio: number) => {
  const b = await page.locator(`.react-flow__node[data-id="${id}"]`).boundingBox();
  if (!b) throw new Error('Missing node');
  return { x: side === 'source' ? b.x + b.width + 2 : b.x - 2, y: b.y + b.height * ratio };
};
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 24 });
  await page.mouse.up();
  await clean(page);
}
test('connects anywhere on a face, preserves separate attachments, reconnects and survives resize/reload/export', async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  const id = await setup(page, request);
  const read = async () => (await (await request.get(`/api/diagrams/${id}`)).json()).document;
  const from = await point(page, 'a', 'source', 0.2);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 80, from.y + 15, { steps: 8 });
  await expect(page.locator('.react-flow__connection-path')).toBeVisible();
  const preview = (await page.locator('.react-flow__connection-path').getAttribute('d'))!.match(
    /^M\s*([\d.-]+)[ ,]+([\d.-]+)/,
  )!;
  expect(Number(preview[1])).toBeCloseTo(180, 1);
  expect(Math.abs(Number(preview[2]) - 16)).toBeLessThan(2);
  const to = await point(page, 'b', 'target', 0.3);
  await page.mouse.move(to.x, to.y, { steps: 20 });
  await page.mouse.up();
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await clean(page);
  await drag(page, await point(page, 'a', 'source', 0.8), await point(page, 'b', 'target', 0.7));
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);
  let doc = await read();
  expect(doc.edges[0]).toMatchObject({
    source: 'a',
    target: 'b',
    sourcePort: 'out',
    targetPort: 'in',
    sourceAnchor: { x: 1 },
    targetAnchor: { x: 0 },
  });
  expectRatio(doc.edges[0].sourceAnchor.y, 0.2);
  expectRatio(doc.edges[0].targetAnchor.y, 0.3);
  expectRatio(doc.edges[1].sourceAnchor.y, 0.8);
  expectRatio(doc.edges[1].targetAnchor.y, 0.7);
  const edgeId = doc.edges[0].id;
  const updater = page.locator(
    `.react-flow__edge[data-id="${edgeId}"] .react-flow__edgeupdater-target`,
  );
  const b = await updater.boundingBox();
  if (!b) throw new Error('Missing updater');
  await drag(
    page,
    { x: b.x + b.width / 2, y: b.y + b.height / 2 },
    await point(page, 'c', 'target', 0.85),
  );
  doc = await read();
  const e = doc.edges.find((e: { id: string }) => e.id === edgeId);
  expect(e.target).toBe('c');
  expectRatio(e.targetAnchor.y, 0.85);
  expectRatio(e.sourceAnchor.y, 0.2);
  const a = page.locator('.react-flow__node[data-id="a"]');
  await a.click();
  const beforeResize = (await a.boundingBox())!;
  const resize = a.locator('.react-flow__resize-control.bottom.right.handle');
  const r = await resize.boundingBox();
  if (!r) throw new Error('Missing resizer');
  await drag(
    page,
    { x: r.x + r.width / 2, y: r.y + r.height / 2 },
    { x: r.x + r.width / 2 + 40, y: r.y + r.height / 2 + 60 },
  );
  await expect
    .poll(async () => (await a.boundingBox())!.height)
    .toBeGreaterThan(beforeResize.height + 20);
  await clean(page);
  doc = await read();
  expect(doc.nodes.find((n: { id: string }) => n.id === 'a').size.height).toBeGreaterThan(80);
  expectRatio(doc.edges.find((e: { id: string }) => e.id === edgeId).sourceAnchor.y, 0.2);
  await page.reload();
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);
  await clean(page);
  expectRatio(
    (await read()).edges.find((e: { id: string }) => e.id === edgeId).targetAnchor.y,
    0.85,
  );
  const selectedArrow = page.locator(`.react-flow__edge[data-id="${edgeId}"]`);
  await selectedArrow.locator('.react-flow__edge-interaction').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Свойства представления', exact: true }).click();
  await page.getByLabel('Положение конца, %', { exact: true }).click({ timeout: 5000 });
  await expect(page.getByLabel('Положение конца, %', { exact: true })).toBeFocused();
  await page.getByLabel('Положение конца, %', { exact: true }).fill('60');
  await expect(page.getByLabel('Положение конца, %', { exact: true })).toHaveValue('60');
  await page.getByLabel('Положение конца, %', { exact: true }).press('Tab');
  await clean(page);
  await expect
    .poll(
      async () => (await read()).edges.find((e: { id: string }) => e.id === edgeId).targetAnchor.y,
    )
    .toBe(0.6);
  await clean(page);
  await page.getByRole('button', { name: 'Экспорт', exact: true }).click();
  await expect(
    page.locator(`.export-preview svg [data-representation-id="${edgeId}"] > path`),
  ).toHaveCount(1);
  await page.screenshot({ path: '/tmp/maket-face-ports.png' });
});
test('face ports support keyboard click connections and preserve invalid connection feedback', async ({
  page,
  request,
}) => {
  await setup(page, request);
  const output = page.locator('.react-flow__node[data-id="a"] .face-port.source');
  const input = page.locator('.react-flow__node[data-id="b"] .face-port.target');
  await output.focus();
  await page.keyboard.press('Enter');
  await input.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await clean(page);
  await drag(page, await point(page, 'a', 'source', 0.4), await point(page, 'b', 'source', 0.4));
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await expect(page.locator('.connection-toast').filter({ hasText: 'Соедините' })).toBeVisible();
});

test('partitions multiple semantic ports into face zones without losing their identities', async ({
  page,
  request,
}) => {
  const id = await setup(page, request, 'decision');
  const source = page.locator('.react-flow__node[data-id="a"] .face-port.source');
  await expect(source).toHaveCount(2);
  await drag(page, await point(page, 'a', 'source', 0.2), await point(page, 'b', 'target', 0.2));
  await drag(page, await point(page, 'a', 'source', 0.8), await point(page, 'b', 'target', 0.8));
  const result = await (await request.get(`/api/diagrams/${id}`)).json();
  expect(result.document.edges.map((e: { sourcePort: string }) => e.sourcePort)).toEqual([
    'yes',
    'no',
  ]);
  expectRatio(result.document.edges[0].sourceAnchor.y, 0.2);
  expectRatio(result.document.edges[1].sourceAnchor.y, 0.8);
});

test('keeps existing multi-port attachments in place and enforces port capacity', async ({
  page,
  request,
}) => {
  const id = await setup(page, request, 'decision', true);
  const path = page.locator('.react-flow__edge[data-id="legacy"] .react-flow__edge-path');
  await expect(path).toHaveAttribute('d', /^M\s*150[ ,]+33\.333/);
  await drag(page, await point(page, 'a', 'source', 0.05), await point(page, 'b', 'target', 0.1));
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await expect(page.locator('.connection-toast')).toContainText('Превышено число связей порта yes');
  const doc = (await (await request.get(`/api/diagrams/${id}`)).json()).document;
  expect(doc.edges[0].sourceAnchor).toBeUndefined();
  expect(doc.edges[0].sourcePort).toBe('yes');
});
