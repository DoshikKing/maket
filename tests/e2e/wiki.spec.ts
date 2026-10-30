import 'dotenv/config';
import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { databaseConfig } from '../../scripts/database-config.mjs';
import { wikiArticles } from '../../src/lib/wiki';
const { connectionString, schema } = databaseConfig();
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }, { schema }) });
const emails: string[] = [];
test.afterAll(async () => {
  await db.user.deleteMany({ where: { email: { in: emails } } });
  await db.rateLimit.deleteMany({
    where: { key: { in: emails.map((email) => `login:${email}`) } },
  });
  await db.$disconnect();
});

test('public wiki: all articles, search, anchors, themes, responsive navigation and no authentication', async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1480, height: 1000 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/wiki');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('От идеи до общей модели.');
  expect(await page.context().cookies()).not.toEqual(
    expect.arrayContaining([expect.objectContaining({ name: 'maket_session' })]),
  );
  for (const article of wikiArticles) {
    const response = await request.get(`/wiki/${article.slug}`);
    expect(response.status(), article.slug).toBe(200);
    const html = await response.text();
    expect(html).toContain(article.title);
    for (const section of article.sections) expect(html).toContain(`id="${section.id}"`);
    for (const related of article.related)
      expect(wikiArticles.some((a) => a.slug === related)).toBe(true);
  }
  expect((await request.get('/wiki/nonexistent-article')).status()).toBe(404);
  await page.getByRole('searchbox', { name: 'Поиск по вики' }).fill('посимвольного');
  await expect(page.getByRole('status')).toHaveText('Найдено статей: 1');
  await page
    .getByRole('navigation', { name: 'Статьи вики' })
    .getByRole('link', { name: /Совместная работа и права/ })
    .click();
  await expect(page).toHaveURL(/\/wiki\/collaboration$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Совместная работа и права');
  await page
    .getByRole('navigation', { name: 'В этой статье' })
    .getByRole('link', { name: 'Блокировки и журнал' })
    .click();
  await expect(page).toHaveURL(/#locks$/);
  await page.getByRole('searchbox').fill('неттакойстатьи');
  await expect(page.getByRole('status')).toHaveText('Найдено статей: 0');
  await page.getByRole('searchbox').fill('');
  await page.getByRole('button', { name: 'Включить тёмную тему вики' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/wiki-desktop-dark.png', fullPage: true });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Включить светлую тему вики' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/wiki');
  const menu = page.getByRole('button', { name: 'Разделы вики' });
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await menu.click();
  await page.getByRole('searchbox').fill('декомпозиция');
  await page
    .getByRole('navigation', { name: 'Статьи вики' })
    .getByRole('link', { name: /Ракурсы, декомпозиция и углубление/ })
    .click();
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Ракурсы, декомпозиция и углубление',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/wiki-mobile.png', fullPage: true });
  await page.goto('/wiki/deployment');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('workspace opens wiki in a new tab from both full and compact navigation', async ({
  page,
  request,
}) => {
  const email = `wiki-${randomUUID()}@example.com`,
    password = 'Wiki-test-password-42';
  const salt = randomBytes(16).toString('hex');
  emails.push(email);
  await db.user.create({
    data: {
      email,
      name: 'Wiki reader',
      emailVerified: true,
      passwordHash: `${salt}:${scryptSync(password, salt, 64).toString('hex')}`,
    },
  });
  expect((await request.post('/api/auth/login', { data: { email, password } })).status()).toBe(200);
  await page.context().addCookies((await request.storageState()).cookies);
  await page.goto('/library');
  const help = page.getByRole('link', { name: 'Вики и справка (откроется в новой вкладке)' });
  await expect(help).toBeVisible();
  await expect(help).toHaveAttribute('target', '_blank');
  await page.getByRole('button', { name: 'Свернуть меню', exact: true }).click();
  await expect(help).toBeVisible();
  const popup = page.waitForEvent('popup');
  await help.click();
  const wiki = await popup;
  await expect(wiki).toHaveURL(/\/wiki$/);
  await expect(wiki.getByRole('heading', { level: 1 })).toHaveText('От идеи до общей модели.');
  await expect(page).toHaveURL(/\/library$/);
  await wiki.getByRole('button', { name: 'Включить тёмную тему вики' }).click();
  await wiki.getByRole('link', { name: 'В приложение', exact: true }).click();
  await expect(wiki).toHaveURL(/\/library$/);
  await expect(wiki.locator('html')).toHaveAttribute('data-theme', 'light');
  await wiki.close();
});
