import { z } from 'zod';
import {
  diagramSchema,
  notationSchema,
  diagramErrors,
  type DiagramDocument,
  type NotationDocument,
} from './notation';
const id = z
  .string()
  .regex(/^[a-zA-Z0-9_-]+$/)
  .max(100);
export const attributesSchema = z
  .record(id, z.union([z.string().max(2000), z.number().finite(), z.boolean()]))
  .refine((v) => Object.keys(v).length <= 100, 'Не больше 100 атрибутов');
export const copyOriginSchema = z.object({ id, name: z.string().min(1).max(100) });
export const entityKindSchema = z.enum(['solution', 'project', 'folder', 'diagram', 'object']);
export const entityLabels = {
  solution: 'Решение',
  project: 'Проект',
  folder: 'Папка',
  diagram: 'Диаграмма',
  object: 'Объект',
  relation: 'Связь',
};
export const objectSnapshotSchema = z.object({
  kind: entityKindSchema.optional(),
  id,
  parentId: id.nullable(),
  name: z.string().trim().min(1).max(100),
  description: z.string().max(4000),
  attributes: attributesSchema,
  archived: z.boolean(),
  revision: z.number().int().positive(),
  incarnation: z.string().datetime().optional(),
  copiedFrom: copyOriginSchema.nullable().optional(),
});
export type ModelObject = z.infer<typeof objectSnapshotSchema>;
export const relationSnapshotSchema = objectSnapshotSchema.extend({
  parentId: id.nullable().optional(),
  sourceId: id,
  targetId: id,
});
export type ModelRelation = z.infer<typeof relationSnapshotSchema>;
export const relationEntity = (r: ModelRelation): ModelObject => ({
  ...r,
  parentId: r.parentId ?? null,
});
export function participantId(d: Pick<ViewDocument, 'nodes' | 'edges'>, id: string) {
  return d.nodes.find((n) => n.id === id)?.objectId ?? d.edges.find((e) => e.id === id)?.relationId;
}
export function normalizeConnection<
  T extends {
    source: string;
    target: string;
    sourceHandle?: string | null;
    targetHandle?: string | null;
  },
