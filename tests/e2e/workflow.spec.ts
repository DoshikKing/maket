import 'dotenv/config';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { readFile } from 'node:fs/promises';
import { builtinNotation, type DiagramDocument } from '../../src/lib/notation';
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
const emails: string[] = [];
const password = 'Maket-test-password-42';
async function mailToken(email: string, kind: string) {
  let raw = '';
  await expect
    .poll(async () => {
      raw = await readFile('/tmp/maket-e2e-server.log', 'utf8');
      return raw.includes(`[maket mail] ${email}: http://localhost:3000/${kind}?token=`);
    })
    .toBe(true);
  return [
    ...raw.matchAll(
      new RegExp(
        `\\[maket mail\\] ${email.replaceAll('.', '\\.')}: http://localhost:3000/${kind}\\?token=([a-f0-9]{64})`,
        'g',
      ),
    ),
  ].at(-1)![1];
}
async function register(request: APIRequestContext) {
  const email = `test-${crypto.randomUUID()}@example.com`;
  emails.push(email);
  const r = await request.post('/api/auth/register', {
    data: { email, password, name: 'Тестировщик' },
  });
  expect(r.status()).toBe(200);
  const token = await mailToken(email, 'verify');
  expect((await request.post('/api/auth/verify', { data: { token } })).status()).toBe(200);
  expect((await request.post('/api/auth/login', { data: { email, password } })).status()).toBe(200);
  return email;
}
test.afterAll(async () => {
  await db.user.deleteMany({ where: { email: { in: emails } } });
  await db.rateLimit.deleteMany({ where: { key: { contains: '@example.com' } } });
  await db.$disconnect();
});
test('registration, real verification link, password recovery and session invalidation', async ({
  request,
}) => {
  const email = `test-${crypto.randomUUID()}@example.com`;
  emails.push(email);
  expect(
    (
      await request.post('/api/auth/register', { data: { email, password, name: 'Анна' } })
    ).status(),
  ).toBe(200);
  expect((await request.post('/api/auth/login', { data: { email, password } })).status()).toBe(403);
  const token = await mailToken(email, 'verify');
  expect((await request.post('/api/auth/verify', { data: { token } })).status()).toBe(200);
  expect((await request.post('/api/auth/verify', { data: { token } })).status()).toBe(400);
  expect((await request.post('/api/auth/login', { data: { email, password } })).status()).toBe(200);
  expect((await request.get('/api/auth/me')).status()).toBe(200);
  expect((await request.post('/api/auth/recover', { data: { email } })).status()).toBe(200);
  const reset = await mailToken(email, 'reset'),
    next = 'New-test-password-43';
  expect(
    (await request.post('/api/auth/reset', { data: { token: reset, password: next } })).status(),
  ).toBe(200);
  expect((await request.get('/api/auth/me')).status()).toBe(401);
  expect((await request.post('/api/auth/login', { data: { email, password } })).status()).toBe(401);
  expect(
    (await request.post('/api/auth/login', { data: { email, password: next } })).status(),
  ).toBe(200);
  expect(
    (await request.post('/api/auth/reset', { data: { token: reset, password: next } })).status(),
  ).toBe(400);
});
test('diagram lifecycle, immutable notation, optimistic concurrency, restoration and ownership', async ({
  request,
  playwright,
}) => {
  await register(request);
  const created = await request.post('/api/diagrams', {
    data: { name: 'Проверка API', notationId: 'builtin' },
  });
  expect(created.status()).toBe(201);
  const diagram = await created.json();
  const document: DiagramDocument = diagram.document;
  document.nodes = [
    { id: 'a', typeId: 'process', position: { x: 0, y: 0 }, properties: { title: 'Заказ' } },
    { id: 'b', typeId: 'process', position: { x: 250, y: 0 }, properties: { title: 'Оплата' } },
  ];
  document.edges = [
    {
      id: 'e',
      typeId: 'flow',
      source: 'a',
      target: 'b',
      sourcePort: 'out',
      targetPort: 'in',
      properties: { label: 'Переход' },
    },
  ];
  expect(
    (
      await request.put(`/api/diagrams/${diagram.id}`, { data: { revision: 1, document } })
    ).status(),
  ).toBe(200);
  expect(
    (
      await request.put(`/api/diagrams/${diagram.id}`, { data: { revision: 1, document } })
    ).status(),
  ).toBe(409);
  const bad = structuredClone(document);
  bad.edges[0].sourcePort = 'in';
  expect(
    (
      await request.put(`/api/diagrams/${diagram.id}`, { data: { revision: 2, document: bad } })
    ).status(),
  ).toBe(400);
  const changed = structuredClone(document);
  changed.notation.name = 'Подмена';
  expect(
    (
      await request.put(`/api/diagrams/${diagram.id}`, { data: { revision: 2, document: changed } })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.post(`/api/diagrams/${diagram.id}/restore`, {
        data: { revision: 2, number: 1 },
      })
    ).status(),
  ).toBe(200);
  const restored = await (await request.get(`/api/diagrams/${diagram.id}`)).json();
  expect(restored.revision).toBe(3);
  expect(restored.document.nodes).toHaveLength(0);
  expect(await (await request.get(`/api/diagrams/${diagram.id}/revisions`)).json()).toHaveLength(3);
  const imported = await request.post('/api/diagrams', {
    data: { name: 'Импорт', document: JSON.parse(JSON.stringify(document)) },
  });
  expect(imported.status()).toBe(201);
  expect((await imported.json()).document).toEqual(document);
  const other = await playwright.request.newContext({ baseURL: 'http://localhost:3000' });
  await register(other);
  for (const method of ['get', 'delete'] as const)
    expect((await other[method](`/api/diagrams/${diagram.id}`)).status()).toBe(404);
  await other.dispose();
  expect((await request.delete(`/api/diagrams/${diagram.id}`)).status()).toBe(200);
  expect((await request.get(`/api/diagrams/${diagram.id}`)).status()).toBe(404);
});
test('notation updates do not change existing diagrams; references prevent deletion', async ({
  request,
}) => {
  await register(request);
  const n = structuredClone(builtinNotation);
  n.id = 'test-custom';
  n.name = 'Моя нотация';
  const r = await request.post('/api/notations', { data: n });
  expect(r.status()).toBe(201);
  const notation = await r.json();
  const d = await (
    await request.post('/api/diagrams', {
      data: { name: 'На старой нотации', notationId: notation.id },
    })
  ).json();
  n.version = '1.0.1';
  n.nodeTypes[0].appearance.fill = '#aabbcc';
  expect((await request.put(`/api/notations/${notation.id}`, { data: n })).status()).toBe(200);
  const old = await (await request.get(`/api/diagrams/${d.id}`)).json();
  expect(old.document.notation.version).toBe('1.0.0');
  expect(old.document.notation.nodeTypes[0].appearance.fill).not.toBe('#aabbcc');
  expect((await request.put(`/api/notations/${notation.id}`, { data: n })).status()).toBe(400);
  expect((await request.delete(`/api/notations/${notation.id}`)).status()).toBe(409);
  expect(
    (
      await request.post('/api/diagrams', { data: { name: 'Новая', notationId: notation.id } })
    ).status(),
  ).toBe(201);
});
test('browser: login, create, connect, edit, undo, save, reopen and export', async ({
  page,
  request,
}) => {
  const email = await register(request);
  await request.post('/api/auth/logout', { data: {} });
  await page.goto('/login');
  await page.getByLabel('Электронная почта', { exact: true }).fill(email);
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Войти в maket' }).click();
  await expect(page).toHaveURL(/\/library/);
  await page.getByRole('button', { name: 'Создать диаграмму', exact: true }).click();
  await page.getByLabel('Название', { exact: true }).fill('Заказ — браузерный тест');
  await page.getByRole('button', { name: 'Открыть редактор' }).click();
  await expect(page).toHaveURL(/\/diagrams\//);
  await page.getByRole('button', { name: 'Процесс', exact: true }).click();
  await page.getByRole('button', { name: 'Начало / конец', exact: true }).click();
  const node = page.locator('.react-flow__node').first();
  await node.click();
  await page.getByLabel('Название', { exact: false }).fill('Получить заказ');
  // Move the second node before drawing a connection.
  const second = page.locator('.react-flow__node').nth(1);
  const box = (await second.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 70, box.y + box.height / 2 + 150, { steps: 15 });
  await page.mouse.up();
  const source = node.locator('.source'),
    target = second.locator('.target');
  const a = (await source.boundingBox())!,
    b = (await target.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 20 });
  await page.mouse.up();
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await expect(page.getByText(/Сохранено · ревизия/)).toBeVisible({ timeout: 15000 });
  const url = page.url();
  await page.reload();
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await expect(page.locator('.node-label').first()).toHaveText('Получить заказ');
  await page.getByRole('button', { name: 'Процесс', exact: true }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Экспорт', exact: true }).click();
  expect((await downloaded).suggestedFilename()).toMatch(/\.maket\.json$/);
  await page.getByRole('button', { name: 'История', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'История диаграммы' })).toBeVisible();
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(page.getByText(/Сохранено · ревизия/)).toBeVisible({ timeout: 15000 });
  await page.goto('/settings');
  await page.getByLabel('Имя', { exact: true }).fill('Анна');
  await page.getByRole('button', { name: 'Сохранить настройки' }).click();
  await expect(page.getByText('Настройки сохранены')).toBeVisible();
  await page.goto(url);
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
});

