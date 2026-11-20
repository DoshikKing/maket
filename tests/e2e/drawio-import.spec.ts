import 'dotenv/config';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { databaseConfig } from '../../scripts/database-config.mjs';
import { drawioXml } from '../../src/lib/drawio-export';
import { projectDocument, modelDiagramSchema } from '../../src/lib/model';
import { drawioFixture } from '../fixtures/drawio';
const { connectionString, schema } = databaseConfig();
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }, { schema }) });
const emails: string[] = [];
async function login(request: APIRequestContext) {
  const email = `drawio-import-${randomUUID()}@example.com`,
    password = 'Drawio-import-password-42',
    salt = randomBytes(16).toString('hex');
  emails.push(email);
  const user = await db.user.create({
    data: {
      email,
      name: 'Importer',
      emailVerified: true,
      settings: { theme: 'light', snapToGrid: true, autosave: false },
      passwordHash: `${salt}:${scryptSync(password, salt, 64).toString('hex')}`,
    },
  });
  expect((await request.post('/api/auth/login', { data: { email, password } })).status()).toBe(200);
  return user;
}
test.afterAll(async () => {
  await db.user.deleteMany({ where: { email: { in: emails } } });
  await db.rateLimit.deleteMany({ where: { key: { in: emails.map((e) => `login:${e}`) } } });
  await db.$disconnect();
});
const native =
  '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="group" parent="1" vertex="1" style="group;"><mxGeometry x="100" y="50" width="600" height="300" as="geometry"/></mxCell><object id="a" label="&lt;b&gt;Название&lt;/b&gt;&lt;br&gt;Строка" department="Отдел"><mxCell parent="group" vertex="1" style="rounded=1;html=1;fillColor=#fff;"><mxGeometry x="20" y="30" width="100" height="70" as="geometry"/></mxCell></object><mxCell id="b" parent="group" vertex="1" value="Второй" style="ellipse;"><mxGeometry x="300" y="100" width="120" height="60" as="geometry"/></mxCell><mxCell id="e" parent="group" edge="1" source="a" target="b" value="Связь" style="edgeStyle=orthogonalEdgeStyle;endArrow=block;"><mxGeometry relative="1" as="geometry"/></mxCell></root></mxGraphModel>';

test('imports plain and compressed draw.io pages into one root folder with atomic object creation', async ({
  page,
  request,
}) => {
  await login(request);
  await page.context().addCookies((await request.storageState()).cookies);
  await page.goto('/library');
  const zipped = deflateRawSync(encodeURIComponent(native)).toString('base64');
  const xml = `<mxfile><diagram name="Первая">${native}</diagram><diagram name="Вторая">${zipped}</diagram></mxfile>`;
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/api/diagram-imports') && r.request().method() === 'POST',
  );
  await page.locator('input[type=file]').setInputFiles({
    name: 'Native import.drawio',
    mimeType: 'application/xml',
    buffer: Buffer.from(xml),
  });
  const imported = await response;
  expect(imported.status(), await imported.text()).toBe(201);
  const result = await imported.json();
  expect(result.diagrams).toHaveLength(2);
  await expect(page).toHaveURL(new RegExp(`/solutions\\?parent=${result.folder.id}$`));
  expect(result.folder).toMatchObject({ name: 'Native import', parentId: null, kind: 'folder' });
  const children = await db.modelObject.findMany({ where: { parentId: result.folder.id } });
  expect(children.filter((o) => o.kind === 'diagram')).toHaveLength(2);
  expect(children.filter((o) => o.kind === 'object')).toHaveLength(6);
  for (const d of result.diagrams) {
    const row = await db.diagram.findUniqueOrThrow({ where: { id: d.id } });
    const doc = modelDiagramSchema.parse(row.document);
    expect(doc.nodes).toHaveLength(3);
    expect(doc.edges).toHaveLength(1);
    expect(doc.nodes.find((n) => n.label === 'Название\nСтрока')?.position).toEqual({
      x: 120,
      y: 80,
    });
    expect(doc.objects.find((o) => o.attributes.department === 'Отдел')).toBeDefined();
    expect(
      doc.objects.filter((o) => o.kind === 'object').every((o) => o.parentId === result.folder.id),
    ).toBe(true);
    const r = await request.get(`/api/diagrams/${d.id}`);
    expect(r.status()).toBe(200);
  }
  const first = await (await request.get(`/api/diagrams/${result.diagrams[0].id}`)).json();
  const node = first.document.nodes.find((n: { position: { x: number } }) => n.position.x === 120);
  await page.goto(`/diagrams/${result.diagrams[0].id}`);
  for (const figure of first.document.nodes)
    await expect(page.locator(`.react-flow__node[data-id="${figure.id}"]`)).toBeVisible();
  await page.locator(`.react-flow__node[data-id="${node.id}"] .node-label`).dblclick();
  await page.getByLabel('Текст объекта', { exact: true }).fill('Правка после импорта');
  await page.getByLabel('Текст объекта', { exact: true }).press('Enter');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect
    .poll(async () => {
      const data = await (await request.get(`/api/diagrams/${result.diagrams[0].id}`)).json();
      return data.document.nodes.find((n: { id: string }) => n.id === node.id)?.label;
    })
    .toBe('Правка после импорта');
});