>(d: ViewDocument, c: T): T {
  if (!d.edges.some((e) => e.id === c.source || e.id === c.target)) return c;
  const direction = (id: string, handle?: string | null) => {
    const n = d.nodes.find((n) => n.id === id);
    return d.notation.nodeTypes.find((t) => t.id === n?.typeId)?.ports.find((p) => p.id === handle)
      ?.direction;
  };
  return direction(c.source, c.sourceHandle) === 'input' ||
    direction(c.target, c.targetHandle) === 'output'
    ? {
        ...c,
        source: c.target,
        target: c.source,
        sourceHandle: c.targetHandle,
        targetHandle: c.sourceHandle,
      }
    : c;
}
// Include hierarchy ancestors and relation participants, even when they have no shape on this canvas.
export function modelClosure(ids: string[], objects: ModelObject[], relations: ModelRelation[]) {
  const entities = new Map([...objects, ...relations.map(relationEntity)].map((o) => [o.id, o]));
  const links = new Map(relations.map((r) => [r.id, r]));
  const included = new Set<string>();
  const pending = [...ids];
  for (let index = 0; index < pending.length; index++) {
    const id = pending[index];
    if (included.has(id)) continue;
    included.add(id);
    const entity = entities.get(id),
      relation = links.get(id);
    if (entity?.parentId) pending.push(entity.parentId);
    if (relation) pending.push(relation.sourceId, relation.targetId);
  }
  return {
    objects: [...included]
      .map((id) => objects.find((o) => o.id === id))
      .filter((o): o is ModelObject => !!o),
    relations: relations.filter((r) => included.has(r.id)),
  };
}
export const bindingSchema = z.object({
  id: id.refine((v) => v !== 'universal', 'Зарезервированный идентификатор подключения'),
  versionId: id.nullable(),
  document: notationSchema,
});
export type NotationBinding = z.infer<typeof bindingSchema>;
export const modelDiagramSchema = z.object({
  schemaVersion: z.literal(2),
  modelSpaceId: id,
  bindings: z.array(bindingSchema).min(1).max(12),
  objects: z.array(objectSnapshotSchema).max(5000),
  relations: z.array(relationSnapshotSchema).max(10000).optional(),
  nodes: z
    .array(diagramSchema.shape.nodes.element.extend({ objectId: id, bindingId: id }))
    .max(1000),
  edges: z
    .array(
      diagramSchema.shape.edges.element.extend({
        bindingId: id.nullable(),
        relationId: id.optional(),
      }),
    )
    .max(3000),
});
export type ModelDocument = z.infer<typeof modelDiagramSchema>;
export const portableDiagramSchema = z.discriminatedUnion('schemaVersion', [
  diagramSchema,
  modelDiagramSchema,
]);
export type ViewDocument = Omit<DiagramDocument, 'edges'> & {
  modelSpaceId: string;
  bindings: NotationBinding[];
  relations?: ModelRelation[];
  edges: (DiagramDocument['edges'][number] & { relationId?: string })[];
};
export type ModelDiagram = {
  entityId?: string | null;
  id: string;
  name: string;
  revision: number;
  document: ModelDocument;
};
export type Space = {
  diagrams?: { id: string; entityId: string | null; name: string }[];
  id: string;
  name: string;
  revision: number;
  objects: ModelObject[];
  relations?: ModelRelation[];
};
// Preserve both object identity and tree order; delayed responses cannot roll back shared data.
export function mergeModelObjects<T extends { id: string; revision: number; incarnation?: string }>(
  previous: T[],
  updates: T[],
  replace = false,
): T[] {
  const old = new Map(previous.map((o) => [o.id, o])),
    incoming = new Map(updates.map((o) => [o.id, o]));
  return (replace ? updates : [...previous, ...updates.filter((o) => !old.has(o.id))]).map((o) => {
    const before = old.get(o.id),
      next = incoming.get(o.id);
    return before &&
      (!next || (before.incarnation === next.incarnation && before.revision >= next.revision))
      ? before
      : (next ?? o);
  });
}
export const qualify = (bindingId: string, typeId: string) => `${bindingId}:${typeId}`;
export function splitType(typeId: string): [string, string] {
  const i = typeId.indexOf(':');
  return [typeId.slice(0, i), typeId.slice(i + 1)];
}
export function aggregateNotation(bindings: NotationBinding[]): NotationDocument {
  return {
    schemaVersion: 1,
    id: 'combined',
    version: '1.0.0',
    name: bindings.map((b) => b.document.name).join(' + '),
    description: '',
    shapes: bindings.flatMap((b) =>
      (b.document.shapes ?? []).map((s) => ({ ...s, id: qualify(b.id, s.id) })),
    ),
    nodeTypes: bindings.flatMap((b) =>
      b.document.nodeTypes.map((t) => ({
        ...t,
        id: qualify(b.id, t.id),
        appearance: {
          ...t.appearance,
          shapeId: t.appearance.shapeId ? qualify(b.id, t.appearance.shapeId) : undefined,
        },
      })),
    ),
    edgeTypes: [
      ...bindings.flatMap((b) =>
        b.document.edgeTypes.map((t) => ({ ...t, id: qualify(b.id, t.id) })),
      ),
      {
        id: 'universal:association',
        name: 'Поясняющая связь',
        appearance: { line: 'dashed' as const, targetMarker: 'none' as const, color: '#64748b' },
        properties: [
          { key: 'label', label: 'Подпись', type: 'string' as const, required: false, default: '' },
        ],
      },
    ],
    connectionRules: bindings.flatMap((b) =>
      b.document.connectionRules.map((r) => ({
        ...r,
        edgeType: qualify(b.id, r.edgeType),
        source: { ...r.source, nodeType: qualify(b.id, r.source.nodeType) },
        target: { ...r.target, nodeType: qualify(b.id, r.target.nodeType) },
      })),
    ),
  };
}
export function projectDocument(d: ModelDocument): ViewDocument {
  const { objects: _objects, ...view } = d;
  return {
    ...view,
    schemaVersion: 1,
    notation: aggregateNotation(d.bindings),
    nodes: d.nodes.map((n) => ({
      ...n,
      typeId: qualify(n.bindingId, n.typeId),
      appearance: n.appearance?.shapeId
        ? { ...n.appearance, shapeId: qualify(n.bindingId, n.appearance.shapeId) }
        : n.appearance,
    })),
    edges: d.edges.map((e) => ({
      ...e,
      typeId: e.bindingId ? qualify(e.bindingId, e.typeId) : 'universal:association',
    })),
  };
}
// Keep an explicit choice within the source notation; otherwise choose its first applicable link.
export function connectionTypeForSource(
  d: ViewDocument,
  sourceId: string,
  selectedType: string,
  sourcePort?: string | null,
): string {
  if (selectedType === 'universal:association') return selectedType;
  const source = d.nodes.find((n) => n.id === sourceId);
  if (!source) return selectedType;
  const [bindingId, nodeType] = splitType(source.typeId);
  const binding = d.bindings.find((b) => b.id === bindingId);
  if (!binding) return selectedType;
  const [selectedBinding, selectedId] = splitType(selectedType);
  if (selectedBinding === bindingId && binding.document.edgeTypes.some((t) => t.id === selectedId))
    return selectedType;
  const applicable = binding.document.connectionRules.find(
    (r) => r.source.nodeType === nodeType && (!sourcePort || r.source.port === sourcePort),
  );
  return qualify(bindingId, applicable?.edgeType ?? binding.document.edgeTypes[0].id);
}
export function effectiveNode(
  n: DiagramDocument['nodes'][number],
  t: NotationDocument['nodeTypes'][number],
  object?: ModelObject,
) {
  if (!object) return n;
  const properties = { ...n.properties };
  for (const p of t.properties) {
    if (p.scope === 'object') {
      const value = object.attributes[p.objectKey ?? p.key];
      if (value === undefined) delete properties[p.key];
      else properties[p.key] = value;
    } else if (p.key === 'title' && p.type === 'string' && properties.title === undefined)
      properties.title = object.name;
  }
  return {
    ...n,
    properties,
    ...(!t.properties.some((p) => p.key === 'title') && n.label === undefined
      ? { label: object.name }
      : {}),
  };
}
export function effectiveEdge(
  e: DiagramDocument['edges'][number],
  t: NotationDocument['edgeTypes'][number],
  relation?: ModelRelation,
) {
  if (!relation) return e;
  const properties = { ...e.properties };
  for (const p of t.properties)
    if (p.scope === 'object') {
      const value = relation.attributes[p.objectKey ?? p.key];
      if (value !== undefined) properties[p.key] = value;
      else if (p.default !== undefined) properties[p.key] = p.default;
      else delete properties[p.key];
    }
  return { ...e, properties };
}
export function displayedView(d: ViewDocument, objects: ModelObject[]): DiagramDocument {
  const lookup = new Map(objects.map((o) => [o.id, o]));
  return {
    ...d,
    edges: d.edges.map((e) =>
      effectiveEdge(
        e,
        d.notation.edgeTypes.find((t) => t.id === e.typeId)!,
        d.relations?.find((r) => r.id === e.relationId),
      ),
    ),
    nodes: d.nodes.map((n) =>
      effectiveNode(
        n,
        d.notation.nodeTypes.find((t) => t.id === n.typeId)!,
        lookup.get(n.objectId ?? ''),
      ),
    ),
  };
}
export function objectClosure(ids: string[], objects: ModelObject[]): ModelObject[] {
  const lookup = new Map(objects.map((o) => [o.id, o])),
    included = new Set<string>();
  for (const id of ids) {
    let next: string | null = id;
    while (next && !included.has(next)) {
      included.add(next);
      next = lookup.get(next)?.parentId ?? null;
    }
  }
  return [...included].map((id) => lookup.get(id)).filter((o): o is ModelObject => !!o);
}
export function packDocument(
  d: ViewDocument,
  objects: ModelObject[],
  relations: ModelRelation[] = d.relations ?? [],
): ModelDocument {
  const closure = modelClosure(
    [
      ...d.nodes.map((n) => n.objectId!),
      ...d.edges.flatMap((e) => (e.relationId ? [e.relationId] : [])),
    ],
    objects,
    mergeModelObjects(d.relations ?? [], relations),
  );
  return {
    schemaVersion: 2,
    modelSpaceId: d.modelSpaceId,
    bindings: d.bindings,
    ...(d.relations || relations.length
      ? {
          relations: closure.relations,
        }
      : {}),
    objects: closure.objects,
    nodes: d.nodes.map((n) => {
      const [bindingId, typeId] = splitType(n.typeId);
      return {
        ...n,
        bindingId,
        typeId,
        objectId: n.objectId!,
        appearance: n.appearance?.shapeId
          ? { ...n.appearance, shapeId: splitType(n.appearance.shapeId)[1] }
          : n.appearance,
      };
    }),
    edges: d.edges.map((e) => {
      const [bindingId, typeId] = splitType(e.typeId);
      return { ...e, bindingId: bindingId === 'universal' ? null : bindingId, typeId };
    }),
  };
}
export function hierarchyError(objects: Pick<ModelObject, 'id' | 'parentId'>[]): string | null {
  const lookup = new Map(objects.map((o) => [o.id, o]));
  if (lookup.size !== objects.length) return 'Повторяющиеся идентификаторы объектов';
  for (const object of objects) {
    const visited = new Set<string>();
    let current: typeof object | undefined = object;
    while (current) {
      if (visited.has(current.id)) return 'Вложенность объектов не может содержать цикл';
      visited.add(current.id);
      if (current.parentId && !lookup.has(current.parentId)) return 'Родительский объект не найден';
      current = current.parentId ? lookup.get(current.parentId) : undefined;
    }
  }
  return null;
}
export function structureError(objects: ModelObject[]): string | null {
  const error = hierarchyError(objects);
  if (error) return error;
  const lookup = new Map(objects.map((o) => [o.id, o]));
  for (const o of objects) {
    const ancestors: ModelObject[] = [];
    let parent = o.parentId ? lookup.get(o.parentId) : undefined;
    while (parent) {
      ancestors.push(parent);
      parent = parent.parentId ? lookup.get(parent.parentId) : undefined;
    }
    if (o.kind === 'solution' && ancestors.some((p) => p.kind !== 'folder'))
      return 'Решение должно находиться в корне пространства или в корневой папке';
    if (o.kind === 'project' && !ancestors.some((p) => p.kind === 'solution'))
      return 'Проект должен принадлежать решению';
    if (o.kind === 'project' && ancestors.some((p) => p.kind === 'project'))
      return 'Проекты одного решения не вкладываются друг в друга';
  }
  return null;
}
export function modelErrors(d: ModelDocument): string[] {
  const errors: string[] = [];
  if (new Set(d.edges.map((e) => e.id)).size !== d.edges.length)
    errors.push('Повторяющиеся идентификаторы связей');
  if (new Set(d.bindings.map((b) => b.id)).size !== d.bindings.length)
    errors.push('Повторяющиеся подключения нотаций');
  if (d.nodes.some((n) => d.edges.some((e) => e.id === n.id)))
    errors.push('Идентификаторы представлений объектов и связей должны различаться');
  const tree = structureError([...d.objects, ...(d.relations ?? []).map(relationEntity)]);
  if (tree) errors.push(tree);
  const objects = new Map(d.objects.map((o) => [o.id, o]));
  for (const n of d.nodes) {
    if (!objects.has(n.objectId)) errors.push('Представление ссылается на отсутствующий объект');
    if (['folder', 'diagram'].includes(objects.get(n.objectId)?.kind ?? 'object'))
      errors.push('Папки и диаграммы не размещаются на канвасе');
    for (const key of Object.keys(n.profiles ?? {})) {
      const [bindingId, typeId] = splitType(key);
      if (
        !d.bindings.find((b) => b.id === bindingId)?.document.nodeTypes.some((t) => t.id === typeId)
      )
        errors.push('Неизвестный профиль отображения');
    }
    const b = d.bindings.find((b) => b.id === n.bindingId);
    if (!b || !b.document.nodeTypes.some((t) => t.id === n.typeId))
      errors.push('Неизвестное отображение объекта');
  }
  for (const e of d.edges)
    if (
      e.bindingId &&
      !d.bindings
        .find((b) => b.id === e.bindingId)
        ?.document.edgeTypes.some((t) => t.id === e.typeId)
    )
      errors.push('Неизвестное отображение связи');
  if (errors.length) return [...new Set(errors)];
  const view = displayedView(projectDocument(d), d.objects);
  const relations = new Map((d.relations ?? []).map((r) => [r.id, r]));
  if (relations.size !== (d.relations ?? []).length) errors.push('Повторяющиеся связи модели');
  for (const r of relations.values())
    if (
      (!objects.has(r.sourceId) && !relations.has(r.sourceId)) ||
      (!objects.has(r.targetId) && !relations.has(r.targetId))
    )
      errors.push('Связь ссылается на отсутствующий объект');
  for (const e of d.edges) {
    if (!e.relationId) {
      if (e.detachedSource || e.detachedTarget) errors.push('Свободный конец требует связи модели');
      continue; // Older v2 files are upgraded on the server.
    }
    const r = relations.get(e.relationId);
    if (!r) errors.push('Стрелка ссылается на отсутствующую связь модели');
    else if (
      (!e.detachedSource && participantId(d, e.source) !== r.sourceId) ||
      (!e.detachedTarget && participantId(d, e.target) !== r.targetId)
    )
      errors.push('Участники стрелки не соответствуют связи модели');
  }
  // Universal connections are graphical annotations; notation connections stay within their own binding.
  const normal = { ...view, edges: view.edges.filter((e) => e.typeId !== 'universal:association') };
  errors.push(...diagramErrors(normal));
  for (const e of view.edges.filter((e) => e.typeId === 'universal:association')) {
    const source = view.nodes.find((n) => n.id === e.source),
      target = view.nodes.find((n) => n.id === e.target);
    if (d.edges.find((raw) => raw.id === e.id)?.typeId !== 'association')
      errors.push('Неизвестный тип поясняющей связи');
    if (e.appearance?.line === 'custom' && !e.appearance.dashPattern)
      errors.push('Для пользовательской линии задайте dashPattern');
    if (
      Object.entries(e.properties).some(
        ([key, value]) => key !== 'label' || typeof value !== 'string',
      )
    )
      errors.push('Неверные свойства поясняющей связи');
    const sourceEdge = d.edges.find((x) => x.id === e.source),
      targetEdge = d.edges.find((x) => x.id === e.target);
    if (
      (!e.detachedSource && !source && !sourceEdge) ||
      (!e.detachedTarget && !target && !targetEdge)
    ) {
      errors.push('Связь ссылается на отсутствующее представление');
      continue;
    }
    if (
      (!e.detachedSource &&
        (sourceEdge
          ? !['in', 'out'].includes(e.sourcePort)
          : !view.notation.nodeTypes
              .find((t) => t.id === source!.typeId)
              ?.ports.some((p) => p.id === e.sourcePort && p.direction === 'output'))) ||
      (!e.detachedTarget &&
        (targetEdge
          ? !['in', 'out'].includes(e.targetPort)
          : !view.notation.nodeTypes
              .find((t) => t.id === target!.typeId)
              ?.ports.some((p) => p.id === e.targetPort && p.direction === 'input')))
    )
      errors.push('Неизвестный порт поясняющей связи');
  }
  const visiting = new Set<string>(),
    visited = new Set<string>();
  const edges = new Map(d.edges.map((e) => [e.id, e]));
  function cyclic(id: string): boolean {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    const e = edges.get(id);
    if (!e) return false;
    visiting.add(id);
    const result =
      (!e.detachedSource && cyclic(e.source)) || (!e.detachedTarget && cyclic(e.target));
    visiting.delete(id);
    visited.add(id);
    return result;
  }
  if (d.edges.some((e) => cyclic(e.id))) errors.push('Цикл между представлениями стрелок');
  // Annotation edges also count towards port capacities.
  for (const n of view.nodes)
    for (const p of view.notation.nodeTypes.find((t) => t.id === n.typeId)?.ports ?? [])
      if (
        p.maxConnections !== undefined &&
        view.edges.filter((e) =>
          p.direction === 'output'
            ? !e.detachedSource && e.source === n.id && e.sourcePort === p.id
            : !e.detachedTarget && e.target === n.id && e.targetPort === p.id,
        ).length > p.maxConnections
      )
        errors.push(`Превышено число связей порта ${p.id}`);
  return [...new Set(errors)];
}