test('browser: custom notation through JSON, diagram import and persistent dark settings', async ({
  page,
  request,
}) => {
  await register(request);
  await page.context().addCookies((await request.storageState()).cookies);
  await page.goto('/notations');
  await page.getByRole('button', { name: 'Создать нотацию', exact: true }).click();
  await page.getByRole('button', { name: 'JSON', exact: true }).click();
  const notation = structuredClone(builtinNotation);
  notation.id = 'service-map';
  notation.name = 'Карта сервисов';
  notation.description = 'Сервисы и потоки данных';
  notation.nodeTypes[1].name = 'Сервис';
  notation.nodeTypes[1].properties.push(
    { key: 'replicas', label: 'Реплики', type: 'number', required: true, default: 1 },
    { key: 'enabled', label: 'Активен', type: 'boolean', required: true, default: true },
  );
  await page.getByLabel('JSON нотации').fill(JSON.stringify(notation, null, 2));
  await page.getByRole('button', { name: 'Сохранить нотацию', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Карта сервисов', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/notations.png', fullPage: true });
  await page.getByRole('link', { name: 'Библиотека', exact: true }).click();
  await page.getByRole('button', { name: 'Создать диаграмму', exact: true }).click();
  await page.getByLabel('Название', { exact: true }).fill('Архитектура магазина');
  await page.getByRole('button', { name: /Карта сервисов/ }).click();
  await page.getByRole('button', { name: 'Открыть редактор' }).click();
  await expect(page).toHaveURL(/\/diagrams\//);
  await page.getByRole('button', { name: 'Сервис', exact: true }).click();
  await page.getByLabel('Реплики', { exact: false }).fill('3');
  await page.getByLabel('Активен', { exact: false }).uncheck();
  await page.getByLabel('Название', { exact: false }).fill('Каталог');
  // Navigate immediately: the editor must flush the pending autosave before following the link.
  await page.getByRole('link', { name: 'Библиотека', exact: true }).click();
  await expect(page).toHaveURL(/\/library/);
  await page.getByRole('link', { name: 'Архитектура магазина', exact: true }).click();
  await expect(page.locator('.node-label')).toHaveText('Каталог');
  await page.locator('.react-flow__node').click();
  await expect(page.getByLabel('Реплики', { exact: false })).toHaveValue('3');
  await expect(page.getByLabel('Активен', { exact: false })).not.toBeChecked();
  await page.screenshot({ path: 'test-results/editor.png', fullPage: true });
  const exported = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Экспорт', exact: true }).click();
  const file = await exported;
  const path = (await file.path())!;
  await page.getByRole('link', { name: 'Библиотека', exact: true }).click();
  await expect(page).toHaveURL(/\/library/);
  await page.locator('input[type=file]').setInputFiles({
    name: 'diagram.maket.json',
    mimeType: 'application/json',
    buffer: await readFile(path),
  });
  await expect(page).toHaveURL(/\/diagrams\//);
  await expect(page.locator('.node-label')).toHaveText('Каталог');
  await page.getByRole('link', { name: 'Настройки', exact: true }).click();
  await page.getByLabel('Тема', { exact: true }).selectOption('dark');
  await page.getByRole('button', { name: 'Сохранить настройки' }).click();
  await expect(page.locator('.workspace')).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator('.workspace')).toHaveClass(/dark/);
  await page.getByLabel('Тема', { exact: true }).selectOption('light');
  await page.getByRole('button', { name: 'Сохранить настройки' }).click();
  await expect(page.locator('.workspace')).not.toHaveClass(/dark/);
  await page.getByRole('link', { name: 'Библиотека', exact: true }).click();
  await page.screenshot({ path: 'test-results/library.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/library-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('API guards: origins, limits, missing identifiers and unauthenticated access', async ({
  request,
}) => {
  expect((await request.get('/api/diagrams')).status()).toBe(401);
  await register(request);
  expect(
    (
      await request.post('/api/diagrams', {
        data: { name: 'Запрещено' },
        headers: { Origin: 'https://attacker.invalid' },
      })
    ).status(),
  ).toBe(403);
  expect(
    (await request.post('/api/diagrams', { data: { name: 'x'.repeat(2_000_001) } })).status(),
  ).toBe(413);
  expect((await request.put('/api/diagrams', { data: {} })).status()).toBe(405);
  expect((await request.delete('/api/notations')).status()).toBe(405);
  expect(
    (
      await request.post('/api/diagrams', {
        data: { name: 'Неизвестная нотация', notationId: 'missing' },
      })
    ).status(),
  ).toBe(404);
});
