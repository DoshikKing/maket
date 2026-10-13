import { expect, it } from 'vitest';
import { layerLayout, viewpointLayers, UNASSIGNED_LAYER } from '../src/lib/viewpoint-layers';
import type { Structure } from '../src/lib/structure';
const entity = (id: string) => ({
  id,
  parentId: null,
  name: id,
  description: '',
  attributes: {},
  archived: false,
  revision: 1,
});
const space: Structure = {
  id: 'space',
  objects: [entity('owner'), entity('orphan')],
  viewpoints: [
    { id: 'v3', name: 'Код', description: '', order: 3, revision: 1 },
    { id: 'v1', name: 'Бизнес', description: '', order: 1, revision: 1 },
  ],
  diagrams: [
    { id: 'a', entityId: 'ea', name: 'A', viewpointId: 'v1', revision: 1 },
    { id: 'b', entityId: 'eb', name: 'B', viewpointId: 'v3', revision: 1 },
    { id: 'c', entityId: 'ec', name: 'C', viewpointId: null, revision: 1 },
  ],
  representations: [
    {
      id: 'r1',
      entityId: 'owner',
      diagramId: 'a',
      diagramName: 'A',
      notation: 'N',
      type: 'T',
      name: 'O',
    },
    {
      id: 'r2',
      entityId: 'owner',
      diagramId: 'a',
      diagramName: 'A',
      notation: 'N',
      type: 'T',
      name: 'O',
    },
    {
      id: 'r3',
      entityId: 'owner',
      diagramId: 'b',
      diagramName: 'B',
      notation: 'N',
      type: 'T',
      name: 'O',
    },
  ],
  relations: [
    { ...entity('direct'), sourceId: 'ea', targetId: 'eb' },
    { ...entity('context'), sourceId: 'owner', targetId: 'eb' },
  ],
  contextLinks: [
    {
      id: 'context',
      entityId: 'owner',
      sourceDiagramId: 'a',
      targetDiagramId: 'b',
      kind: 'viewpoint',
      meaning: 'Пропуск уровня',
      revision: 1,
    },
  ],
};
it('orders viewpoints, retains unassigned diagrams and does not duplicate canonical context links', () => {
  const graph = viewpointLayers(space);
  expect(graph.groups.map((g) => g.id)).toEqual(['v1', 'v3', UNASSIGNED_LAYER]);
  expect(graph.connections).toHaveLength(2);
  expect(graph.connections[0]).toMatchObject({
    source: 'a',
    target: 'b',
    inferred: false,
    kind: 'viewpoint',
  });
  expect(graph.connections[1]).toMatchObject({ source: 'a', target: 'b', kind: 'relation' });
});
it('infers only actual representation sources, deduplicates aliases and retains unresolved links', () => {
  const graph = viewpointLayers({
    ...space,
    contextLinks: [
      { ...space.contextLinks[0], sourceDiagramId: null },
      { ...space.contextLinks[0], id: 'orphan', entityId: 'orphan', sourceDiagramId: null },
    ],
  });
  expect(graph.connections.filter((c) => c.kind === 'viewpoint')).toHaveLength(1);
  expect(graph.connections[0]).toMatchObject({ source: 'a', target: 'b', inferred: true });
  expect(graph.unresolved.map((l) => l.id)).toEqual(['orphan']);
});
it('supports decomposition of diagrams themselves and never infers a missing explicit source', () => {
  const graph = viewpointLayers({
    ...space,
    contextLinks: [
      { ...space.contextLinks[0], entityId: 'ea', sourceDiagramId: null, kind: 'decomposition' },
      { ...space.contextLinks[0], id: 'missing', sourceDiagramId: 'deleted' },
    ],
  });
  expect(graph.connections[0]).toMatchObject({ source: 'a', target: 'b', kind: 'decomposition' });
  expect(graph.unresolved.map((l) => l.id)).toEqual(['missing']);
});
it('lays out every diagram within finite planes and collapses large groups without constructing cards', () => {
  for (const count of [0, 1, 3, 4, 1000]) {
    const layout = layerLayout(count, false);
    expect(layout.positions).toHaveLength(count);
    for (const p of layout.positions) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x + 320).toBeLessThanOrEqual(layout.planeWidth);
      expect(p.y + 115).toBeLessThanOrEqual(layout.height);
    }
    expect(new Set(layout.positions.map((p) => `${p.x}:${p.y}`)).size).toBe(count);
  }
  expect(layerLayout(1000, true)).toMatchObject({ height: 80, positions: [] });
});
