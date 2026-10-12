import { expect, it } from 'vitest';
import {
  graphNeighborhood,
  graphPositions,
  graphSolutionId,
  solutionGraph,
} from '../src/lib/solution-graph';
import type { ModelObject, ModelRelation } from '../src/lib/model';
const object = (
  id: string,
  parentId: string | null = null,
  kind: ModelObject['kind'] = 'object',
): ModelObject => ({
  id,
  name: id,
  parentId,
  kind,
  description: '',
  attributes: {},
  revision: 1,
  archived: false,
});
const relation = (id: string, sourceId: string, targetId: string): ModelRelation => ({
  ...object(id),
  sourceId,
  targetId,
  relationType: 'Ассоциация',
});
it('includes canonical diagram/context links and relationship children, keeping cross-solution endpoints at the boundary', () => {
  const model = {
    objects: [
      object('s', null, 'solution'),
      object('p', 's', 'project'),
      object('a', 'p'),
      object('d', 'a', 'diagram'),
      object('child', 'r'),
      object('other', null, 'solution'),
      object('b', 'other'),
      object('c', 'other'),
    ],
    relations: [
      relation('r', 'a', 'b'),
      { ...relation('context', 'a', 'd'), relationType: 'Декомпозиция' },
      relation('external', 'b', 'c'),
      relation('nested', 'r', 'child'),
    ],
  };
  const graph = solutionGraph(model, 's')!;
  expect(graph.items.map((i) => i.entity.id).sort()).toEqual([
    'a',
    'b',
    'child',
    'context',
    'd',
    'nested',
    'p',
    'r',
    's',
  ]);
  expect(graph.items.filter((i) => i.external).map((i) => i.entity.id)).toEqual(['b']);
  expect(graph.edges).toHaveLength(6);
  expect(graph.hierarchy.some((e) => e.source === 'r' && e.target === 'child')).toBe(true);
  expect(graphSolutionId('child', model)).toBe('s');
  expect(graphNeighborhood(graph, 'a')).toEqual(new Set(['a', 'r', 'context', 'b', 'nested', 'd']));
});
it('retains recursively referenced relationships without importing their unrelated neighbors', () => {
  const model = {
    objects: [object('s', null, 'solution'), object('a', 's'), object('b'), object('c')],
    relations: [
      relation('inner', 'b', 'c'),
      relation('r', 'a', 'inner'),
      relation('unrelated', 'b', 'c'),
    ],
  };
  const graph = solutionGraph(model, 's')!;
  expect(
    graph.items
      .filter((i) => i.external)
      .map((i) => i.entity.id)
      .sort(),
  ).toEqual(['b', 'c', 'inner']);
  expect(graph.items.some((i) => i.entity.id === 'unrelated')).toBe(false);
  expect(graph.edges).toHaveLength(4);
});
it('lays out cycles, parallel and self links, disconnected entities exactly once without overlapping positions', () => {
  const model = {
    objects: [object('a'), object('b'), object('isolated')],
    relations: [
      relation('r1', 'a', 'b'),
      relation('r2', 'b', 'a'),
      relation('self', 'a', 'a'),
      relation('cycle1', 'cycle2', 'b'),
      relation('cycle2', 'cycle1', 'a'),
    ],
  };
  const graph = solutionGraph(model, 'all')!;
  expect(new Set(graph.items.map((i) => i.entity.id)).size).toBe(8);
  const positions = graphPositions(graph);
  expect(positions.size).toBe(8);
  expect(new Set([...positions.values()].map((p) => `${p.x}:${p.y}`)).size).toBe(8);
  expect(graphPositions(graph)).toEqual(positions);
  expect(graph.edges).toHaveLength(10);
});
it('supports empty models/solutions and rejects missing or non-solution scopes', () => {
  expect(solutionGraph({ objects: [] }, 'all')!.items).toEqual([]);
  expect(graphPositions(solutionGraph({ objects: [] }, 'all')!).size).toBe(0);
  const model = { objects: [object('s', null, 'solution'), object('a')] };
  expect(solutionGraph(model, 's')!.items.map((i) => i.entity.id)).toEqual(['s']);
  expect(solutionGraph(model, 'missing')).toBeNull();
  expect(solutionGraph(model, 'a')).toBeNull();
  expect(graphSolutionId('a', model)).toBe('all');
});
it('builds and lays out a large nested solution without recursive stack growth', () => {
  const objects = [
    object('s', null, 'solution'),
    ...Array.from({ length: 5000 }, (_, i) => object(`n${i}`, i ? `n${i - 1}` : 's')),
  ];
  const graph = solutionGraph({ objects }, 's')!;
  expect(graph.items).toHaveLength(5001);
  expect(graphSolutionId('n4999', { objects })).toBe('s');
  expect(graphPositions(graph).size).toBe(5001);
});
