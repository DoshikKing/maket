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
export function layerLayout(
  count: number,
  collapsed: boolean,
  diagrams?: { width: number; depth: number }[],
) {
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
      if (!collapsed)
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
