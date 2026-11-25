import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { importDrawio } from '../src/lib/drawio-import';
import { projectDocument, modelDiagramSchema } from '../src/lib/model';
import { edgeGeometry } from '../src/lib/diagram-geometry';
import { drawioXml } from '../src/lib/drawio-export';

const vertex = (id: string, parent: string, geometry: string, style = '') =>
  `<mxCell id="${id}" vertex="1" parent="${parent}" value="${id}" style="${style}"><mxGeometry ${geometry} as="geometry"/></mxCell>`;
const line = (id: string, parent: string, geometry: string, ends = '', style = '') =>
  `<mxCell id="${id}" edge="1" parent="${parent}" value="${id}" ${ends} style="${style}">${geometry}</mxCell>`;
async function parse(cells: string) {
  const realm = new JSDOM('');
  try {
    const xml = cells.includes('<mxfile')
      ? cells
      : `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel>`;
    return await importDrawio(new File([xml], 'Coordinates.drawio'), {
      document: realm.window.document,
      parseXml: (xml) => new realm.window.DOMParser().parseFromString(xml, 'application/xml'),
      serialize: (element) => new realm.window.XMLSerializer().serializeToString(element),
    });
  } finally {
    realm.window.close();
  }
}
const free =
  '<mxGeometry relative="1" as="geometry"><mxPoint x="20" y="30" as="sourcePoint"/><Array as="points"><mxPoint x="20" y="170"/><mxPoint x="260" y="170"/></Array><mxPoint x="260" y="220" as="targetPoint"/></mxGeometry>';

it('translates free endpoints and every waypoint from nested parent coordinates exactly once', async () => {
  const result = await parse(
    vertex('outer', '1', 'x="-200" y="100" width="800" height="600"') +
      vertex('inner', 'outer', 'x="70" y="40" width="400" height="300"') +
      line('free', 'inner', free),
  );
  const d = result.pages[0].document,
    edge = d.edges[0];
  expect(edge.detachedSource).toEqual({ x: -110, y: 170 });
  expect(edge.detachedTarget).toEqual({ x: 130, y: 360 });
  expect(edge.waypoints).toEqual([
    { x: -110, y: 310 },
    { x: 130, y: 310 },
  ]);
  const geometry = edgeGeometry(projectDocument(d)).get(edge.id)!;
  expect(geometry.path).toBe('M -110 170 L -110 310 L 130 310 L 130 360');
  expect(result.warnings.some((message) => message.includes('пересчитаны'))).toBe(false);
  expect(modelDiagramSchema.parse(JSON.parse(JSON.stringify(d))).edges[0].waypoints).toEqual(
    edge.waypoints,
  );
});
it('scales group origins, free ends and waypoints together on oversized pages', async () => {
  const result = await parse(
    vertex('large', '1', 'x="200" y="100" width="4000" height="2000"') + line('e', 'large', free),
  );
  expect(result.pages[0].document.edges[0].detachedSource).toEqual({ x: 110, y: 65 });
  expect(result.pages[0].document.edges[0].waypoints?.[0]).toEqual({ x: 110, y: 135 });
});
it('applies offsets to relative vertices, not to the origin of absolute vertices', async () => {
  const result = await parse(
    vertex('group', '1', 'x="100" y="50" width="400" height="200"') +
      '<mxCell id="absolute" vertex="1" parent="group"><mxGeometry x="20" y="30" width="100" height="60" as="geometry"><mxPoint x="300" y="400" as="offset"/></mxGeometry></mxCell>' +
      '<mxCell id="relative" vertex="1" parent="group"><mxGeometry x="0.5" y="1" relative="1" width="40" height="30" as="geometry"><mxPoint x="-20" y="-15" as="offset"/></mxGeometry></mxCell>',
  );
  const d = result.pages[0].document;
  expect(d.nodes.find((n) => n.objectId === 'absolute')?.position).toEqual({ x: 120, y: 80 });
  expect(d.nodes.find((n) => n.objectId === 'relative')?.position).toEqual({ x: 280, y: 235 });
});
it('preserves explicit terminal anchors and follows the object after moving and resizing', async () => {
  const result = await parse(
    vertex('a', '1', 'x="100" y="80" width="200" height="100"') +
      vertex('b', '1', 'x="500" y="400" width="100" height="60"') +
      line(
        'e',
        '1',
        '<mxGeometry relative="1" as="geometry"/>',
        'source="a" target="b"',
        'exitX=0.5;exitY=1;exitPerimeter=0;entryX=0.5;entryY=0;entryPerimeter=0;',
      ),
  );
  const d = projectDocument(result.pages[0].document),
    e = d.edges[0];
  expect(edgeGeometry(d).get(e.id)?.source).toEqual({ x: 200, y: 180 });
  expect(edgeGeometry(d).get(e.id)?.target).toEqual({ x: 550, y: 400 });
  d.nodes[0].position.x += 30;
  d.nodes[0].size!.width = 300;
  expect(edgeGeometry(d).get(e.id)?.source).toEqual({ x: 280, y: 180 });
  expect(e.detachedSource).toBeUndefined();
});
it('retains free-edge label position, offsets and bends when exporting and importing again', async () => {
  const xml = free
    .replace('relative="1"', 'relative="1" x="0" y="20"')
    .replace('</mxGeometry>', '<mxPoint x="7" y="9" as="offset"/></mxGeometry>');
  const first = await parse(line('e', '1', xml));
  const d = projectDocument(first.pages[0].document),
    edge = d.edges[0];
  expect(edgeGeometry(d).get(edge.id)?.label).toEqual({ x: 102, y: 159 });
  const exported = await drawioXml('Roundtrip', d, first.pages[0].document.objects);
  const second = await parse(exported);
  expect(second.pages[0].document.edges[0].waypoints).toEqual(edge.waypoints);
  expect(second.pages[0].document.edges[0].labelPosition).toEqual(edge.labelPosition);
});
it('rejects invalid geometry and excessive routing points without relaxing import limits', async () => {
  const bad = free.replace('<mxPoint x="20" y="170"/>', '<mxPoint x="1" y="2"/>'.repeat(257));
  await expect(parse(line('e', '1', bad))).rejects.toThrow('256');
  await expect(
    parse(
      vertex('a', 'b', 'width="100" height="80"') + vertex('b', 'a', 'width="100" height="80"'),
    ),
  ).rejects.toThrow('Цикл');
});

