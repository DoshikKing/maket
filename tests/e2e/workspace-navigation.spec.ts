import 'dotenv/config';
import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { scryptSync, randomBytes } from 'node:crypto';
import { databaseConfig } from '../../scripts/database-config.mjs';
import { builtinNotation } from '../../src/lib/notation';
const { connectionString, schema } = databaseConfig();
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }, { schema }) });
const emails: string[] = [];
test.afterAll(async () => {
  await db.user.deleteMany({ where: { email: { in: emails } } });
  await db.$disconnect();
});

test('diagram browser shares the workspace tree; notation settings work from tree and canvas', async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  const email = `workspace-navigation-${crypto.randomUUID()}@example.com`,
    password = 'Navigation-password-42',
    salt = randomBytes(16).toString('hex');
  emails.push(email);
  await db.user.create({
    data: {
      email,
      name: 'Навигация',
      emailVerified: true,
      passwordHash: `${salt}:${scryptSync(password, salt, 64).toString('hex')}`,
    },
  });
  expect((await request.post('/api/auth/login', { data: { email, password } })).status()).toBe(200);
  await page.context().addCookies((await request.storageState()).cookies);
  const response = await request.post('/api/diagrams', {
    data: {
      name: 'Процесс доставки',
      document: {
        schemaVersion: 1,
        notation: builtinNotation,
        nodes: [
          {
            id: 'process',
            typeId: 'process',
            position: { x: 0, y: 0 },
            properties: { title: 'Принять заказ' },
          },
        ],
        edges: [],
      },
    },
  });
  expect(response.status()).toBe(201);
  const d = await response.json();
  const notations = await (await request.get('/api/notations')).json();
  const bpmn = notations.find((n: { name: string }) => n.name.includes('BPMN'));
  await page.goto('/library');
  await expect(page).toHaveURL(/\/solutions\?view=diagrams$/);
  await expect(page.locator('.sidebar').getByRole('link', { name: 'Библиотека' })).toHaveCount(0);
  await expect(
    page.locator('.sidebar').getByRole('link', { name: 'Рабочая область', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('tree', { name: 'Структура решений' })).toBeVisible();
  await expect(page.locator('.diagram-card')).toHaveCount(1);
  await page.getByRole('link', { name: 'Модель', exact: true }).click();
  await page.goto(`/solutions?parent=${d.entityId}`);
  await page
    .locator('.solution-content')
    .getByRole('button', { name: 'Свойства', exact: true })
    .click();
  const properties = page.getByRole('dialog', { name: 'Свойства диаграммы', exact: true });
  await expect(properties.getByLabel('Добавить нотацию', { exact: true })).toBeEnabled();
  await properties.getByLabel('Добавить нотацию', { exact: true }).selectOption(bpmn.id);
  await expect(
    properties.getByRole('button', { name: `Отключить ${bpmn.name}`, exact: true }),
  ).toBeEnabled();
  await expect(
    properties.getByRole('button', { name: `Отключить ${builtinNotation.name}`, exact: true }),
  ).toBeDisabled();
  await page.keyboard.press('Escape');
  await page
    .locator('.solution-content')
    .getByRole('link', { name: 'Открыть диаграмму →', exact: true })
    .click();
  await expect(page.locator('.react-flow__node-notation')).toHaveCount(1);
  await expect(
    page.locator('.palette').getByRole('button', { name: 'Нотации диаграммы', exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Свойства диаграммы Процесс доставки', exact: true })
    .click();
  await properties.getByRole('button', { name: `Отключить ${bpmn.name}`, exact: true }).click();
  await expect(
    properties.getByRole('button', { name: `Отключить ${bpmn.name}`, exact: true }),
  ).toHaveCount(0);
  await properties.getByLabel('Название диаграммы', { exact: true }).fill('Доставка заказа');
  await properties.getByRole('button', { name: 'Сохранить название', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Свойства диаграммы Доставка заказа', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Импорт', exact: true })).toBeVisible();
  // Editing the current diagram from its tree uses the editor's live revision and flushes pending edits.
  await page.locator(`.object-tree [data-tree-entity="${d.entityId}"]`).click({ button: 'right' });
  await page
    .getByRole('menu')
    .getByRole('menuitem', { name: /Изменить/ })
    .click();
  await expect(properties.getByLabel('Добавить нотацию', { exact: true })).toBeEnabled();
  await properties.getByLabel('Добавить нотацию', { exact: true }).selectOption(bpmn.id);
  await expect(
    properties.getByRole('button', { name: `Отключить ${bpmn.name}`, exact: true }),
  ).toBeEnabled();
  await properties.getByRole('button', { name: `Отключить ${bpmn.name}`, exact: true }).click();
  await expect(
    properties.getByRole('button', { name: `Отключить ${bpmn.name}`, exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: 'Диаграммы', exact: true }).click();
  await expect(page.locator('.diagram-card')).toHaveCount(1);
  await page.locator('.diagram-browser input[type=file]').setInputFiles({
    name: 'Imported.maket.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        name: 'Импорт из рабочей области',
        schemaVersion: 1,
        notation: builtinNotation,
        nodes: [],
        edges: [],
      }),
    ),
  });
  await expect(page).toHaveURL(/\/solutions\?diagram=/);
  await expect(
    page.getByRole('button', { name: 'Свойства диаграммы Импорт из рабочей области', exact: true }),
  ).toBeVisible();
  const stored = await (await request.get(`/api/diagrams/${d.id}`)).json();
  expect(stored.name).toBe('Доставка заказа');
  expect(stored.document.bindings).toHaveLength(1);
});
