import { projectDocument } from '../src/lib/model';
import { drawioFixture } from './fixtures/drawio';
import { expect, it } from 'vitest';
import {
  mergeDiagramState,
  mergeSavedDiagram,
  sameDiagramValue,
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

it('does not resurrect an unused relation snapshot after deleting its last representation', () => {
  const relation = { id: 'r', sourceId: 'A', targetId: 'B' };
  const before = {
    ...structuredClone(base),
    edges: [{ id: 'e', source: 'a', target: 'b', relationId: 'r' }],
    relations: [relation],
  };
  const deleted = { ...before, edges: [] };
  const saved = { ...deleted, relations: [] };
  expect(mergeDiagramState(deleted, deleted, saved)).toEqual(saved);
});

it('retains unsaved relation dependencies and inheritance while pruning unused snapshots', () => {
  const pending = {
    ...structuredClone(base),
    edges: [{ id: 'e', source: 'a', target: 'b', relationId: 'child' }],
    relations: [
      { id: 'parent', sourceId: 'A', targetId: 'B' },
      { id: 'child', sourceId: 'parent', targetId: 'B' },
      { id: 'inheritance', sourceId: 'A', targetId: 'B', relationType: 'наследует' },
      { id: 'unused', sourceId: 'A', targetId: 'B' },
    ],
  };
  const remote = { ...structuredClone(base), relations: [] as typeof pending.relations };
  expect(mergeDiagramState(remote, pending, remote).relations.map((r) => r.id)).toEqual([
    'parent',
    'child',
    'inheritance',
  ]);
});
it('compares normalized JSON values independently of object key insertion order', () => {
  expect(
    sameDiagramValue({ position: { x: 1, y: 2 }, layer: undefined }, { position: { y: 2, x: 1 } }),
  ).toBe(true);
  expect(sameDiagramValue([{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'a' }])).toBe(false);
});
it('keeps delete/undo edits made during an own save without suppressing real concurrent conflicts', () => {
  const snapshot = projectDocument(drawioFixture().document);
  snapshot.edges = [snapshot.edges[0]];
  delete snapshot.edges[0].relationId;
  const saved = structuredClone(snapshot);
  saved.edges[0].relationId = 'server-relation';
  saved.relations = [
    {
      id: 'server-relation',
      sourceId: snapshot.nodes[0].objectId!,
      targetId: snapshot.nodes[1].objectId!,
      name: 'Связь',
      description: '',
      attributes: {},
      archived: false,
      revision: 1,
    },
  ];
  const deleted = { ...snapshot, edges: [] };
  expect(mergeSavedDiagram(snapshot, deleted, saved, false).edges).toEqual([]);
  expect(() => mergeSavedDiagram(snapshot, deleted, saved, true)).toThrow(DiagramConflict);
  const moved = structuredClone(snapshot);
  moved.nodes[0].position.x += 50;
  expect(mergeSavedDiagram(snapshot, moved, saved, false).nodes[0].position.x).toBe(
    moved.nodes[0].position.x,
  );
  const rebound = structuredClone(snapshot);
  rebound.edges[0].target = snapshot.nodes[2].id;
  const merged = mergeSavedDiagram(snapshot, rebound, saved, false),
    edge = merged.edges[0];
  expect(edge.relationId).not.toBe('server-relation');
  expect(merged.relations?.find((r) => r.id === edge.relationId)?.targetId).toBe(
    snapshot.nodes[2].objectId,
  );
});
