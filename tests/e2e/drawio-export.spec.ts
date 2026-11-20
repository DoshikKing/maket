import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { drawioFixture } from '../fixtures/drawio';
test('exports editable draw.io XML with unique aliases, typed model data, geometry and attachments', async ({
  page,
}) => {
  const fixture = drawioFixture();
  const token = 'd'.repeat(43);
  await page.route(`**/api/public/${token}`, (route) =>
    route.fulfill({ json: { name: fixture.name, revision: 1, document: fixture.document } }),
  );
  await page.goto(`/view/${token}`);
  await expect(page.locator('.viewer-canvas > svg')).toBeVisible();
  await page.getByRole('button', { name: 'Экспорт', exact: true }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'draw.io', exact: true }).click();
  const file = await pending;
  expect(file.suggestedFilename()).toMatch(/\.drawio$/);
  expect(await file.failure()).toBeNull();
  const text = await readFile((await file.path())!, 'utf8');
  const parsed = await page.evaluate((text) => {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    const data = (id: string) => {
      const obj = [...doc.querySelectorAll('object')].find((o) => o.id === id)!;
      const cell = obj.querySelector('mxCell')!;
      const geometry = cell.querySelector('mxGeometry')!;
      return {
        attributes: Object.fromEntries([...obj.attributes].map((a) => [a.name, a.value])),
        cell: Object.fromEntries([...cell.attributes].map((a) => [a.name, a.value])),
        geometry: Object.fromEntries([...geometry.attributes].map((a) => [a.name, a.value])),
        targetPoint: geometry.querySelector('[as="targetPoint"]')?.getAttribute('x'),
      };
    };
    return {
      error: doc.querySelector('parsererror')?.textContent,
      name: doc.querySelector('diagram')?.getAttribute('name'),
      first: data('node_first'),
      alias: data('node_alias'),
      child: data('node_child'),
      edge: data('edge_between_aliases'),
      free: data('edge_free'),
      edgeLink: data('edge_from_edge'),
      ids: [...doc.querySelectorAll('[id]')].map((el) => el.id),
    };
  }, text);
  expect(parsed.error).toBeUndefined();
  expect(parsed.name).toBe(fixture.name);
  expect(new Set(parsed.ids).size).toBe(parsed.ids.length);
  expect(parsed.first.attributes.maket_object_id).toBe('original');
  expect(parsed.alias.attributes.maket_object_id).toBe('original');
  expect(parsed.first.attributes.maket_representation_id).toBe('first');
  expect(parsed.alias.attributes.maket_representation_id).toBe('alias');
  expect(JSON.parse(parsed.first.attributes.maket_attributes)).toMatchObject({
    enabled: false,
    count: 0,
    local: 'first',
  });
  expect(JSON.parse(parsed.first.attributes.maket_object).description).toBe(
    fixture.objects[0].description,
  );
  expect(parsed.alias.attributes.label).toBe(fixture.document.nodes[1].label);
  expect(parsed.first.geometry).toMatchObject({ x: '-50', y: '-30', width: '240', height: '100' });
  expect(parsed.edge.cell).toMatchObject({ source: 'node_first', target: 'node_alias' });
  expect(JSON.parse(parsed.edge.attributes.maket_relation)).toMatchObject({
    id: 'loop',
    sourceId: 'original',
    targetId: 'original',
    attributes: { approved: true },
  });
  expect(parsed.edgeLink.cell.source).toBe('edge_between_aliases');
  expect(parsed.free.cell.target).toBeUndefined();
  expect(parsed.free.targetPoint).toBe('980');
  expect(parsed.child.attributes.label).toContain('«instance»');
  await file.saveAs(test.info().outputPath('diagram.drawio'));
});