it('rotates relative child origins around the parent center while preserving absolute children', async () => {
  const d = (
    await parse(
      vertex('g', '1', 'x="100" y="50" width="400" height="200"', 'rotation=90;') +
        '<mxCell id="r" vertex="1" parent="g"><mxGeometry x="1" y="0.5" relative="1" width="40" height="30" as="geometry"><mxPoint x="-20" y="-15" as="offset"/></mxGeometry></mxCell>',
    )
  ).pages[0].document;
  const p = d.nodes.find((n) => n.objectId === 'r')!.position;
  expect(p.x).toBeCloseTo(280);
  expect(p.y).toBeCloseTo(335);
});
it('keeps route curves and the original cell stacking order', async () => {
  const d = (
    await parse(
      vertex('g', '1', 'width="600" height="400"') + line('curve', 'g', free, '', 'curved=1;'),
    )
  ).pages[0].document;
  const e = d.edges[0];
  expect(e.layer).toBeGreaterThan(d.nodes[0].layer!);
  expect(edgeGeometry(projectDocument(d)).get(e.id)!.path).toContain(' Q ');
  const again = (await parse(await drawioXml('Curve', projectDocument(d), d.objects))).pages[0]
    .document;
  expect(again.edges[0].appearance?.routing).toBe('bezier');
  expect(again.edges[0].waypoints).toEqual(e.waypoints);
});

