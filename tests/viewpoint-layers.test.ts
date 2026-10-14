import { expect, it } from 'vitest';
import {
  layerLayout,
  layerConnectionRoute,
  layerOffsets,
  layerObjectObstacle,
  crossesObstacle,
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
it('lays out every diagram within finite planes without shrinking object geometry', () => {
  for (const count of [0, 1, 3, 4, 1000]) {
    const layout = layerLayout(count);
    expect(layout.positions).toHaveLength(count);
    for (const p of layout.positions) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x + 320).toBeLessThanOrEqual(layout.planeWidth);
      expect(p.y + 180).toBeLessThanOrEqual(layout.height);
    }
    expect(new Set(layout.positions.map((p) => `${p.x}:${p.y}`)).size).toBe(count);
  }
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
  const expanded = layerLayout(1, [tile]);
  expect(expanded.positions[0].x + tile.width + tile.depth).toBeLessThan(expanded.planeWidth);
  expect(expanded.positions[0].y + tile.height).toBeLessThan(expanded.height);
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

it('routes links through the side in separate outside columns with projection-aligned segments', () => {
  const source = { x: 300, y: 200 },
    target = { x: 500, y: 800 };
  const upper = { origin: 250, depth: 420 },
    lower = { origin: 850, depth: 420 };
  const route = layerConnectionRoute(source, target, upper, lower, 0)!;
  expect(route).not.toBeNull();
  expect(route.points[0]).toEqual(source);
  expect(route.points.at(-1)).toEqual(target);
  expect(route.path).not.toMatch(/[CQ]/);
  const vertical = route.points.find((p, i) => i && route.points[i - 1].x === p.x)!;
  expect(vertical.x).toBeLessThan(0);
  for (let i = 1; i < route.points.length; i++) {
    const p = route.points[i - 1],
      q = route.points[i];
    if (p.x !== q.x) expect(Math.abs((q.y - p.y) / (q.x - p.x))).toBeCloseTo(0.25, 8);
  }
  expect(layerConnectionRoute(source, target, upper, lower, 1)!.points[1].x).not.toBe(vertical.x);
});
it('detours around extruded objects instead of crossing their top faces or walls', () => {
  const obstacle = layerObjectObstacle('blocker', 150, 120, 160, 100);
  const plane = { origin: 250, depth: 420, obstacles: [obstacle] };
  const project = (u: number, v: number, origin: number) => ({
    x: u + v,
    y: origin - u / 4 + v / 4,
  });
  const source = project(450, 160, plane.origin),
    target = project(300, 160, 900);
  const route = layerConnectionRoute(source, target, plane, { origin: 900, depth: 420 }, 0)!;
  expect(route).not.toBeNull();
  expect(route.points.length).toBeGreaterThan(4);
  const inverse = (p: { x: number; y: number }) => ({
    x: p.x / 2 - 2 * (p.y - plane.origin),
    y: p.x / 2 + 2 * (p.y - plane.origin),
  });
  const column = route.points.findIndex((p) => p.x < 0);
  for (let i = 1; i <= column; i++)
    expect(
      crossesObstacle(inverse(route.points[i - 1]), inverse(route.points[i]), obstacle.points),
    ).toBe(false);
});
it('starts compact, opens space on both sides of a chosen layer, and restores original offsets', () => {
  const heights = [400, 480, 420],
    compact = layerOffsets(heights, new Set());
  const open = layerOffsets(heights, new Set([1]));
  expect(compact[1]).toBeLessThan(heights[0]);
  expect(open[1] - open[0]).toBeGreaterThan(heights[0]);
  expect(open[2] - open[1]).toBeGreaterThan(heights[1]);
  expect(layerOffsets(heights, new Set())).toEqual(compact);
});

it('does not draw a route through an overlapping object that blocks its endpoint', () => {
  const plane = {
    origin: 250,
    depth: 420,
    obstacles: [layerObjectObstacle('blocker', 400, 120, 180, 100)],
  };
  const source = { x: 450 + 160, y: plane.origin - 450 / 4 + 160 / 4 };
  expect(
    layerConnectionRoute(source, { x: 100, y: 900 }, plane, { origin: 900, depth: 420 }, 0),
  ).toBeNull();
});
