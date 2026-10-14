import type { Structure } from './structure';
import type { DiagramDocument } from './notation';
import { nodeAppearance, nodeLabel, type NodeAppearance, type CustomShape } from './appearance';
import { edgeGeometry } from './diagram-geometry';
export type LayerStructure = Structure & { previews: Record<string, DiagramDocument> };
export const UNASSIGNED_LAYER = 'unassigned';
export type LayerConnection = {
  id: string;
  relationId: string;
  source: string;
  target: string;
  kind: 'decomposition' | 'viewpoint' | 'relation';
  name: string;
  meaning: string;
  entityId?: string;
  inferred: boolean;
};
export function viewpointLayers(space: Structure) {
  const diagrams = new Map(space.diagrams.map((d) => [d.id, d]));
  const byEntity = new Map(
    space.diagrams.filter((d) => d.entityId).map((d) => [d.entityId!, d.id]),
  );
  const representations = new Map<string, Set<string>>();
  for (const r of space.representations) {
    const set = representations.get(r.entityId) ?? new Set<string>();
    if (diagrams.has(r.diagramId)) set.add(r.diagramId);
    representations.set(r.entityId, set);
  }
  const entities = new Map([...space.objects, ...space.relations].map((e) => [e.id, e]));
  const connections: LayerConnection[] = [],
    unresolved: Structure['contextLinks'] = [];
  for (const link of space.contextLinks) {
    if (!diagrams.has(link.targetDiagramId)) continue;
    const ownerDiagram = byEntity.get(link.entityId);
    const sources = link.sourceDiagramId
      ? [link.sourceDiagramId]
      : ownerDiagram
        ? [ownerDiagram]
        : [...(representations.get(link.entityId) ?? [])];
    const validSources = sources.filter((id) => diagrams.has(id) && id !== link.targetDiagramId);
    if (!validSources.length) {
      unresolved.push(link);
      continue;
    }
    for (const source of validSources)
      connections.push({
        id: `${link.id}:${source}`,
        relationId: link.id,
        source,
        target: link.targetDiagramId,
        kind: link.kind,
        name: entities.get(link.entityId)?.name ?? 'Переход',
        meaning: link.meaning,
        entityId: link.entityId,
        inferred: !link.sourceDiagramId,
      });
  }
  const contextIds = new Set(space.contextLinks.map((l) => l.id));
  for (const relation of space.relations) {
    if (contextIds.has(relation.id)) continue;
    const source = byEntity.get(relation.sourceId),
      target = byEntity.get(relation.targetId);
    if (source && target)
      connections.push({
        id: relation.id,
        relationId: relation.id,
        source,
        target,
        kind: 'relation',
        name: relation.name,
        meaning: relation.description,
        inferred: false,
      });
  }
  const groups = [...space.viewpoints]
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
    .map((v) => ({
      id: v.id,
      name: v.name,
      description: v.description,
      diagrams: space.diagrams.filter((d) => d.viewpointId === v.id),
    }));
  groups.push({
    id: UNASSIGNED_LAYER,
    name: 'Без ракурса',
    description: 'Диаграммы, которым ещё не назначен ракурс',
    diagrams: space.diagrams.filter((d) => !d.viewpointId),
  });
  return { groups, connections, unresolved };
}
export const OBJECT_DEPTH = 28;
export const DIAGRAM_DEPTH = 4;
export function diagramLayerLayout(document?: DiagramDocument) {
  const nodes = (document?.nodes ?? []).flatMap((node) => {
    const type = document!.notation.nodeTypes.find((t) => t.id === node.typeId);
    if (!type) return [];
    const appearance = nodeAppearance(node, type);
    return [{ node, appearance, name: nodeLabel(node, type) }];
  });
  const edges = document ? edgeGeometry(document) : new Map();
  const points = [
    ...nodes.flatMap(({ node, appearance: a }) => [
      node.position,
      { x: node.position.x + a.width, y: node.position.y + a.height },
    ]),
    ...[...edges.values()].flatMap((g) => [g.source, g.target, g.center]),
  ];
  const minX = points.length ? Math.min(...points.map((p) => p.x)) - 60 : 0;
  const minY = points.length ? Math.min(...points.map((p) => p.y)) - 60 : 0;
  // Preserve native object dimensions: a large diagram expands its plane instead of shrinking objects.
  const width = points.length
    ? Math.max(360, Math.max(...points.map((p) => p.x)) - minX + 60)
    : 360;
  const depth = points.length
    ? Math.max(240, Math.max(...points.map((p) => p.y)) - minY + 60)
    : 240;
  return { nodes, edges, minX, minY, width, depth, height: (width + depth) / 4 };
}
export type DiagramLayerLayout = ReturnType<typeof diagramLayerLayout>;

