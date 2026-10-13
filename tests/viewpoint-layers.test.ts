import { expect, it } from 'vitest';
import {
  layerLayout,
  viewpointLayers,
  UNASSIGNED_LAYER,
  diagramLayerLayout,
  objectPrism,
  OBJECT_DEPTH,
} from '../src/lib/viewpoint-layers';
import type { Structure } from '../src/lib/structure';
import { builtinNotation } from '../src/lib/notation';
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
      expect(p.y + 180).toBeLessThanOrEqual(layout.height);
    }
    expect(new Set(layout.positions.map((p) => `${p.x}:${p.y}`)).size).toBe(count);
  }
  const { positions: _, ...expanded } = layerLayout(1000, false);
  expect(layerLayout(1000, true)).toEqual({ ...expanded, positions: [] });
});

it('expands diagram and layer bounds instead of shrinking distant or large objects', () => {
  const document = {
    schemaVersion: 1 as const,
    notation: builtinNotation,
    edges: [],
    nodes: [
      { id: 'small', typeId: 'process', position: { x: -1000, y: -200 }, properties: {} },
      {
        id: 'large',
        typeId: 'process',
        position: { x: 5000, y: 3000 },
        properties: {},
        size: { width: 1200, height: 800 },
      },
    ],
  };
  const tile = diagramLayerLayout(document);
  expect(tile.nodes[1].appearance).toMatchObject({ width: 1200, height: 800 });
  expect(tile.width).toBeGreaterThan(7200);
  expect(tile.depth).toBeGreaterThan(4000);
  const expanded = layerLayout(1, false, [tile]),
    closed = layerLayout(1, true, [tile]);
  expect(expanded.positions[0].x + tile.width + tile.depth).toBeLessThan(expanded.planeWidth);
  expect(expanded.positions[0].y + tile.height).toBeLessThan(expanded.height);
  expect(closed.planeWidth).toBe(expanded.planeWidth);
  expect(closed.height).toBe(expanded.height);
});
it('extrudes visible walls for notation shapes with a fixed depth independent of object dimensions', () => {
  for (const shape of ['rectangle', 'rounded', 'ellipse', 'diamond'] as const) {
    const prism = objectPrism({
      shape,
      width: 180,
      height: 80,
      fill: '#ffffff',
      stroke: '#000000',
    });
    expect(prism.walls.length).toBeGreaterThan(0);
    expect(prism.height).toBe(65 + OBJECT_DEPTH);
    for (const wall of prism.walls) expect(wall).not.toMatch(/NaN|Infinity/);
  }
});

it('joins extrusion walls to the inset rounded and elliptical top faces without protruding corners', () => {
  const appearance = { width: 180, height: 80, fill: '#ffffff', stroke: '#000000', strokeWidth: 8 };
  const inset = 5;
  for (const shape of ['rounded', 'ellipse'] as const) {
    const prism = objectPrism({ ...appearance, shape });
    for (const wall of prism.walls) {
      for (const vertex of wall.split(' ').slice(0, 2)) {
        const [x, y] = vertex.split(',').map(Number);
        const u = x / 2 - 2 * (y - appearance.width / 4);
        const v = x / 2 + 2 * (y - appearance.width / 4);
        expect(u).toBeGreaterThanOrEqual(inset - 1e-8);
        expect(u).toBeLessThanOrEqual(appearance.width - inset + 1e-8);
        expect(v).toBeGreaterThanOrEqual(inset - 1e-8);
        expect(v).toBeLessThanOrEqual(appearance.height - inset + 1e-8);
        if (shape === 'ellipse') {
          expect(((u - 90) / 85) ** 2 + ((v - 40) / 35) ** 2).toBeCloseTo(1, 8);
        } else {
          const dx = Math.max(inset + 12 - u, 0, u - (180 - inset - 12));
          const dy = Math.max(inset + 12 - v, 0, v - (80 - inset - 12));
          expect(dx * dx + dy * dy).toBeLessThanOrEqual(12 * 12 + 1e-8);
        }
      }
    }
  }
});

it('anchors connectors to actual extrusion walls and preserves custom corner rounding', () => {
  const a = {
    shape: 'rectangle' as const,
    width: 180,
    height: 80,
    strokeWidth: 8,
    fill: '#ffffff',
    stroke: '#000000',
  };
  expect(objectPrism(a)).toMatchObject({ target: { x: 10, y: 59 }, source: { x: 250, y: 34 } });
  const shape = {
    id: 'custom',
    name: 'Custom',
    baseShape: 'rectangle' as const,
    rounding: 25,
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ],
  };
  const prism = objectPrism({ ...a, shape: 'custom', shapeId: shape.id }, [shape]);
  expect(prism.target.x).toBeGreaterThan(10);
  expect(prism.source.x).toBeLessThan(250);
  expect(prism.walls.length).toBeGreaterThan(2);
  const reversed = objectPrism({ ...a, shape: 'custom', shapeId: shape.id }, [
    { ...shape, points: [...shape.points].reverse() },
  ]);
  expect(reversed.target.x).toBeCloseTo(prism.target.x, 8);
  expect(reversed.source.x).toBeCloseTo(prism.source.x, 8);
});
