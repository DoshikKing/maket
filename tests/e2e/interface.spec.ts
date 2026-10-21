import 'dotenv/config';
import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomBytes, scryptSync } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { builtinNotation } from '../../src/lib/notation';

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
const emails: string[] = [];
test.afterAll(async () => {
  await db.user.deleteMany({ where: { email: { in: emails } } });
  await db.rateLimit.deleteMany({ where: { key: { contains: 'interface-' } } });
  await db.$disconnect();
});

test('appearance, native dialogs, keyboard navigation, compact sidebar and reduced motion', async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const email = `interface-${crypto.randomUUID()}@example.com`,
    password = 'Interface-password-42',
    salt = randomBytes(16).toString('hex');
  emails.push(email);
  await db.user.create({
    data: {
      email,
      name: 'Александра Иванова',
      emailVerified: true,
      passwordHash: `${salt}:${scryptSync(password, salt, 64).toString('hex')}`,
    },
  });
  expect((await request.post('/api/auth/login', { data: { email, password } })).status()).toBe(200);
  await page.context().addCookies((await request.storageState()).cookies);
  let diagramId = '';
  for (const name of ['Путь обращения клиента', 'Архитектура платформы', 'Интеграции сервисов']) {
    const response = await request.post('/api/diagrams', {
      data: {
        name,
        document: {
          schemaVersion: 1,
          notation: builtinNotation,
          nodes: [
            {
              id: 'a',
              typeId: 'process',
              position: { x: 0, y: 0 },
              properties: { title: 'Получить обращение' },
            },
            {
              id: 'b',
              typeId: 'process',
              position: { x: 320, y: 0 },
              properties: { title: 'Обработать заявку' },
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
              properties: { label: 'Передать' },
            },
          ],
        },
      },
    });
    expect(response.status()).toBe(201);
    diagramId ||= (await response.json()).id;
  }
  const capture = async (name: string) => {
    if (process.env.MAKET_DESIGN_SCREENSHOTS) {
      await mkdir('/tmp/maket-design', { recursive: true });
      await page.screenshot({
        path: `/tmp/maket-design/${name}.png`,
        fullPage: true,
        animations: 'disabled',
      });
    }
  };
  await page.goto('/library');
  await expect(page.getByRole('link', { name: 'Библиотека', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.locator('.diagram-card')).toHaveCount(3);
  await capture('library-light');
  // Tab navigation reaches a skip link and its destination, without hiding the focus indicator.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'К содержимому' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#workspace-content')).toBeFocused();
  const create = page.getByRole('button', { name: 'Создать диаграмму', exact: true });
  await create.click();
  const dialog = page.getByRole('dialog', { name: 'Новая диаграмма' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'Название', exact: true })).toBeFocused();
  await capture('dialog-light');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(create).toBeFocused();
  await page.getByRole('link', { name: 'Настройки', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Настройки', exact: true })).toBeVisible();
  await capture('settings-light');
  await page.getByRole('radio', { name: 'Тёмная', exact: true }).check();
  await page.getByRole('button', { name: 'Сохранить настройки' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('status')).toHaveText('Настройки сохранены');
  await expect(page.getByRole('switch', { name: /Автосохранение/ })).toBeChecked();
  await capture('settings-dark');
  await page.reload();
  await expect(page.getByRole('radio', { name: 'Тёмная', exact: true })).toBeChecked();
  await page.goto('/library');
  await expect(page.locator('.diagram-card')).toHaveCount(3);
  await capture('library-dark');
  await page.goto(`/diagrams/${diagramId}`);
  await expect(page.locator('.react-flow__node-notation')).toHaveCount(2);
  await page.locator('.react-flow__node[data-id="a"]').click();
  await page.locator('.react-flow__controls-fitview').click();
  await capture('editor-dark');
  await page.locator('.react-flow__node[data-id="a"]').click({ button: 'right' });
  await expect(page.getByRole('menu')).toBeVisible();
  await capture('context-dark');
  await page.keyboard.press('Escape');
  await page.goto('/settings');
  await page.getByRole('radio', { name: 'Светлая', exact: true }).check();
  await page.getByRole('button', { name: 'Сохранить настройки' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.goto(`/diagrams/${diagramId}`);
  await expect(page.locator('.react-flow__node-notation')).toHaveCount(2);
  await page.locator('.react-flow__controls-fitview').click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await capture('editor-light');
  await page.goto('/notations');
  await expect(page.getByRole('heading', { name: /^Нотации/, level: 1 })).toBeVisible();
  await capture('notations-light');
  await page.goto('/solutions');
  await expect(page.locator('.solutions-layout')).toBeVisible();
  await capture('solutions-light');
  await page.goto('/library');
  await expect(page.locator('.diagram-card')).toHaveCount(3);
  await page.getByRole('button', { name: 'Свернуть меню', exact: true }).click();
  await expect(page.locator('.sidebar')).toHaveClass(/is-collapsed/);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await create.click();
  await expect(dialog).toBeVisible();
  expect(
    await dialog.evaluate((el) => parseFloat(getComputedStyle(el).animationDuration)),
  ).toBeLessThan(0.01);
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.sidebar')).toHaveCSS('width', '72px');
  const noOverflow = async () =>
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  await noOverflow();
  await capture('library-mobile');
  await page.getByRole('link', { name: 'Настройки', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Светлая', exact: true })).toBeVisible();
  await noOverflow();
  await capture('settings-mobile');
  await page.context().clearCookies();
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'С возвращением' })).toBeVisible();
  await noOverflow();
  await capture('login-mobile');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await capture('login-desktop');
});
