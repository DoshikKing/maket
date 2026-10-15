import { describe, it, expect } from 'vitest';
import {
  resolveInheritance,
  effectiveAttributes,
  modelClosure,
  inheritanceError,
  effectiveNode,
  effectiveEdge,
  type ModelObject,
  type ModelRelation,
} from '../src/lib/model';
import { builtinNotation } from '../src/lib/notation';
const object = (id: string, attributes: ModelObject['attributes'] = {}): ModelObject => ({
  id,
  kind: 'object',
  parentId: null,
  name: id,
  description: '',
  attributes,
  archived: false,
  revision: 1,
});
const link = (sourceId: string, targetId: string, relationType = 'наследует'): ModelRelation => ({
  ...object(`${sourceId}_${targetId}`),
  sourceId,
  targetId,
  relationType,
});
describe('object inheritance', () => {
  it('resolves live chains, preserves false and zero, and removes overrides without mutating the base', () => {
    const objects = [
      object('base', { x: 1, flag: true, title: 'Base' }),
      object('child', { flag: false, title: '' }),
      object('instance', { x: 0 }),
    ];
    const relations = [link('base', 'child'), link('child', 'instance', 'экземпляр')];
    const resolved = resolveInheritance(objects, relations);
    expect(effectiveAttributes(undefined, resolved[2])).toEqual({ x: 0, flag: false, title: '' });
    expect(resolved[2]).toMatchObject({ baseId: 'child', derivation: 'instance' });
    expect(objects[0].attributes).toEqual({ x: 1, flag: true, title: 'Base' });
    objects[0].attributes.x = 2;
    objects[2].attributes = {};
    expect(effectiveAttributes(undefined, resolveInheritance(objects, relations)[2]).x).toBe(2);
    expect(effectiveAttributes({ x: 7 }, resolved[2]).x).toBe(7);
  });
  it('keeps structural parents and copy provenance independent, and clears derived metadata after unlinking', () => {
    const base = object('base', { key: 'value' });
    const child = {
      ...object('child'),
      parentId: base.id,
      copiedFrom: { id: base.id, name: base.name },
    };
    expect(effectiveAttributes(undefined, resolveInheritance([base, child], [])[1])).toEqual({});
    const inherited = resolveInheritance([base, child], [link('base', 'child')]);
    expect(resolveInheritance(inherited, [])[1].baseId).toBeUndefined();
    expect(effectiveAttributes(undefined, resolveInheritance(inherited, [])[1])).toEqual({});
  });
  it('exports ancestor objects and their semantic relations even without ancestor representations', () => {
    const objects = [object('base'), object('child'), object('instance')];
    const relations = [link('base', 'child'), link('child', 'instance', 'экземпляр')];
    const closure = modelClosure(['instance'], objects, relations);
    expect(closure.objects.map((o) => o.id).sort()).toEqual(['base', 'child', 'instance']);
    expect(closure.relations).toEqual(relations);
  });
  it('rejects cycles, self inheritance, multiple bases and non-object participants', () => {
    const objects = [object('a'), object('b'), object('c')];
    expect(inheritanceError(objects, [link('a', 'b'), link('b', 'c')])).toBeNull();
    expect(inheritanceError(objects, [link('a', 'a')])).toMatch(/Цикл/);
    expect(inheritanceError(objects, [link('a', 'b'), link('b', 'c'), link('c', 'a')])).toMatch(
      /Цикл/,
    );
    expect(inheritanceError(objects, [link('a', 'c'), link('b', 'c', 'экземпляр')])).toMatch(
      /один/,
    );
    expect(
      inheritanceError([{ ...objects[0], kind: 'diagram' }, objects[1]], [link('a', 'b')]),
    ).toMatch(/только между объектами/);
  });
  it('marks instance representations and distinguishes the two semantic arrow styles', () => {
    const objects = resolveInheritance(
      [object('base', { automated: true }), object('child')],
      [link('base', 'child', 'экземпляр')],
    );
    const type = builtinNotation.nodeTypes.find((t) => t.id === 'process')!;
    const node = effectiveNode(
      { id: 'n', typeId: 'process', position: { x: 0, y: 0 }, properties: {} },
      type,
      objects[1],
    );
    expect(node.instanceOf).toBe('base');
    const edgeType = builtinNotation.edgeTypes[0];
    const edge = {
      id: 'e',
      typeId: edgeType.id,
      source: 'a',
      target: 'b',
      sourcePort: 'out',
      targetPort: 'in',
      properties: {},
    };
    expect(effectiveEdge(edge, edgeType, link('base', 'child'))).toMatchObject({
      properties: { label: '«extends»' },
      appearance: { line: 'solid', targetMarker: 'thin-arrow' },
    });
    expect(effectiveEdge(edge, edgeType, link('base', 'child', 'экземпляр'))).toMatchObject({
      properties: { label: '«instance»' },
      appearance: { line: 'dashed' },
    });
  });
});
