import { expect, it } from 'vitest';
import { standardNotations, standardNotation } from '../src/lib/standard-notations';
import { diagramErrors } from '../src/lib/notation';

it('provides valid standard templates with usable connections and notation-specific rules', () => {
  expect(Object.keys(standardNotations)).toEqual(['builtin', 'builtin-bpmn', 'builtin-uml']);
  expect(standardNotation('__proto__')).toBeUndefined();
  for (const notation of Object.values(standardNotations)) {
    const rule = notation.connectionRules[0];
    const node = (id: string, typeId: string) => ({
      id,
      typeId,
      position: { x: 0, y: 0 },
      properties: Object.fromEntries(
        notation.nodeTypes
          .find((n) => n.id === typeId)!
          .properties.map((p) => [p.key, p.default ?? '']),
      ),
    });
    expect(
      diagramErrors({
        schemaVersion: 1,
        notation,
        nodes: [node('a', rule.source.nodeType), node('b', rule.target.nodeType)],
        edges: [
          {
            id: 'edge',
            typeId: rule.edgeType,
            source: 'a',
            target: 'b',
            sourcePort: rule.source.port,
            targetPort: rule.target.port,
            properties: { label: '' },
          },
        ],
      }),
    ).toEqual([]);
  }
  const bpmn = standardNotations['builtin-bpmn'];
  expect(bpmn.connectionRules.some((r) => r.target.nodeType === 'startEvent')).toBe(false);
  expect(bpmn.connectionRules.some((r) => r.source.nodeType === 'endEvent')).toBe(false);
  const uml = standardNotations['builtin-uml'];
  expect(uml.edgeTypes.find((e) => e.id === 'realization')!.appearance).toMatchObject({
    line: 'dashed',
    targetMarker: 'hollow-triangle',
  });
  expect(
    uml.connectionRules.some(
      (r) =>
        r.edgeType === 'realization' &&
        r.source.nodeType === 'class' &&
        r.target.nodeType === 'interface',
    ),
  ).toBe(true);
  expect(
    uml.connectionRules.some(
      (r) =>
        r.edgeType === 'generalization' &&
        r.source.nodeType === 'class' &&
        r.target.nodeType === 'actor',
    ),
  ).toBe(false);
});
