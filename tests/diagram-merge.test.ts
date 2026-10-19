import { expect, it } from 'vitest';
import {
  mergeDiagramState,
  DiagramConflict,
  changedDiagramTargets,
} from '../src/lib/diagram-merge';
import { builtinNotation } from '../src/lib/notation';
const base = {
  bindings: [{ id: 'binding', versionId: null, document: builtinNotation }],
  nodes: [
    {
      id: 'a',
      objectId: 'A',
      position: { x: 0, y: 0 },
      properties: {} as Record<string, string>,
      label: 'A',
    },
    {
      id: 'b',
      objectId: 'B',
      position: { x: 200, y: 0 },
      properties: {} as Record<string, string>,
      label: 'B',
    },
  ],
  edges: [] as { id: string; source: string; target: string; relationId?: string }[],
};
it('merges independent figures and fields and rebases undo without reverting a remote edit', () => {
  const local = structuredClone(base),
    remote = structuredClone(base);
  local.nodes[0].position = { x: 50, y: 20 };
  remote.nodes[1].label = 'Другой участник';
  const merged = mergeDiagramState(base, local, remote);
  expect(merged.nodes[0].position).toEqual({ x: 50, y: 20 });
  expect(merged.nodes[1].label).toBe('Другой участник');
  expect(mergeDiagramState(base, base, remote)).toEqual(remote);
  remote.nodes[0].label = 'Параллельная подпись';
  expect(mergeDiagramState(base, local, remote).nodes[0].label).toBe('Параллельная подпись');
  expect(changedDiagramTargets(base, local)).toEqual(['A']);
});
it('rejects overlapping moves, delete/edit conflicts and conflicting identity additions', () => {
  const local = structuredClone(base),
    remote = structuredClone(base);
  local.nodes[0].position.x = 50;
  remote.nodes[0].position.y = 20;
  expect(() => mergeDiagramState(base, local, remote)).toThrow(DiagramConflict);
  local.nodes.shift();
  expect(() => mergeDiagramState(base, local, remote)).toThrow(DiagramConflict);
  const empty = { ...base, nodes: [] };
  expect(() => mergeDiagramState(empty, base, remote)).toThrow(DiagramConflict);
});
it('keeps concurrent additions, deletes, connections and duplicate identical changes deterministic', () => {
  const local = structuredClone(base),
    remote = structuredClone(base);
  local.nodes.shift();
  remote.nodes.push({ ...remote.nodes[1], id: 'c', objectId: 'C' });
  expect(mergeDiagramState(base, local, remote).nodes.map((n) => n.id)).toEqual(['b', 'c']);
  expect(mergeDiagramState(base, local, local)).toEqual(local);
  remote.edges.push({ id: 'edge', source: 'a', target: 'b', relationId: 'relation' });
  expect(changedDiagramTargets(base, remote)).toEqual(['C', 'relation', 'A', 'B']);
});

it('merges independently introduced appearance overrides without merging colliding new identities', () => {
  const initial = {
    ...base,
    nodes: base.nodes.map((n) => ({
      ...n,
      appearance: undefined as { fill?: string; fontSize?: number } | undefined,
    })),
  };
  const local = structuredClone(initial),
    remote = structuredClone(initial);
  local.nodes[0].appearance = { fill: '#ff0000' };
  remote.nodes[0].appearance = { fontSize: 24 };
  expect(mergeDiagramState(initial, local, remote).nodes[0].appearance).toEqual({
    fill: '#ff0000',
    fontSize: 24,
  });
  expect(() => mergeDiagramState({ ...initial, nodes: [] }, local, remote)).toThrow(
    DiagramConflict,
  );
});
