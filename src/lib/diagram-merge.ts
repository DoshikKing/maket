import {
  aggregateNotation,
  modelClosure,
  rebindEdge,
  type ModelObject,
  type ModelRelation,
  type ViewDocument,
  type NotationBinding,
} from './model';

type Item = { id: string };
type State = { nodes: Item[]; edges: Item[]; bindings: NotationBinding[] };
export class DiagramConflict extends Error {
  constructor(path: string) {
    super(
      `Конфликт совместного редактирования: ${path}. Ваши несохранённые правки сохранены в редакторе; сравните их с актуальной версией.`,
    );
  }
}
export function sameDiagramValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((v, i) => sameDiagramValue(v, b[i]))
    );
  const left = a as Record<string, unknown>,
    right = b as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])];
  return keys.every((key) => sameDiagramValue(left[key], right[key]));
}
function mergeValue(
  base: unknown,
  local: unknown,
  remote: unknown,
  path: string,
  acknowledgment = false,
): unknown {
  if (sameDiagramValue(local, base)) return remote;
  if (sameDiagramValue(remote, base) || sameDiagramValue(local, remote)) return local;
  if (acknowledgment && local === undefined) return undefined;
  const plain = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === 'object' && !Array.isArray(v);
  // A move or resize is one gesture: never mix coordinates from competing gestures.
  if (
    !['position', 'size'].includes(path.split('.').at(-1)!) &&
    (plain(base) || (base === undefined && path.split('.').length > 2)) &&
    plain(local) &&
    plain(remote)
  ) {
    const previous = plain(base) ? base : {};
    return Object.fromEntries(
      [...new Set([...Object.keys(previous), ...Object.keys(local), ...Object.keys(remote)])]
        .map((key) => [
          key,
          mergeValue(previous[key], local[key], remote[key], `${path}.${key}`, acknowledgment),
        ])
        .filter(([, value]) => value !== undefined),
    );
  }
  if (acknowledgment) return local;
  throw new DiagramConflict(path);
}
function mergeItems<T extends Item>(
  base: T[],
  local: T[],
  remote: T[],
  path: string,
  acknowledgment: boolean,
): T[] {
  const b = new Map(base.map((v) => [v.id, v])),
    l = new Map(local.map((v) => [v.id, v])),
    r = new Map(remote.map((v) => [v.id, v]));
  return [...new Set([...r.keys(), ...l.keys(), ...b.keys()])].flatMap((id) => {
    const value = mergeValue(b.get(id), l.get(id), r.get(id), `${path}.${id}`, acknowledgment);
    return value === undefined ? [] : [value as T];
  });
}
// ponytail: revision-based field merges; use a text CRDT if simultaneous edits inside one text value are needed.
export function mergeDiagramState<T extends State>(
  base: T,
  local: T,
  remote: T,
  acknowledgment = false,
): T {
  const result = {
    ...remote,
    ...local,
    nodes: mergeItems(base.nodes, local.nodes, remote.nodes, 'nodes', acknowledgment),
    edges: mergeItems(base.edges, local.edges, remote.edges, 'edges', acknowledgment),
    bindings: mergeItems(
      base.bindings,
      local.bindings,
      remote.bindings,
      'bindings',
      acknowledgment,
    ),
  } as T;
  // Canonical properties are saved separately; incoming snapshots are authoritative.
  for (const key of ['objects', 'relations'] as const) {
    const own = (local as unknown as Record<string, Item[]>)[key],
      latest = (remote as unknown as Record<string, Item[]>)[key];
    if (own || latest) {
      const known = new Set(latest?.map((v) => v.id));
      const additions = (own ?? []).filter((v) => !known.has(v.id));
      const needed =
        key === 'relations'
          ? new Set(
              modelClosure(
                [
                  ...(result.nodes as (Item & { objectId?: string })[]).flatMap((n) =>
                    n.objectId ? [n.objectId] : [],
                  ),
                  ...(result.edges as (Item & { relationId?: string })[]).flatMap((e) =>
                    e.relationId ? [e.relationId] : [],
                  ),
                ],
                (result as unknown as { objects?: ModelObject[] }).objects ?? [],
                [...(latest ?? []), ...additions] as ModelRelation[],
              ).relations.map((r) => r.id),
            )
          : null;
      (result as unknown as Record<string, Item[]>)[key] = [
        ...(latest ?? []),
        ...additions.filter((v) => !needed || needed.has(v.id)),
      ];
    }
  }
  if ('notation' in result) result.notation = aggregateNotation(result.bindings);
  return result;
}
/** An own successful save may normalize IDs; that is not a competing participant's edit. */
export function mergeSavedDiagram(
  snapshot: ViewDocument,
  current: ViewDocument,
  saved: ViewDocument,
  concurrent: boolean,
) {
  const next = mergeDiagramState(snapshot, current, saved, !concurrent);
  const before = new Map(snapshot.edges.map((e) => [e.id, e]));
  const objects = new Map(snapshot.nodes.map((n) => [n.id, n.objectId]));
  const rebound =
    current.edges.some(
      (e) =>
        before.has(e.id) &&
        (before.get(e.id)!.source !== e.source || before.get(e.id)!.target !== e.target),
    ) || current.nodes.some((n) => objects.has(n.id) && objects.get(n.id) !== n.objectId);
  return !concurrent && rebound && next.edges.length ? rebindEdge(next, next.edges[0]) : next;
}
export function changedDiagramTargets(base: State, next: State): string[] {
  const targets = new Set<string>();
  const nodes = [...base.nodes, ...next.nodes] as (Item & { objectId?: string })[];
  for (const key of ['nodes', 'edges'] as const) {
    const before = new Map(base[key].map((v) => [v.id, v])),
      after = new Map(next[key].map((v) => [v.id, v]));
    for (const id of new Set([...before.keys(), ...after.keys()])) {
      if (sameDiagramValue(before.get(id), after.get(id))) continue;
      for (const v of [before.get(id), after.get(id)]) {
        if (!v) continue;
        const item = v as Item & {
          objectId?: string;
          relationId?: string;
          source?: string;
          target?: string;
        };
        if (item.objectId) targets.add(item.objectId);
        if (item.relationId) targets.add(item.relationId);
        for (const endpoint of [item.source, item.target])
          for (const node of nodes)
            if (node.id === endpoint && node.objectId) targets.add(node.objectId);
      }
    }
  }
  return [...targets];
}
