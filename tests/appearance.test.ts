import { describe, it, expect } from 'vitest';
import {
  builtinNotation,
  diagramSchema,
  diagramErrors,
  notationSchema,
  type DiagramDocument,
} from '../src/lib/notation';
import {
  moveLayer,
  nodeAppearance,
  visibleProperties,
  shapeSchema,
  shapePoints,
  shapePath,
  lineDash,
  contrastColor,
} from '../src/lib/appearance';
function sample(): DiagramDocument {
  return {
    schemaVersion: 1,
    notation: structuredClone(builtinNotation),
    nodes: [
      { id: 'a', typeId: 'process', position: { x: 0, y: 0 }, properties: { title: 'A' } },
      { id: 'b', typeId: 'process', position: { x: 300, y: 0 }, properties: { title: 'B' } },
      { id: 'c', typeId: 'process', position: { x: 600, y: 0 }, properties: { title: 'C' } },
    ],
    edges: [
      {
        id: 'e',
        typeId: 'flow',
        source: 'a',
        target: 'b',
        sourcePort: 'out',
        targetPort: 'in',
        properties: {},
      },
    ],
  };
}
describe('presentation compatibility and validation', () => {
  it('keeps legacy diagram and notation snapshots unchanged when parsed', () => {
    const d = sample();
    expect(diagramSchema.parse(d)).toEqual(d);
    expect(notationSchema.parse(builtinNotation)).toEqual(builtinNotation);
  });
  it('preserves resized nodes, layers, text and connection overrides in a file round trip', () => {
    const d = sample();
    d.nodes[0] = {
      ...d.nodes[0],
      size: { width: 410, height: 170 },
      layer: 42,
      label: 'Новый текст',
      appearance: { fontSize: 22, textRotation: 90, showAttributes: false, fill: '#112233' },
    };
    d.edges[0].appearance = {
      line: 'custom',
      dashPattern: [8, 3, 1, 3],
      width: 4,
      sourceMarker: 'diamond',
      targetMarker: 'hollow-triangle',
      routing: 'bezier',
    };
    const parsed = diagramSchema.parse(JSON.parse(JSON.stringify(d)));
    expect(parsed).toEqual(d);
    expect(diagramErrors(parsed)).toEqual([]);
  });
  it('rejects out-of-bounds dimensions and untrusted styling', () => {
    const d = sample();
    d.nodes[0].size = { width: 1, height: 30 };
    expect(diagramSchema.safeParse(d).success).toBe(false);
    delete d.nodes[0].size;
    d.edges[0].appearance = { color: 'url(https://example.com)' };
    expect(diagramSchema.safeParse(d).success).toBe(false);
  });
  it('requires a pattern for custom connection lines', () => {
    const d = sample();
    d.edges[0].appearance = { line: 'custom' };
    expect(diagramErrors(d)).toContain('Для пользовательской линии задайте dashPattern');
    d.edges[0].appearance.dashPattern = [8, 4];
    expect(diagramErrors(d)).toEqual([]);
  });
  it('references custom shapes explicitly and preserves their bounded geometry', () => {
    const d = sample();
    const shape = {
      id: 'card',
      name: 'Карточка',
      baseShape: 'rectangle' as const,
      points: [
        { x: 20, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
      rounding: 10,
    };
    d.notation.shapes = [shape];
    d.notation.nodeTypes[1].appearance.shape = 'custom';
    d.notation.nodeTypes[1].appearance.shapeId = 'card';
    expect(diagramSchema.parse(d)).toEqual(d);
    expect(shapePath(shape, 200, 100)).not.toMatch(/NaN|Infinity/);
    d.nodes[0].appearance = { shape: 'custom', shapeId: 'missing' };
    expect(diagramErrors(d)).toContain('Неизвестная пользовательская форма элемента');
    d.notation.shapes = [];
    expect(notationSchema.safeParse(d.notation).success).toBe(false);
  });
  it('rejects degenerate shapes and excessive/outside control points', () => {
    const s = {
      id: 'bad',
      name: 'Bad',
      baseShape: 'rectangle',
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
      ],
      rounding: 0,
    };
    expect(shapeSchema.safeParse(s).success).toBe(false);
    expect(
      shapeSchema.safeParse({
        ...s,
        points: [
          { x: 0, y: 0 },
          { x: 101, y: 0 },
          { x: 50, y: 100 },
        ],
      }).success,
    ).toBe(false);
    expect(shapeSchema.safeParse({ ...s, points: Array(33).fill({ x: 50, y: 50 }) }).success).toBe(
      false,
    );
  });
});
describe('layer ordering and rendered content', () => {
  it('moves a middle node to front, back and adjacent levels without changing graph identity', () => {
    const nodes = sample().nodes;
    const top = moveLayer(nodes, 'b', 'front');
    expect(top.map((n) => n.id)).toEqual(['a', 'b', 'c']);
    expect(top.find((n) => n.id === 'b')?.layer).toBe(2);
    const bottom = moveLayer(top, 'b', 'back');
    expect(bottom.find((n) => n.id === 'b')?.layer).toBe(0);
    expect(moveLayer(bottom, 'b', 'forward').find((n) => n.id === 'b')?.layer).toBe(1);
    expect(moveLayer(bottom, 'b', 'backward')).toBe(bottom);
    expect(moveLayer(nodes, 'unknown', 'front')).toBe(nodes);
  });
  it('uses instance dimensions without mutating notation defaults', () => {
    const d = sample(),
      t = d.notation.nodeTypes[1];
    d.nodes[0].size = { width: 300, height: 160 };
    expect(nodeAppearance(d.nodes[0], t).width).toBe(300);
    expect(t.appearance.width).toBe(180);
  });
  it('displays boolean and numeric attributes and respects explicit visibility', () => {
    const d = sample();
    const t = d.notation.nodeTypes[1];
    t.properties.push(
      { key: 'automated', label: 'Авторабота', type: 'boolean', required: false },
      { key: 'count', label: 'Число', type: 'number', required: false },
      { key: 'secret', label: 'Скрыто', type: 'string', required: false, visible: false },
    );
    d.nodes[0].properties = { title: 'A', automated: true, count: 0, secret: 'hidden' };
    expect(visibleProperties(d.nodes[0], t)).toEqual([
      { key: 'automated', label: 'Авторабота', value: 'Да' },
      { key: 'count', label: 'Число', value: '0' },
    ]);
    d.nodes[0].properties.automated = false;
    expect(visibleProperties(d.nodes[0], t)[0].value).toBe('Нет');
  });
  it('keeps shapes scalable and text readable on dark user-defined fills', () => {
    expect(shapePoints('ellipse')).toHaveLength(16);
    expect(contrastColor('#ffffff')).toBe('#242635');
    expect(contrastColor('#111111')).toBe('#f8fafc');
    expect(lineDash({ line: 'dotted', width: 4, color: '#112233', targetMarker: 'none' })).toBe(
      '2 8',
    );
  });
});