test('imports exported metadata, custom shapes, alias identity, inheritance and typed values', async ({
  page,
  request,
}) => {
  await login(request);
  await page.context().addCookies((await request.storageState()).cookies);
  const f = drawioFixture();
  const exported = await drawioXml(f.name, projectDocument(f.document), f.objects);
  const duplicate = exported.match(/<diagram[\s\S]*<\/diagram>/)![0];
  const xml = exported.replace('</mxfile>', `${duplicate}</mxfile>`);
  await page.goto('/library');
  const pending = Promise.race([
    page.waitForResponse((r) => r.url().endsWith('/api/diagram-imports')),
    page
      .locator('.page > .error[role=alert]')
      .waitFor()
      .then(async () => {
        throw new Error(await page.locator('.page > .error[role=alert]').innerText());
      }),
  ]);
  await page.locator('input[type=file]').setInputFiles({
    name: 'Roundtrip.drawio',
    mimeType: 'application/xml',
    buffer: Buffer.from(xml),
  });
  const response = await pending;
  expect(response.status(), await response.text()).toBe(201);
  const result = await response.json();
  const loaded = await (await request.get(`/api/diagrams/${result.diagrams[0].id}`)).json();
  const doc = modelDiagramSchema.parse(loaded.document);
  expect(result.diagrams).toHaveLength(2);
  const second = await (await request.get(`/api/diagrams/${result.diagrams[1].id}`)).json();
  expect(second.document.nodes.map((n: { objectId: string }) => n.objectId)).toEqual(
    doc.nodes.map((n) => n.objectId),
  );
  expect(doc.nodes).toHaveLength(3);
  expect(doc.edges).toHaveLength(4);
  expect(new Set(doc.nodes.map((n) => n.objectId)).size).toBe(2);
  const original = doc.objects.find((o) => o.copiedFrom?.id === 'original')!;
  expect(original.attributes).toMatchObject({ count: 0, enabled: false });
  expect(doc.nodes.filter((n) => n.objectId === original.id)).toHaveLength(2);
  expect(doc.bindings[0].document.shapes).toHaveLength(1);
  expect(doc.bindings[0].document.shapes![0].rounding).toBeCloseTo(10);
  expect(doc.nodes.some((n) => n.appearance?.textRotation === 35)).toBe(true);
  expect(doc.edges.some((e) => e.detachedTarget?.x === 980)).toBe(true);
  expect(doc.relations?.some((r) => r.relationType === 'экземпляр')).toBe(true);
  expect(original.parentId).toBe(result.folder.id);
});

