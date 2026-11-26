import { expect, it } from 'vitest';
import { faceAttachment, edgeGeometry } from '../src/lib/diagram-geometry';
import { builtinNotation, type DiagramDocument } from '../src/lib/notation';
const doc: DiagramDocument = {
  schemaVersion: 1,
  notation: builtinNotation,
  nodes: [{ id: 'n', typeId: 'process', position: { x: 100, y: 200 }, properties: {} }],
  edges: [],
};
it('uses relative face attachments, clamps them and keeps semantic port validation', () => {
  expect(faceAttachment(doc, 'n', 'out', { x: 0, y: 220 })).toEqual({
    anchor: { x: 1, y: 0.25 },
    point: { x: 280, y: 220 },
  });
  expect(faceAttachment(doc, 'n', 'in', { x: 999, y: 500 })?.anchor).toEqual({ x: 0, y: 1 });
  expect(faceAttachment(doc, 'n', 'out', { x: 0, y: -50 })?.anchor.y).toBe(0);
  expect(faceAttachment(doc, 'n', 'missing', { x: 0, y: 0 })).toBeUndefined();
  expect(faceAttachment(doc, 'n', 'out')).toBeUndefined();
  const d = structuredClone(doc);
  d.nodes.push({ id: 'b', typeId: 'process', position: { x: 500, y: 200 }, properties: {} });
  d.edges = [
    {
      id: 'e',
      source: 'n',
      target: 'b',
      sourcePort: 'out',
      targetPort: 'in',
      typeId: 'flow',
      properties: {},
      sourceAnchor: { x: 1, y: 0.25 },
      targetAnchor: { x: 0, y: 0.8 },
    },
  ];
  d.nodes[0].size = { width: 300, height: 200 };
  expect(edgeGeometry(d).get('e')?.source).toEqual({ x: 400, y: 250 });
  expect(edgeGeometry(d).get('e')?.target).toEqual({ x: 500, y: 264 });
});
