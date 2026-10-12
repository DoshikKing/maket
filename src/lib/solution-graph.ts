import { type ModelObject, type ModelRelation, relationEntity } from './model';

type Model = { objects: ModelObject[]; relations?: ModelRelation[] };
export function graphSolutionId(id: string | null | undefined, model: Model): string {
  const entities = new Map(
    [...model.objects, ...(model.relations ?? []).map(relationEntity)].map((o) => [o.id, o]),
  );
  const links = new Map((model.relations ?? []).map((r) => [r.id, r]));
  const pending = id ? [id] : [],
    visited = new Set<string>();
  while (pending.length) {
    const key = pending.pop()!;
    if (visited.has(key)) continue;
    visited.add(key);
    const entity = entities.get(key),
      relation = links.get(key);
    if (entity?.kind === 'solution') return key;
    if (relation) pending.push(relation.targetId, relation.sourceId);
    if (entity?.parentId) pending.push(entity.parentId);
  }
  return 'all';
}

// Nesting defines membership. Semantic links may cross that boundary without importing another solution.
export function solutionGraph(model: Model, scope: string) {
  const relations = model.relations ?? [];
  const entities = new Map(
    [...model.objects, ...relations.map(relationEntity)].map((o) => [o.id, o]),
  );
  const links = new Map(relations.map((r) => [r.id, r]));
  if (scope !== 'all' && entities.get(scope)?.kind !== 'solution') return null;
  const children = new Map<string, string[]>(),
    touching = new Map<string, string[]>();
  function add(map: Map<string, string[]>, key: string, value: string) {
    const values = map.get(key) ?? [];
    values.push(value);
    map.set(key, values);
  }
  for (const o of entities.values()) if (o.parentId) add(children, o.parentId, o.id);
  for (const r of relations) {
    add(touching, r.sourceId, r.id);
    add(touching, r.targetId, r.id);
  }
  const members = new Set<string>(),
    pending = scope === 'all' ? [...entities.keys()] : [scope];
  for (let i = 0; i < pending.length; i++) {
    const id = pending[i];
    if (members.has(id) || !entities.has(id)) continue;
    members.add(id);
    pending.push(...(children.get(id) ?? []), ...(touching.get(id) ?? []));
  }
  const included = new Set<string>(),
    dependencies = [...members];
  for (let i = 0; i < dependencies.length; i++) {
    const id = dependencies[i];
    if (included.has(id) || !entities.has(id)) continue;
    included.add(id);
    const r = links.get(id);
    if (r) dependencies.push(r.sourceId, r.targetId);
  }
  const items = [...included].map((id) => ({
    entity: entities.get(id)!,
    relation: links.get(id),
    external: !members.has(id),
  }));
  const edges: { id: string; source: string; target: string; relationId?: string }[] = [];
  for (const item of items) {
    const r = item.relation;
    if (!r) continue;
    if (included.has(r.sourceId))
      edges.push({
        id: `semantic:${r.id}:source`,
        source: r.sourceId,
        target: r.id,
        relationId: r.id,
      });
    if (included.has(r.targetId))
      edges.push({
        id: `semantic:${r.id}:target`,
        source: r.id,
        target: r.targetId,
        relationId: r.id,
      });
  }
  const hierarchy = items
    .filter(({ entity }) => entity.parentId && included.has(entity.parentId))
    .map(({ entity }) => ({
      id: `hierarchy:${entity.id}`,
      source: entity.parentId!,
      target: entity.id,
    }));
  return { items, edges, hierarchy };
}
export type SolutionGraph = NonNullable<ReturnType<typeof solutionGraph>>;

// Breadth-first columns are deterministic, handle cycles, and cost O(nodes + edges).
export function graphPositions(graph: SolutionGraph) {
  const neighbors = graphNeighbors(graph, true),
    positions = new Map<string, { x: number; y: number }>();
  const isolated = graph.items.filter((i) => !neighbors.get(i.entity.id)?.size);
  isolated.forEach((item, index) =>
    positions.set(item.entity.id, { x: (index % 4) * 280, y: Math.floor(index / 4) * 160 }),
  );
  let top = isolated.length ? Math.ceil(isolated.length / 4) * 160 + 60 : 0;
  for (const item of [
    ...graph.items.filter((i) => !i.relation),
    ...graph.items.filter((i) => i.relation),
  ]) {
    if (positions.has(item.entity.id)) continue;
    const pending = [{ id: item.entity.id, depth: 0 }],
      visited = new Set([item.entity.id]);
    for (let i = 0; i < pending.length; i++) {
      const { id, depth } = pending[i];
      for (const next of neighbors.get(id) ?? []) {
        if (visited.has(next) || positions.has(next)) continue;
        visited.add(next);
        pending.push({ id: next, depth: depth + 1 });
      }
    }
    const rows = new Map<number, number>();
    const placed = pending.map(({ id, depth }) => {
      const row = rows.get(depth) ?? 0;
      rows.set(depth, row + 1);
      return { id, depth, row };
    });
    // Wrap long chains after eight columns so fit-to-view remains usable.
    const bands = new Map<number, number>();
    for (const [depth, count] of rows)
      bands.set(Math.floor(depth / 8), Math.max(bands.get(Math.floor(depth / 8)) ?? 0, count));
    const offsets = new Map<number, number>();
    let height = 0;
    for (const [band, count] of bands) {
      offsets.set(band, height);
      height += count * 160 + 60;
    }
    for (const { id, depth, row } of placed)
      positions.set(id, {
        x: (depth % 8) * 280,
        y: top + offsets.get(Math.floor(depth / 8))! + row * 160,
      });
    top += height;
  }
  return positions;
}
export function graphNeighbors(graph: SolutionGraph, hierarchy = false) {
  const neighbors = new Map<string, Set<string>>();
  for (const e of [...graph.edges, ...(hierarchy ? graph.hierarchy : [])]) {
    for (const [a, b] of [
      [e.source, e.target],
      [e.target, e.source],
    ]) {
      const set = neighbors.get(a) ?? new Set<string>();
      set.add(b);
      neighbors.set(a, set);
    }
  }
  return neighbors;
}
export function graphNeighborhood(graph: SolutionGraph, id: string) {
  const neighbors = graphNeighbors(graph),
    result = new Set([id]);
  // Object -> relationship -> other participant; relationship -> participant -> related relationship.
  for (let hop = 0, frontier = [id]; hop < 2; hop++) {
    const next: string[] = [];
    for (const key of frontier)
      for (const key2 of neighbors.get(key) ?? [])
        if (!result.has(key2)) {
          result.add(key2);
          next.push(key2);
        }
    frontier = next;
  }
  return result;
}
