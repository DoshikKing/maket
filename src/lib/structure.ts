import type { ModelObject, ModelRelation } from './model';
export type Representation = {
  id: string;
  entityId: string;
  diagramId: string;
  diagramName: string;
  notation: string;
  type: string;
  name: string;
};
export type Viewpoint = {
  id: string;
  name: string;
  description: string;
  order: number;
  revision: number;
};
export type DiagramContextLink = {
  id: string;
  entityId: string;
  sourceDiagramId: string | null;
  targetDiagramId: string;
  kind: 'decomposition' | 'viewpoint';
  meaning: string;
  revision: number;
};
export type Structure = {
  viewpoints: Viewpoint[];
  contextLinks: DiagramContextLink[];
  id: string;
  objects: ModelObject[];
  relations: ModelRelation[];
  diagrams: {
    id: string;
    entityId: string | null;
    name: string;
    viewpointId: string | null;
    revision: number;
  }[];
  representations: Representation[];
};

/** Relations appear through their participants, independently of their storage parent. */
export function treeObjectPath(
  id: string,
  objects: ModelObject[],
  relations: ModelRelation[],
  seen = new Set<string>(),
): string[] {
  if (seen.has(id)) return [];
  seen.add(id);
  const object = objects.find((o) => o.id === id);
  if (object) {
    if (!object.parentId) return [id];
    const path = treeObjectPath(object.parentId, objects, relations, new Set(seen));
    return path.length ? [...path, id] : [];
  }
  const relation = relations.find((r) => r.id === id);
  if (!relation) return [];
  for (const participant of [relation.parentId, relation.sourceId, relation.targetId]) {
    if (!participant) continue;
    const path = treeObjectPath(participant, objects, relations, new Set(seen));
    if (path.length) return [...path, id];
  }
  return [];
}

export function visibleTreeEntities(
  query: string,
  objects: ModelObject[],
  relations: ModelRelation[],
): Set<string> {
  const entities = new Map([...objects, ...relations].map((o) => [o.id, o]));
  const visible = new Set(
    [...entities.values()]
      .filter((o) => o.name.toLowerCase().includes(query.toLowerCase()))
      .map((o) => o.id),
  );
  if (!query) return visible;
  const links = new Map(relations.map((r) => [r.id, r]));
  const pending = [...visible];
  while (pending.length) {
    const id = pending.pop()!;
    const relation = links.get(id);
    for (const parent of [entities.get(id)?.parentId, relation?.sourceId, relation?.targetId]) {
      if (!parent || visible.has(parent)) continue;
      visible.add(parent);
      pending.push(parent);
    }
  }
  return visible;
}
