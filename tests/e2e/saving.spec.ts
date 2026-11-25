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
async function setup(page: Page, request: APIRequestContext, edge = true) {
  const email = `saving-${crypto.randomUUID()}@example.com`,
    password = 'Saving-test-password-42',
    salt = randomBytes(16).toString('hex');
  emails.push(email);
  await db.user.create({
    data: {
      email,
      name: 'Сохранение',
      emailVerified: true,
      passwordHash: `${salt}:${scryptSync(password, salt, 64).toString('hex')}`,
      settings: { theme: 'light', snapToGrid: false, autosave: true },
    },
  });
  expect((await request.post('/api/auth/login', { data: { email, password } })).status()).toBe(200);
  await page.context().addCookies((await request.storageState()).cookies);
  const response = await request.post('/api/diagrams', {
    data: {
      name: 'Надёжное сохранение',
      document: {
        schemaVersion: 1,
        notation: builtinNotation,
        nodes: [
          { id: 'a', typeId: 'process', position: { x: 0, y: 0 }, properties: { title: 'A' } },
          { id: 'b', typeId: 'process', position: { x: 400, y: 0 }, properties: { title: 'B' } },
        ],
        edges: edge
          ? [
              {
                id: 'e',
                typeId: 'flow',
                source: 'a',
                target: 'b',
                sourcePort: 'out',
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
  await expect(page.locator('.react-flow__node-notation')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Просмотр', exact: true })).toBeEnabled();
  return created.id as string;
}
async function clean(page: Page) {
  await expect(page.locator('.editor-save-state')).toContainText('Сохранено', { timeout: 15000 });
}
async function removeA(page: Page) {
  await page.locator('.react-flow__node[data-id="a"]').click();
  await page.keyboard.press('Delete');
  await expect(page.locator('.react-flow__node-notation')).toHaveCount(1);
}
test.afterAll(async () => {
  await db.user.deleteMany({ where: { email: { in: emails } } });
  await db.$disconnect();
});

test('delete, undo and redo reach a clean state without an autosave revision loop', async ({
  page,
  request,
}) => {
  const id = await setup(page, request);
  let writes = 0;
  page.on('request', (r) => {
    if (r.method() === 'PUT' && r.url().endsWith(`/api/diagrams/${id}`)) writes++;
  });
  await removeA(page);
  await clean(page);
  expect(writes).toBe(1);
  // More than two debounce intervals: a stale relation snapshot used to keep saving forever.
  await page.waitForTimeout(3500);
  expect(writes).toBe(1);
  await page.locator('.react-flow').focus();
  await page.keyboard.press('Control+z');
  await expect(page.locator('.react-flow__node-notation')).toHaveCount(2);
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await clean(page);
  expect(writes).toBe(2);
  await page.keyboard.press('Control+Shift+z');
  await clean(page);
  await expect(page.locator('.react-flow__node-notation')).toHaveCount(1);
  await page.waitForTimeout(2500);
  expect(writes).toBe(3);
  const doc = (await (await request.get(`/api/diagrams/${id}`)).json()).document;
  expect(doc.edges).toHaveLength(0);
  expect(doc.nodes.map((n: { id: string }) => n.id)).toEqual(['b']);
  await page.reload();
  await expect(page.locator('.react-flow__node-notation')).toHaveCount(1);
  await clean(page);
});

test('deleting during an in-flight first connection save preserves the pending deletion and undo', async ({
  page,
  request,
}) => {
  const id = await setup(page, request, false);
  let release!: () => void,
    reached = false,
    writes = 0;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/diagrams/${id}`, async (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    writes++;
    const response = await route.fetch();
    if (writes === 1) {
      reached = true;
      await gate;
    }
    await route.fulfill({ response });
  });
  const source = page.locator(
    '.react-flow__node[data-id="a"] .react-flow__handle.source[data-handleid="out"]',
  );
  const target = page.locator(
    '.react-flow__node[data-id="b"] .react-flow__handle.target[data-handleid="in"]',
  );
  const from = (await source.boundingBox())!,
    to = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await expect.poll(() => reached).toBe(true);
  await removeA(page);
  release();
  await clean(page);
  await expect(page.getByRole('alert').filter({ hasText: 'Конфликт' })).toHaveCount(0);
  await expect(page.locator('.react-flow__edge')).toHaveCount(0);
  await expect.poll(() => writes).toBe(2);
  await page.waitForTimeout(2200);
  expect(writes).toBe(2);
  await page.locator('.react-flow').focus();
  await page.keyboard.press('Control+z');
  await clean(page);
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  const doc = (await (await request.get(`/api/diagrams/${id}`)).json()).document;
  expect(doc.nodes).toHaveLength(2);
  expect(doc.edges[0].relationId).toBeTruthy();
});

test('deleting a node during resize releases the interrupted gesture and saves normally', async ({
  page,
  request,
}) => {
  await setup(page, request);
  await page.locator('.react-flow__node[data-id="a"]').click();
  const grip = page.locator(
    '.react-flow__node[data-id="a"] .react-flow__resize-control.bottom.right.handle',
  );
  const bounds = (await grip.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 40, bounds.y + 20, { steps: 5 });
  await page.keyboard.press('Delete');
  await page.mouse.up();
  await expect(page.locator('.react-flow__node-notation')).toHaveCount(1);
  await clean(page);
  await page.locator('.react-flow').focus();
  await page.keyboard.press('Control+z');
  await clean(page);
  await expect(page.locator('.react-flow__node-notation')).toHaveCount(2);
});

test('a timed-out save unlocks retry, retains the draft and allows an unsaved JSON download', async ({
  page,
  request,
}) => {
  const id = await setup(page, request);
  await page.evaluate(() => {
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    Object.assign(window, { originalSaveTimeout: timeout });
    AbortSignal.timeout = () => timeout(800);
  });
  let writes = 0;
  await page.route(`**/api/diagrams/${id}`, (route) => {
    if (route.request().method() === 'PUT') {
      writes++;
      return;
    }
    return route.continue();
  });
  await removeA(page);
  const error = page.locator('.editor-error');
  await expect(error).toContainText('не ответил вовремя', { timeout: 10000 });
  await expect(
    page.getByRole('button', { name: 'Повторить сохранение', exact: true }),
  ).toBeEnabled();
  await page.waitForTimeout(2200);
  expect(writes).toBe(1);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать несохранённую копию', exact: true }).click();
  const copy = await pending;
  expect(copy.suggestedFilename()).toMatch(/\.maket\.json$/);
  const { readFile } = await import('node:fs/promises');
  const json = JSON.parse(await readFile((await copy.path())!, 'utf8'));
  expect(json.document.nodes.map((n: { id: string }) => n.id)).toEqual(['b']);
  await page.unroute(`**/api/diagrams/${id}`);
  await page.evaluate(() => {
    AbortSignal.timeout = (
      window as unknown as { originalSaveTimeout: typeof AbortSignal.timeout }
    ).originalSaveTimeout;
  });
  await page.getByRole('button', { name: 'Повторить сохранение', exact: true }).click();
  await clean(page);
  expect((await (await request.get(`/api/diagrams/${id}`)).json()).document.edges).toHaveLength(0);
});
