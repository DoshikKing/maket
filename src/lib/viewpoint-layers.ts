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
  const custom = shapes.find((shape) => shape.id === a.shapeId);
  let outline: { x: number; y: number }[];
  if (a.shape === 'ellipse') {
    outline = Array.from({ length: 32 }, (_, i) => {
      const angle = (i * Math.PI) / 16;
      return { x: w / 2 + (Math.cos(angle) * w) / 2, y: h / 2 + (Math.sin(angle) * h) / 2 };
    });
  } else if (a.shape === 'diamond') {
    outline = [
      { x: w / 2, y: 0 },
      { x: w, y: h / 2 },
      { x: w / 2, y: h },
      { x: 0, y: h / 2 },
    ];
  } else if (a.shape === 'custom' && custom) {
    outline = custom.points.map((p) => ({ x: (p.x * w) / 100, y: (p.y * h) / 100 }));
  } else if (a.shape === 'rounded') {
    const radius = Math.min(12, w / 2, h / 2);
    outline = [
      { x: w - radius, y: radius, angle: -Math.PI / 2 },
      { x: w - radius, y: h - radius, angle: 0 },
      { x: radius, y: h - radius, angle: Math.PI / 2 },
      { x: radius, y: radius, angle: Math.PI },
    ].flatMap((corner) =>
      Array.from({ length: 5 }, (_, i) => ({
        x: corner.x + radius * Math.cos(corner.angle + (i * Math.PI) / 8),
        y: corner.y + radius * Math.sin(corner.angle + (i * Math.PI) / 8),
      })),
    );
  } else {
    outline = [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ];
  }
  const area = outline.reduce((sum, p, i) => {
    const next = outline[(i + 1) % outline.length];
    return sum + p.x * next.y - next.x * p.y;
  }, 0);
  if (area < 0) outline.reverse();
  const points = outline.map((p) => ({ x: p.x + p.y, y: w / 4 - p.x / 4 + p.y / 4 }));
  return {
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
