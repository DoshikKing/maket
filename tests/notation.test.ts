import { describe, it, expect } from 'vitest';
import {
  builtinNotation,
  diagramErrors,
  diagramSchema,
  notationSchema,
  type DiagramDocument,
} from '../src/lib/notation';
function sample(): DiagramDocument {
  return {
    schemaVersion: 1,
    notation: structuredClone(builtinNotation),
    nodes: [
      { id: 'a', typeId: 'process', position: { x: 0, y: 0 }, properties: { title: 'Заказ' } },
      {
        id: 'b',
        typeId: 'decision',
        position: { x: 250, y: 0 },
        properties: { title: 'Оплачен?' },
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
        properties: { label: 'Проверить' },
      },
    ],
  };
}
describe('notation and diagram rules', () => {
  it('accepts the builtin notation and a meaningful process graph', () => {
    expect(notationSchema.safeParse(builtinNotation).success).toBe(true);
    expect(diagramSchema.safeParse(sample()).success).toBe(true);
    expect(diagramErrors(sample())).toEqual([]);
  });
  it('rejects unsupported document formats', () =>
    expect(diagramSchema.safeParse({ ...sample(), schemaVersion: 2 }).success).toBe(false));
  it('rejects nonexistent node types', () => {
    const d = sample();
    d.nodes[0].typeId = 'missing';
    expect(diagramErrors(d)).toContain('Неизвестный тип элемента');
  });
  it('rejects self connections', () => {
    const d = sample();
    d.edges[0].target = 'a';
    expect(diagramErrors(d)).toContain('Соединение запрещено правилами нотации');
  });
  it('rejects wrong port directions', () => {
    const d = sample();
    d.edges[0].sourcePort = 'in';
    expect(diagramErrors(d)).toContain('Соединение запрещено правилами нотации');
  });
  it('rejects dangling edges', () => {
    const d = sample();
    d.nodes.pop();
    expect(diagramErrors(d)).toContain('Связь ссылается на отсутствующий элемент');
  });
  it('enforces required property types', () => {
    const d = sample();
    d.nodes[0].properties.title = 3;
    expect(diagramErrors(d).join(' ')).toContain('неверный тип');
    d.nodes[0].properties.title = '';
    expect(diagramErrors(d).join(' ')).toContain('заполните');
  });
  it('rejects unknown properties', () => {
    const d = sample();
    d.nodes[0].properties.script = 'alert(1)';
    expect(diagramErrors(d).join(' ')).toContain('неизвестное свойство');
  });
  it('enforces port connection limits', () => {
    const d = sample();
    d.edges = [
      {
        id: 'e1',
        typeId: 'flow',
        source: 'b',
        target: 'a',
        sourcePort: 'yes',
        targetPort: 'in',
        properties: {},
      },
      {
        id: 'e2',
        typeId: 'flow',
        source: 'b',
        target: 'a',
        sourcePort: 'yes',
        targetPort: 'in',
        properties: {},
      },
    ];
    expect(diagramErrors(d).join(' ')).toContain('Превышено число связей');
  });
  it('rejects duplicated element identifiers', () => {
    const d = sample();
    d.nodes.push(d.nodes[0]);
    expect(diagramErrors(d)).toContain('Повторяющиеся идентификаторы элементов');
  });
  it('rejects malformed rules and duplicate ports', () => {
    const n = structuredClone(builtinNotation);
    n.nodeTypes[0].ports.push(n.nodeTypes[0].ports[0]);
    expect(notationSchema.safeParse(n).success).toBe(false);
    n.nodeTypes[0].ports.pop();
    n.connectionRules[0].source.port = 'missing';
    expect(notationSchema.safeParse(n).success).toBe(false);
  });
  it('rejects inconsistent defaults and untrusted appearance values', () => {
    const n = structuredClone(builtinNotation);
    n.nodeTypes[0].properties[0].default = false;
    expect(notationSchema.safeParse(n).success).toBe(false);
    n.nodeTypes[0].properties[0].default = 'Title';
    n.nodeTypes[0].appearance.fill = 'url(https://attacker.example)';
    expect(notationSchema.safeParse(n).success).toBe(false);
  });
  it('preserves graph through JSON round trip', () => {
    const d = sample();
    expect(diagramSchema.parse(JSON.parse(JSON.stringify(d)))).toEqual(d);
  });
});