// Rebinding one representation must not change the participants of its other aliases.
export function rebindEdge(d: ViewDocument, edge: ViewDocument['edges'][number]): ViewDocument {
  const next = {
    ...d,
    edges: d.edges.map((e) => ({ ...(e.id === edge.id ? edge : e) })),
    relations: [...(d.relations ?? [])],
  };
  const pending = new Set(next.edges.map((e) => e.id));
  const done = new Set<string>();
  while (pending.size) {
    const e = next.edges.find(
      (e) =>
        pending.has(e.id) &&
        (!next.edges.some((x) => x.id === e.source) || e.detachedSource || done.has(e.source)) &&
        (!next.edges.some((x) => x.id === e.target) || e.detachedTarget || done.has(e.target)),
    );
    if (!e) break; // modelErrors reports cycles.
    pending.delete(e.id);
    done.add(e.id);
    const r = next.relations.find((r) => r.id === e.relationId);
    if (!r) continue;
    const sourceId = e.detachedSource ? r.sourceId : participantId(next, e.source),
      targetId = e.detachedTarget ? r.targetId : participantId(next, e.target);
    if (sourceId && targetId && (sourceId !== r.sourceId || targetId !== r.targetId)) {
      const copy: ModelRelation = {
        ...r,
        id: crypto.randomUUID(),
        sourceId,
        targetId,
        parentId: null,
        revision: 1,
        incarnation: undefined,
        archived: false,
        copiedFrom: { id: r.id, name: r.name },
      };
      next.relations.push(copy);
      e.relationId = copy.id;
    }
  }
  return next;
}