// The top face keeps the notation's shape; front walls connect it to its footprint.
export function objectPrism(a: NodeAppearance, shapes: CustomShape[] = []) {
  const w = a.width,
    h = a.height;
  // Match NodeShape's stroke inset and corner radii, including custom rounding.
  const inset = (a.strokeWidth ?? 2) / 2 + 1;
  const innerW = Math.max(1, w - 2 * inset),
    innerH = Math.max(1, h - 2 * inset);
  const custom = shapes.find((shape) => shape.id === a.shapeId);
  let outline: { x: number; y: number }[];
  if (a.shape === 'ellipse') {
    const steps = Math.max(64, Math.min(256, Math.ceil(Math.PI * Math.sqrt(Math.max(w, h) / 0.4))));
    outline = Array.from({ length: steps }, (_, i) => {
      const angle = (i * Math.PI * 2) / steps;
      return {
        x: w / 2 + Math.cos(angle) * Math.max(1, w / 2 - inset),
        y: h / 2 + Math.sin(angle) * Math.max(1, h / 2 - inset),
      };
    });
  } else if (a.shape === 'diamond') {
    outline = [
      { x: w / 2, y: inset },
      { x: w - inset, y: h / 2 },
      { x: w / 2, y: h - inset },
      { x: inset, y: h / 2 },
    ];
  } else if (a.shape === 'custom' && custom) {
    const points = custom.points.map((p) => ({
      x: inset + (p.x * innerW) / 100,
      y: inset + (p.y * innerH) / 100,
    }));
    const rounding = custom.rounding / 100;
    outline = points.flatMap((p, i) => {
      const prev = points[(i + points.length - 1) % points.length],
        next = points[(i + 1) % points.length];
      const start = { x: p.x + (prev.x - p.x) * rounding, y: p.y + (prev.y - p.y) * rounding };
      const end = { x: p.x + (next.x - p.x) * rounding, y: p.y + (next.y - p.y) * rounding };
      if (!rounding) return [p];
      const curvature = Math.hypot(start.x - 2 * p.x + end.x, start.y - 2 * p.y + end.y);
      const steps = Math.max(2, Math.min(32, Math.ceil(Math.sqrt(curvature / 0.8))));
      return Array.from({ length: steps + 1 }, (_, step) => {
        const t = step / steps,
          r = 1 - t;
        return {
          x: r * r * start.x + 2 * r * t * p.x + t * t * end.x,
          y: r * r * start.y + 2 * r * t * p.y + t * t * end.y,
        };
      });
    });
  } else if (a.shape === 'rounded') {
    const rx = Math.min(12, innerW / 2),
      ry = Math.min(12, innerH / 2);
    outline = [
      { x: w - inset - rx, y: inset + ry, angle: -Math.PI / 2 },
      { x: w - inset - rx, y: h - inset - ry, angle: 0 },
      { x: inset + rx, y: h - inset - ry, angle: Math.PI / 2 },
      { x: inset + rx, y: inset + ry, angle: Math.PI },
    ].flatMap((corner) =>
      Array.from({ length: 17 }, (_, i) => ({
        x: corner.x + rx * Math.cos(corner.angle + (i * Math.PI) / 32),
        y: corner.y + ry * Math.sin(corner.angle + (i * Math.PI) / 32),
      })),
    );
  } else {
    outline = [
      { x: inset, y: inset },
      { x: w - inset, y: inset },
      { x: w - inset, y: h - inset },
      { x: inset, y: h - inset },
    ];
  }
  const area = outline.reduce((sum, p, i) => {
    const next = outline[(i + 1) % outline.length];
    return sum + p.x * next.y - next.x * p.y;
  }, 0);
  if (area < 0) outline.reverse();
  const points = outline.map((p) => ({ x: p.x + p.y, y: w / 4 - p.x / 4 + p.y / 4 }));
  const left = points.reduce((a, b) => (b.x < a.x ? b : a));
  const right = points.reduce((a, b) => (b.x > a.x ? b : a));
  return {
    target: { x: left.x, y: left.y + OBJECT_DEPTH / 2 },
    source: { x: right.x, y: right.y + OBJECT_DEPTH / 2 },
    width: w + h,
    height: (w + h) / 4 + OBJECT_DEPTH,
    walls: points.flatMap((p, i) => {
      const next = points[(i + 1) % points.length];
      if (next.x >= p.x) return [];
      return [
        `${p.x},${p.y} ${next.x},${next.y} ${next.x},${next.y + OBJECT_DEPTH} ${p.x},${p.y + OBJECT_DEPTH}`,
      ];
    }),
  };
}
// Visibility never changes plane geometry or the slots reserved for diagrams.
export function layerLayout(count: number, diagrams?: { width: number; depth: number }[]) {
  const tiles = Array.from(
    { length: count },
    (_, i) => diagrams?.[i] ?? { width: 360, depth: 240 },
  );
  const columnWidths = [0, 1].map((column) =>
    Math.max(360, ...tiles.filter((_, i) => i % 2 === column).map((tile) => tile.width)),
  );
  const surfaceWidth = 160 + columnWidths[0] + columnWidths[1];
  let depth = 80;
  const positions: { x: number; y: number }[] = [];
  for (let row = 0; row < Math.max(1, Math.ceil(count / 2)); row++) {
    const items = tiles.slice(row * 2, row * 2 + 2);
    items.forEach((tile, column) => {
      const u = 40 + (column ? columnWidths[0] + 80 : 0),
        v = depth;
      positions.push({ x: u + v, y: surfaceWidth / 4 + 25 - u / 4 + v / 4 - tile.width / 4 });
    });
    depth += Math.max(240, ...items.map((tile) => tile.depth)) + 100;
  }
  return {
    width: surfaceWidth + depth + 400,
    planeWidth: surfaceWidth + depth,
    surfaceWidth,
    depth,
    height: (surfaceWidth + depth) / 4 + 45,
    positions,
  };
}

