import 'dotenv/config';
import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomBytes, scryptSync } from 'node:crypto';
import { databaseConfig } from '../../scripts/database-config.mjs';
const { connectionString, schema } = databaseConfig();
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }, { schema }) });
const emails: string[] = [];
test.afterAll(async () => {
  await db.user.deleteMany({ where: { email: { in: emails } } });
  await db.$disconnect();
});
const cell = (id: string, x: number, y: number, style: string, offset = '') =>
  `<mxCell id="${id}" value="${id}" vertex="1" parent="1" style="${style}"><mxGeometry x="${x}" y="${y}" width="180" height="110" as="geometry">${offset}</mxGeometry></mxCell>`;
test('draw.io text alignment and font styling survive editing, reload, public viewing and exports', async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  const email = `drawio-text-${crypto.randomUUID()}@example.com`,
    password = 'Drawio-text-test-42',
    salt = randomBytes(16).toString('hex');
  emails.push(email);
  await db.user.create({
    data: {
      email,
      name: 'Текст draw.io',
      emailVerified: true,
      passwordHash: `${salt}:${scryptSync(password, salt, 64).toString('hex')}`,
    },
  });
  expect((await request.post('/api/auth/login', { data: { email, password } })).status()).toBe(200);
  await page.context().addCookies((await request.storageState()).cookies);
  const xml =
    '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
    [
      cell(
        'Top',
        0,
        0,
        'verticalAlign=top;align=left;spacing=0;spacingTop=10;fontStyle=1;fontFamily=monospace;',
      ),
      cell('Middle', 0, 200, 'verticalAlign=middle;fontStyle=0;spacing=0;'),
      cell('Bottom', 0, 400, 'verticalAlign=bottom;spacing=0;spacingBottom=7;fontStyle=3;'),
      cell('Above', 300, 200, 'verticalLabelPosition=top;verticalAlign=bottom;spacing=0;'),
      cell('Below', 300, 400, 'verticalLabelPosition=bottom;verticalAlign=top;spacing=0;'),
      cell('Offset', 600, 200, 'spacing=0;', '<mxPoint as="offset" x="20" y="30"/>'),
    ].join('') +
    '</root></mxGraphModel>';
  await page.goto('/solutions?view=diagrams');
  const imported = page.waitForResponse(
    (r) => r.url().endsWith('/api/diagram-imports') && r.request().method() === 'POST',
  );
  await page
    .locator('.diagram-browser input[type=file]')
    .setInputFiles({ name: 'Text.drawio', mimeType: 'application/xml', buffer: Buffer.from(xml) });
  const result = await (await imported).json();
  const id = result.diagrams[0].id,
    doc = await (await request.get(`/api/diagrams/${id}`)).json();
  const ids = Object.fromEntries(
    doc.document.nodes.map((n: { id: string; label: string }) => [n.label, n.id]),
  );
  await page.goto(`/solutions?diagram=${id}`);
  await expect(page.locator('.react-flow__node-notation')).toHaveCount(6);
  const node = (name: string) => page.locator(`.react-flow__node[data-id="${ids[name]}"]`);
  async function placement(name: string) {
    return node(name).evaluate((el) => {
      const n = el.getBoundingClientRect(),
        t = el.querySelector('.node-label')!.getBoundingClientRect(),
        scale = n.width / 180;
      return {
        top: (t.top - n.top) / scale,
        bottom: (n.bottom - t.bottom) / scale,
        center: (t.top + t.height / 2 - n.top) / scale,
        weight: getComputedStyle(el.querySelector('.node-label')!).fontWeight,
      };
    });
  }
  await expect.poll(async () => (await placement('Top')).top).toBeCloseTo(10, 0);
  await expect(node('Top').locator('.node-label')).toHaveCSS('text-align', 'left');
  await expect(node('Top').locator('.node-label')).toHaveCSS('font-weight', '700');
  await expect(node('Top').locator('.node-label')).toHaveCSS('font-family', /monospace/);
  expect((await placement('Middle')).center).toBeCloseTo(55, 0);
  expect((await placement('Middle')).weight).toBe('400');
  expect((await placement('Bottom')).bottom).toBeCloseTo(7, 0);
  await expect(node('Bottom').locator('.node-label')).toHaveCSS('font-style', 'italic');
  expect((await placement('Above')).bottom).toBeGreaterThanOrEqual(110 - 1);
  expect((await placement('Below')).top).toBeGreaterThanOrEqual(110 - 1);
  expect((await placement('Offset')).center).toBeCloseTo(85, 0);
  await node('Top').locator('.node-label').dblclick();
  await page.getByRole('textbox', { name: 'Текст объекта', exact: true }).fill('Edited top');
  await page.keyboard.press('Enter');
  await expect(page.locator('.editor-save-state')).toContainText('Сохранено');
  await page.reload();
  await expect(node('Top').locator('.node-label')).toHaveText('Edited top');
  expect((await placement('Top')).top).toBeCloseTo(10, 0);
  await expect(node('Top').locator('.node-label')).toHaveCSS('font-weight', '700');
  const saved = await (await request.get(`/api/diagrams/${id}`)).json();
  expect(
    saved.document.nodes.find((n: { id: string }) => n.id === ids.Top).appearance.textVerticalAlign,
  ).toBe('top');
  await page.getByRole('button', { name: 'Экспорт', exact: true }).click();
  const svg = page.locator('.export-preview svg');
  const text = svg.locator(`[data-representation-id="${ids.Top}"] [data-node-label] text`);
  await expect(text).toHaveAttribute('font-weight', '700');
  await expect(text).toHaveAttribute('text-anchor', 'start');
  for (const format of ['PNG', 'JPEG', 'PDF']) {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: format, exact: true }).click();
    expect((await download).suggestedFilename().toLowerCase()).toMatch(/\.(png|jpeg|pdf)$/);
  }
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  const share = await request.post(`/api/diagrams/${id}/share`, { data: { enabled: true } });
  expect(share.status()).toBe(200);
  const sharing = await share.json();
  await page.goto(sharing.path);
  const publicLabel = page.locator(`[data-representation-id="${ids.Top}"] [data-node-label] text`);
  await expect(publicLabel).toHaveAttribute('font-weight', '700');
  await expect(publicLabel).toContainText('Edited top');
  await expect(
    page.locator(`[data-representation-id="${ids.Below}"] [data-node-label]`),
  ).toHaveAttribute('transform', /translate\(90,118\.4/);
});
