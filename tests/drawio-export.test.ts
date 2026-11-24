import { expect, it } from 'vitest';
import { inflateRawSync } from 'node:zlib';
import { drawioXml } from '../src/lib/drawio-export';
import { projectDocument } from '../src/lib/model';
import { drawioFixture } from './fixtures/drawio';
import { builtinNotation } from '../src/lib/notation';
it('preserves aliases, editable shapes, model identities, typed properties, XML safety and custom stencil contours', async () => {
  const fixture = drawioFixture();
  const xml = await drawioXml(fixture.name, projectDocument(fixture.document), fixture.objects);
  expect(xml).toContain('<mxfile');
  expect(xml.match(/maket_object_id="original"/g)).toHaveLength(2);
  expect(xml).toContain('maket_representation_id="first"');
  expect(xml).toContain('maket_representation_id="alias"');
  expect(xml).toContain('x="-50" y="-30" width="240" height="100"');
  expect(xml).toContain('maket_relation_id="loop"');
  expect(xml).toContain('source="node_first" target="node_alias"');
  expect(xml).toContain('source="edge_between_aliases" target="node_child"');
  expect(xml).toContain('attribute_enabled="false"');
  expect(xml).toContain('attribute_count="0"');
  expect(xml).toContain('attribute_approved="true"');
  expect(xml).not.toContain('НЕ ЭКСПОРТИРОВАТЬ');
  expect(xml).not.toContain('<img');
  expect(xml).toContain('&lt;img');
  expect(xml).toContain('😀');
  expect(xml).toContain('endArrow=block;endFill=0;');
  expect(xml).toContain('startArrow=oval;startFill=1;');
  expect(xml).toContain('rotation=35;');
  expect(xml).toContain('«instance»');
  const custom = xml.match(/shape=stencil\(([^)]+)\)/)![1];
  const stencil = decodeURIComponent(inflateRawSync(Buffer.from(custom, 'base64')).toString());
  expect(stencil).toContain('<quad');
  expect(stencil).toContain('<fillstroke/>');
  expect(stencil).toContain('<shape name="maket"');
});
it('exports an empty diagram as a valid editable graph and excludes XML control characters', async () => {
  const fixture = drawioFixture();
  const d = projectDocument(fixture.document);
  d.nodes = [];
  d.edges = [];
  const xml = await drawioXml('empty\u0000\uD800', d, []);
  expect(xml).toContain('name="empty"');
  expect(xml).toContain('<mxCell id="0"/><mxCell id="1" parent="0"/>');
  expect(xml).not.toContain('<object');
});
it('keeps representation types from different notations independent', async () => {
  const fixture = drawioFixture();
  fixture.document.bindings.push({
    id: 'second',
    versionId: null,
    document: structuredClone(builtinNotation),
  });
  fixture.document.nodes.push({
    ...fixture.document.nodes[0],
    id: 'other_notation',
    bindingId: 'second',
    attributes: {},
    appearance: undefined,
  });
  const xml = await drawioXml(fixture.name, projectDocument(fixture.document), fixture.objects);
  expect(xml).toContain('maket_type="binding:process"');
  expect(xml).toContain('maket_type="second:process"');
  expect(xml).toContain('id="node_other_notation"');
  expect(xml.match(/maket_object_id="original"/g)).toHaveLength(3);
});
it('keeps object endpoint identities for newly drawn unsaved relations without inventing model IDs', async () => {
  const fixture = drawioFixture();
  delete fixture.document.edges[0].relationId;
  const xml = await drawioXml(fixture.name, projectDocument(fixture.document), fixture.objects);
  const edge = xml.match(/<object id="edge_between_aliases"[\s\S]*?<\/object>/)![0];
  expect(edge).toContain('maket_source_id="original"');
  expect(edge).toContain('maket_target_id="original"');
  expect(edge).not.toContain('maket_relation_id=');
});

it('preserves common edge/shape stacking order in SVG and draw.io exports', async () => {
  const { createElement } = await import('react');
  const { layeredElements } = await import('../src/components/layered-elements');
  const fixture = drawioFixture();
  const d = projectDocument(fixture.document);
  d.edges[0].layer = 100;
  d.nodes[0].layer = -10;
  const ordered = layeredElements(d, [
    ...d.edges.map((e) => createElement('g', { key: e.id })),
    ...d.nodes.map((n) => createElement('g', { key: n.id })),
  ]);
  expect(ordered[0].key).toBe(d.nodes[0].id);
  expect(ordered.at(-1)?.key).toBe(d.edges[0].id);
  const xml = await drawioXml(fixture.name, d, fixture.objects);
  expect(xml.indexOf(`id="node_${d.nodes[0].id}"`)).toBeLessThan(
    xml.indexOf(`id="edge_${d.edges[0].id}"`),
  );
  expect(xml.lastIndexOf('<object ')).toBe(
    xml.indexOf(`id="edge_${d.edges[0].id}"`) - '<object '.length,
  );
});
