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
export const objectSnapshotSchema = z.object({
  id,
  parentId: id.nullable(),
  name: z.string().trim().min(1).max(100),
  description: z.string().max(4000),
  attributes: attributesSchema,
  archived: z.boolean(),
  revision: z.number().int().positive(),
  incarnation: z.string().datetime().optional(),
});
export type ModelObject = z.infer<typeof objectSnapshotSchema>;
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
  nodes: z
    .array(diagramSchema.shape.nodes.element.extend({ objectId: id, bindingId: id }))
    .max(1000),
  edges: z.array(diagramSchema.shape.edges.element.extend({ bindingId: id.nullable() })).max(3000),
});
export type ModelDocument = z.infer<typeof modelDiagramSchema>;
export const portableDiagramSchema = z.discriminatedUnion('schemaVersion', [
  diagramSchema,
  modelDiagramSchema,
]);
export type ViewDocument = DiagramDocument & { modelSpaceId: string; bindings: NotationBinding[] };
export type ModelDiagram = { id: string; name: string; revision: number; document: ModelDocument };
export type Space = { id: string; name: string; revision: number; objects: ModelObject[] };
// Preserve both object identity and tree order; delayed responses cannot roll back shared data.
export function mergeModelObjects(
  previous: ModelObject[],
  updates: ModelObject[],
  replace = false,
): ModelObject[] {
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
export function displayedView(d: ViewDocument, objects: ModelObject[]): DiagramDocument {
  const lookup = new Map(objects.map((o) => [o.id, o]));
  return {
    ...d,
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
export function packDocument(d: ViewDocument, objects: ModelObject[]): ModelDocument {
  return {
    schemaVersion: 2,
    modelSpaceId: d.modelSpaceId,
    bindings: d.bindings,
    objects: objectClosure(
      d.nodes.map((n) => n.objectId!),
      objects,
    ),
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
export function modelErrors(d: ModelDocument): string[] {
  const errors: string[] = [];
  if (new Set(d.edges.map((e) => e.id)).size !== d.edges.length)
    errors.push('Повторяющиеся идентификаторы связей');
  if (new Set(d.bindings.map((b) => b.id)).size !== d.bindings.length)
    errors.push('Повторяющиеся подключения нотаций');
  const tree = hierarchyError(d.objects);
  if (tree) errors.push(tree);
  const objects = new Map(d.objects.map((o) => [o.id, o]));
  for (const n of d.nodes) {
    if (!objects.has(n.objectId)) errors.push('Представление ссылается на отсутствующий объект');
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
    if (!source || !target) {
      errors.push('Связь ссылается на отсутствующее представление');
      continue;
    }
    if (
      !view.notation.nodeTypes
        .find((t) => t.id === source.typeId)
        ?.ports.some((p) => p.id === e.sourcePort && p.direction === 'output') ||
      !view.notation.nodeTypes
        .find((t) => t.id === target.typeId)
        ?.ports.some((p) => p.id === e.targetPort && p.direction === 'input')
    )
      errors.push('Неизвестный порт поясняющей связи');
  }
  // Annotation edges also count towards port capacities.
  for (const n of view.nodes)
    for (const p of view.notation.nodeTypes.find((t) => t.id === n.typeId)?.ports ?? [])
      if (
        p.maxConnections !== undefined &&
        view.edges.filter((e) =>
          p.direction === 'output'
            ? e.source === n.id && e.sourcePort === p.id
            : e.target === n.id && e.targetPort === p.id,
        ).length > p.maxConnections
      )
        errors.push(`Превышено число связей порта ${p.id}`);
  return [...new Set(errors)];
}
