import type { Structure } from './structure';
import type { DiagramDocument } from './notation';
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
// Fixed isometric projection; positions change only when groups, filters or collapse state change.
export function layerLayout(count: number, collapsed: boolean) {
  if (collapsed) return { width: 960, height: 70, positions: [] };
  const rows = Math.max(1, Math.ceil(count / 3));
  const positions = Array.from({ length: count }, (_, i) => ({
    x: 170 + (i % 3) * 260 + Math.floor(i / 3) * 65,
    y: 135 + Math.floor(i / 3) * 150 - (i % 3) * 30,
  }));
  return { width: 1010 + (rows - 1) * 65, height: 310 + (rows - 1) * 150, positions };
}