export type LayerPoint = { x: number; y: number };
export type LayerObstacle = { id: string; points: LayerPoint[] };
export type LayerRoutePlane = { origin: number; depth: number; obstacles?: LayerObstacle[] };

export function convexHull(points: LayerPoint[]): LayerPoint[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (a: LayerPoint, b: LayerPoint, c: LayerPoint) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const half = (list: LayerPoint[]) => {
    const hull: LayerPoint[] = [];
    for (const p of list) {
      while (hull.length > 1 && cross(hull[hull.length - 2], hull[hull.length - 1], p) <= 0)
        hull.pop();
      hull.push(p);
    }
    return hull.slice(0, -1);
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}
export function layerObjectObstacle(
  id: string,
  u: number,
  v: number,
  width: number,
  height: number,
): LayerObstacle {
  // Extrusion shifts the apparent footprint in the inverse projection by (+2z, -2z).
  const points = [0, OBJECT_DEPTH].flatMap((z) => [
    { x: u + 2 * z, y: v - 2 * z },
    { x: u + width + 2 * z, y: v - 2 * z },
    { x: u + width + 2 * z, y: v + height - 2 * z },
    { x: u + 2 * z, y: v + height - 2 * z },
  ]);
  return {
    id,
    points: convexHull(
      points.flatMap((p) =>
        [-6, 6].flatMap((x) => [-6, 6].map((y) => ({ x: p.x + x, y: p.y + y }))),
      ),
    ),
  };
}
export function crossesObstacle(a: LayerPoint, b: LayerPoint, polygon: LayerPoint[]): boolean {
  let low = 0,
    high = 1;
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i],
      q = polygon[(i + 1) % polygon.length];
    const dx = q.x - p.x,
      dy = q.y - p.y;
    const initial = dx * (a.y - p.y) - dy * (a.x - p.x);
    const change = dx * (b.y - a.y) - dy * (b.x - a.x);
    if (Math.abs(change) < 1e-8) {
      if (initial <= 1e-7) return false;
    } else if (change > 0) low = Math.max(low, (1e-7 - initial) / change);
    else high = Math.min(high, (1e-7 - initial) / change);
    if (low >= high - 1e-8) return false;
  }
  return low < high - 1e-8;
}
// A* on the obstacle boundary coordinates; segments stay parallel to the plane's two axes.
function avoidObjects(
  start: LayerPoint,
  goal: LayerPoint,
  obstacles: LayerObstacle[],
  depth: number,
): LayerPoint[] | null {
  const xs = [...new Set([start.x, goal.x, ...obstacles.flatMap((o) => o.points.map((p) => p.x))])]
    .filter((x) => x >= goal.x && x <= start.x)
    .sort((a, b) => a - b);
  const ys = [
    ...new Set([0, depth, start.y, goal.y, ...obstacles.flatMap((o) => o.points.map((p) => p.y))]),
  ]
    .filter((y) => y >= Math.min(0, start.y) && y <= Math.max(depth, start.y))
    .sort((a, b) => a - b);
  const index = (x: number, y: number) => y * xs.length + x;
  const point = (id: number) => ({ x: xs[id % xs.length], y: ys[Math.floor(id / xs.length)] });
  const first = index(xs.indexOf(start.x), ys.indexOf(start.y)),
    last = index(xs.indexOf(goal.x), ys.indexOf(goal.y));
  const heap: { key: number; score: number }[] = [];
  const push = (item: { key: number; score: number }) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i) {
      const parent = (i - 1) >> 1;
      if (heap[parent].score <= item.score) break;
      heap[i] = heap[parent];
      i = parent;
    }
    heap[i] = item;
  };
  const pop = () => {
    const best = heap[0],
      tail = heap.pop()!;
    if (heap.length) {
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let child = i * 2 + 1;
        if (child + 1 < heap.length && heap[child + 1].score < heap[child].score) child++;
        if (heap[child].score >= tail.score) break;
        heap[i] = heap[child];
        i = child;
      }
      heap[i] = tail;
    }
    return best;
  };
  const costs = new Map<number, number>(),
    previous = new Map<number, number>();
  const blocked = new Map<string, boolean>();
  const heuristic = (p: LayerPoint) => Math.abs(p.x - goal.x) + Math.abs(p.y - goal.y);
  costs.set(first * 2, 0);
  push({ key: first * 2, score: heuristic(start) });
  while (heap.length) {
    const current = pop(),
      id = Math.floor(current.key / 2),
      direction = current.key % 2,
      p = point(id),
      cost = costs.get(current.key)!;
    if (current.score > cost + heuristic(p) + 1e-7) continue;
    if (id === last) {
      const path: LayerPoint[] = [];
      let key: number | undefined = current.key;
      while (key !== undefined) {
        path.push(point(Math.floor(key / 2)));
        key = previous.get(key);
      }
      return path.reverse();
    }
    const x = id % xs.length,
      y = Math.floor(id / xs.length);
    for (const [nx, ny, dir] of [
      [x - 1, y, 0],
      [x + 1, y, 0],
      [x, y - 1, 1],
      [x, y + 1, 1],
    ]) {
      if (nx < 0 || nx >= xs.length || ny < 0 || ny >= ys.length) continue;
      const next = index(nx, ny),
        q = point(next),
        edge = `${Math.min(id, next)}:${Math.max(id, next)}`;
      if (!blocked.has(edge))
        blocked.set(
          edge,
          obstacles.some((o) => crossesObstacle(p, q, o.points)),
        );
      if (blocked.get(edge)) continue;
      const key = next * 2 + dir,
        value = cost + Math.abs(q.x - p.x) + Math.abs(q.y - p.y) + (dir === direction ? 0 : 16);
      if (value >= (costs.get(key) ?? Infinity)) continue;
      costs.set(key, value);
      previous.set(key, current.key);
      push({ key, score: value + heuristic(q) });
    }
  }
  return null;
}
const branchCache = new WeakMap<LayerObstacle[], Map<string, LayerPoint[] | null>>();
export function layerConnectionRoute(
  source: LayerPoint,
  target: LayerPoint,
  sourcePlane: LayerRoutePlane,
  targetPlane: LayerRoutePlane,
  lane: number,
  sourceId?: string,
  targetId?: string,
) {
  const column = -80 - lane * 24;
  const branch = (
    port: LayerPoint,
    plane: LayerRoutePlane,
    owner: string | undefined,
    margin: number,
  ) => {
    const start = {
      x: port.x / 2 - 2 * (port.y - plane.origin),
      y: port.x / 2 + 2 * (port.y - plane.origin),
    };
    const obstacles = plane.obstacles ?? [],
      own = obstacles.find((o) => o.id === owner);
    const escape = {
      x: own ? Math.min(start.x, ...own.points.map((p) => p.x + p.y - start.y)) - 1 : start.x - 8,
      y: start.y,
    };
    if (obstacles.some((o) => o !== own && crossesObstacle(start, escape, o.points))) return null;
    const goal = { x: -24 - margin, y: start.y };
    const cache = branchCache.get(obstacles) ?? new Map<string, LayerPoint[] | null>();
    branchCache.set(obstacles, cache);
    const key = `${escape.x}:${escape.y}:${goal.x}:${goal.y}:${plane.depth}`;
    if (!cache.has(key))
      cache.set(
        key,
        obstacles.some((o) => crossesObstacle(escape, goal, o.points))
          ? avoidObjects(escape, goal, obstacles, plane.depth)
          : [escape, goal],
      );
    const path = cache.get(key)!;
    if (!path) return null;
    const project = (p: LayerPoint) => ({ x: p.x + p.y, y: plane.origin - p.x / 4 + p.y / 4 });
    const points = [port, ...path.map(project)];
    const end = points[points.length - 1];
    points.push({ x: column, y: end.y + (end.x - column) / 4 });
    return points;
  };
  const outgoing = branch(source, sourcePlane, sourceId, (lane % 4) * 8);
  const incoming = branch(target, targetPlane, targetId, 8 + (lane % 4) * 8);
  if (!outgoing || !incoming) return null;
  const raw = [...outgoing, ...incoming.reverse()];
  const points: LayerPoint[] = [];
  for (const p of raw) {
    const a = points[points.length - 2],
      b = points[points.length - 1];
    if (b && Math.hypot(p.x - b.x, p.y - b.y) < 1e-7) continue;
    if (a && b && Math.abs((b.x - a.x) * (p.y - b.y) - (b.y - a.y) * (p.x - b.x)) < 1e-7)
      points.pop();
    points.push(p);
  }
  return {
    points,
    path: points.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' '),
    labelX: column,
    labelY: (outgoing[outgoing.length - 1].y + incoming[0].y) / 2,
  };
}
export function layerOffsets(heights: number[], expanded: Set<number>) {
  let top = 0;
  return heights.map((height, i) => {
    const offset = top;
    top += expanded.has(i) || expanded.has(i + 1) ? height + 110 : Math.max(120, height * 0.55);
    return offset;
  });
}