it('connects an arrow to the actual midpoint of another imported arrow, even in reverse XML order', async () => {
  const d = (
    await parse(
      line(
        'child',
        '1',
        '<mxGeometry relative="1" as="geometry"><mxPoint x="420" y="200" as="targetPoint"/></mxGeometry>',
        'source="parent"',
      ) + line('parent', '1', free),
    )
  ).pages[0].document;
  const view = projectDocument(d),
    parent = d.edges.find(
      (e) => d.relations?.find((r) => r.id === e.relationId)?.attributes.drawio_id === 'parent',
    )!,
    child = d.edges.find((e) => e.id !== parent.id)!;
  const geometry = edgeGeometry(view);
  expect(geometry.get(child.id)?.source).toEqual(geometry.get(parent.id)?.center);
  expect(geometry.get(child.id)?.source).toEqual({ x: 95, y: 170 });
});

it('keeps inner vertical alignment separate from external label position, padding and absolute label offsets', async () => {
  const xml =
    vertex(
      'top',
      '1',
      'x="100" y="100" width="160" height="100"',
      'verticalAlign=top;align=left;spacing=4;spacingTop=6;fontStyle=1;fontFamily=Courier New;',
    ) +
    vertex(
      'bottom',
      '1',
      'x="300" y="100" width="160" height="100"',
      'verticalAlign=bottom;fontStyle=0;',
    ) +
    '<mxCell id="outside" vertex="1" parent="1" value="Caption" style="verticalLabelPosition=bottom;verticalAlign=top;labelPosition=right;align=left;spacing=0;fontStyle=6;"><mxGeometry x="500" y="100" width="120" height="80" as="geometry"><mxPoint x="15" y="-3" as="offset"/></mxGeometry></mxCell>';
  const first = (await parse(xml)).pages[0].document;
  expect(first.nodes[0].appearance).toMatchObject({
    textVerticalAlign: 'top',
    textAlign: 'left',
    textPadding: { top: 10, right: 4, bottom: 4, left: 4 },
    fontWeight: 700,
    fontFamily: 'Courier New',
  });
  expect(first.nodes[1].appearance).toMatchObject({ textVerticalAlign: 'bottom', fontWeight: 400 });
  const external = first.nodes[2];
  expect(external.position).toEqual({ x: 500, y: 100 });
  expect(external.appearance).toMatchObject({
    textPosition: { horizontal: 'right', vertical: 'bottom' },
    textOffset: { x: 15, y: -3 },
    fontStyle: 'italic',
    underline: true,
  });
  const again = (await parse(await drawioXml('Text', projectDocument(first), first.objects)))
    .pages[0].document;
  for (let i = 0; i < first.nodes.length; i++)
    expect(again.nodes[i].appearance).toMatchObject(first.nodes[i].appearance!);
});
it('reads uniform HTML font styles without applying markup or remote resources to the document', async () => {
  const d = (
    await parse(
      '<mxCell id="html" vertex="1" parent="1" style="html=1;verticalAlign=top;" value="&lt;div style=&quot;font-weight:300;font-style:italic;text-align:right;font-family:Georgia;font-size:16px&quot;&gt;Thin caption&lt;/div&gt;"><mxGeometry width="200" height="80" as="geometry"/></mxCell>',
    )
  ).pages[0].document;
  expect(d.nodes[0].label).toBe('Thin caption');
  expect(d.nodes[0].appearance).toMatchObject({
    fontWeight: 300,
    fontStyle: 'italic',
    fontFamily: 'Georgia',
    fontSize: 16,
    textAlign: 'right',
    textVerticalAlign: 'top',
  });
  const roundtrip = (await parse(await drawioXml('Thin', projectDocument(d), d.objects))).pages[0]
    .document;
  expect(roundtrip.nodes[0].appearance).toMatchObject(d.nodes[0].appearance!);
  const mixed = await parse(
    '<mxCell id="mixed" vertex="1" parent="1" style="html=1;" value="&lt;b&gt;Bold&lt;/b&gt; plain"><mxGeometry width="200" height="80" as="geometry"/></mxCell>',
  );
  expect(mixed.pages[0].document.nodes[0].label).toBe('Bold plain');
  expect(mixed.warnings.some((w) => w.includes('Смешанное'))).toBe(true);
});