test('rejects invalid XML, DTD and oversized decompression before upload; rolls back later-page failures and checks roles', async ({
  page,
  request,
  playwright,
}) => {
  const owner = await login(request);
  await page.context().addCookies((await request.storageState()).cookies);
  await page.goto('/library');
  let writes = 0;
  page.on('request', (r) => {
    if (r.url().endsWith('/api/diagram-imports') && r.method() === 'POST') writes++;
  });
  for (const payload of [
    '<broken>',
    '<!DOCTYPE mxfile [<!ENTITY x "bad">]><mxfile/>',
    `<mxfile><diagram>${deflateRawSync('x'.repeat(2_000_001)).toString('base64')}</diagram></mxfile>`,
  ]) {
    await page.locator('input[type=file]').setInputFiles({
      name: 'Invalid.drawio',
      mimeType: 'application/xml',
      buffer: Buffer.from(payload),
    });
    await expect(page.locator('.page > .error[role=alert]')).toBeVisible();
  }
  expect(writes).toBe(0);
  const f = drawioFixture();
  const bad = structuredClone(f.document);
  bad.nodes[0].objectId = 'missing';
  const before = await db.modelObject.count({ where: { name: 'Rollback' } });
  const failed = await request.post('/api/diagram-imports', {
    data: {
      folderName: 'Rollback',
      pages: [
        { name: 'Good', document: f.document },
        { name: 'Bad', document: bad },
      ],
    },
  });
  expect(failed.status()).toBe(400);
  expect(await db.modelObject.count({ where: { name: 'Rollback' } })).toBe(before);
  const area = (await (await request.get('/api/workspaces')).json())[0];
  const viewer = await playwright.request.newContext({
    baseURL: 'http://localhost:3000',
    extraHTTPHeaders: { 'X-Maket-Workspace': area.id },
  });
  try {
    const user = await login(viewer);
    expect(
      (
        await request.post('/api/collaboration/members', {
          data: { email: user.email, role: 'viewer' },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await viewer.post('/api/diagram-imports', {
          data: { folderName: 'Forbidden', pages: [{ name: 'D', document: f.document }] },
        })
      ).status(),
    ).toBe(403);
    expect(
      await db.modelObject.count({ where: { name: 'Forbidden', space: { ownerId: owner.id } } }),
    ).toBe(0);
  } finally {
    await viewer.dispose();
  }
});

test('HTML labels remain inert and external images never load', async ({ page, request }) => {
  await login(request);
  await page.context().addCookies((await request.storageState()).cookies);
  await page.goto('/library');
  let external = 0;
  await page.route('https://example.invalid/**', (route) => {
    external++;
    return route.abort();
  });
  const markup =
    '<img src="https://example.invalid/track" onerror="window.importAttack=1"><script>window.importAttack=2</script>Безопасный <b>текст</b>';
  const escaped = markup
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
  const extra = Array.from({ length: 99 }, (_, i) => `custom_${i}="value_${i}"`).join(' ');
  const xml = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><object id="text" label="${escaped}" attribute_custom="Дополнение" ${extra}><mxCell vertex="1" parent="1" style="html=1;"><mxGeometry width="200" height="80" as="geometry"/></mxCell></object></root></mxGraphModel>`;
  const pending = page.waitForResponse((r) => r.url().endsWith('/api/diagram-imports'));
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'HTML.xml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
  const response = await pending;
  expect(response.status(), await response.text()).toBe(201);
  const result = await response.json();
  const data = await (await request.get(`/api/diagrams/${result.diagrams[0].id}`)).json();
  expect(data.document.nodes[0].label).toBe('Безопасный текст');
  expect(
    data.document.objects.some(
      (o: { attributes: Record<string, unknown> }) =>
        o.attributes.attribute_custom === 'Дополнение',
    ),
  ).toBe(true);
  expect(
    await page.evaluate(() => (window as unknown as { importAttack?: number }).importAttack),
  ).toBeUndefined();
  expect(external).toBe(0);
});
