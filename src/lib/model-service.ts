import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { db } from './db';
import {
  builtinNotation,
  diagramSchema,
  diagramErrors,
  notationSchema,
  type DiagramDocument,
} from './notation';
import {
  modelDiagramSchema,
  bindingSchema,
  modelErrors,
  structureError,
  objectSnapshotSchema,
  modelClosure,
  splitType,
  qualify,
  type ModelDocument,
  type ModelObject,
  type NotationBinding,
} from './model';
export { ModelError, reject } from './model-errors';
import { reject } from './model-errors';
import {
  materializeRelations,
  relationSnapshot,
  createRelation,
  modelEntities,
} from './relation-service';
type Tx = Prisma.TransactionClient;
const json = (v: unknown) => v as Prisma.InputJsonValue;
const uuid = () => randomUUID();
export const snapshot = (o: {
  id: string;
  parentId: string | null;
  name: string;
  description: string;
  attributes: unknown;
  archived: boolean;
  revision: number;
  createdAt?: Date;
  copiedFrom?: unknown;
  kind?: string;
}): ModelObject => objectSnapshotSchema.parse({ ...o, incarnation: o.createdAt?.toISOString() });
async function recordObject(tx: Tx, object: Parameters<typeof snapshot>[0]) {
  await tx.modelObjectRevision.create({
    data: { objectId: object.id, number: object.revision, snapshot: json(snapshot(object)) },
  });
}
async function createObject(
  tx: Tx,
  spaceId: string,
  data: {
    id?: string;
    kind?: ModelObject['kind'];
    name: string;
    description?: string;
    parentId?: string | null;
    attributes?: ModelObject['attributes'];
    archived?: boolean;
    copiedFrom?: ModelObject['copiedFrom'];
  },
) {
  const object = await tx.modelObject.create({
    data: {
      ...data,
      copiedFrom: data.copiedFrom ? json(data.copiedFrom) : undefined,
      name: data.name.trim(),
      spaceId,
      attributes: json(data.attributes ?? {}),
    },
  });
  await recordObject(tx, object);
  return snapshot(object);
}
async function liveDocument(tx: Tx, document: ModelDocument): Promise<ModelDocument> {
  const all = await tx.modelObject.findMany({ where: { spaceId: document.modelSpaceId } });
  const allRelations = (
    await tx.modelRelation.findMany({
      where: { spaceId: document.modelSpaceId },
    })
  ).map(relationSnapshot);
  return {
    ...document,
    ...modelClosure(
      [
        ...document.nodes.map((n) => n.objectId),
        ...document.edges.flatMap((e) => (e.relationId ? [e.relationId] : [])),
      ],
      all.map(snapshot),
      allRelations,
    ),
  };
}
async function indexes(tx: Tx, diagramId: string, document: ModelDocument) {
  await tx.diagramObjectUsage.deleteMany({ where: { diagramId } });
  const counts = new Map<string, number>();
  for (const n of document.nodes) counts.set(n.objectId, (counts.get(n.objectId) ?? 0) + 1);
  if (counts.size)
    await tx.diagramObjectUsage.createMany({
      data: [...counts].map(([objectId, count]) => ({ diagramId, objectId, count })),
    });
  await tx.diagramRelationUsage.deleteMany({ where: { diagramId } });
  const relationCounts = new Map<string, number>();
  for (const e of document.edges)
    if (e.relationId) relationCounts.set(e.relationId, (relationCounts.get(e.relationId) ?? 0) + 1);
  if (relationCounts.size)
    await tx.diagramRelationUsage.createMany({
      data: [...relationCounts].map(([relationId, count]) => ({ diagramId, relationId, count })),
    });
  await tx.diagramNotation.deleteMany({ where: { diagramId } });
  await tx.diagramNotation.createMany({
    data: document.bindings.map((b) => ({ diagramId, bindingId: b.id, versionId: b.versionId })),
  });
}
function valid(document: ModelDocument) {
  modelDiagramSchema.parse(document);
  const errors = modelErrors(document);
  if (errors.length) reject(400, errors.join('; '));
}
async function commit(
  tx: Tx,
  diagram: { id: string; revision: number },
  document: ModelDocument,
  expected: number,
  reason = 'save',
) {
  valid(document);
  const changed = await tx.diagram.updateMany({
    where: { id: diagram.id, revision: expected },
    data: {
      document: json(document),
      revision: { increment: 1 },
      notationVersionId: document.bindings[0].versionId,
    },
  });
  if (changed.count !== 1)
    reject(409, 'Диаграмма изменена в другой вкладке. Обновите данные перед сохранением');
  await indexes(tx, diagram.id, document);
  await tx.diagramRevision.create({
    data: { diagramId: diagram.id, number: expected + 1, document: json(document), reason },
  });
  return tx.diagram.findUniqueOrThrow({ where: { id: diagram.id } });
}
async function legacy(
  tx: Tx,
  d: DiagramDocument,
  spaceId: string,
  diagramId?: string,
  versionId: string | null = null,
  oldBinding?: string,
): Promise<ModelDocument> {
  const errors = diagramErrors(d);
  if (errors.length) reject(400, errors.join('; '));
  const bindingId =
    oldBinding ??
    (diagramId
      ? `legacy_${createHash('sha256').update(diagramId).digest('hex').slice(0, 32)}`
      : uuid());
  const objects: ModelObject[] = [];
  const nodes = [];
  for (const n of d.nodes) {
    const type = d.notation.nodeTypes.find((t) => t.id === n.typeId)!;
    const objectId = diagramId
      ? `legacy_${createHash('sha256').update(`${diagramId}:${n.id}`).digest('hex').slice(0, 40)}`
      : uuid();
    const properties = { ...n.properties },
      attributes: ModelObject['attributes'] = {};
    const title = String(properties.title ?? type.name);
    if (
      title.trim().length > 0 &&
      title.length <= 100 &&
      type.properties.some((p) => p.key === 'title' && p.type === 'string' && p.scope !== 'object')
    )
      delete properties.title;
    for (const p of type.properties)
      if (p.scope === 'object' && properties[p.key] !== undefined) {
        attributes[p.objectKey ?? p.key] = properties[p.key];
        delete properties[p.key];
      }
    const existing = await tx.modelObject.findFirst({ where: { id: objectId, spaceId } });
    objects.push(
      existing
        ? snapshot(existing)
        : await createObject(tx, spaceId, {
            id: objectId,
            name: title.slice(0, 100).trim() || type.name.trim() || 'Объект',
            attributes,
          }),
    );
    nodes.push({ ...n, objectId, bindingId, properties });
  }
  return {
    schemaVersion: 2,
    modelSpaceId: spaceId,
    bindings: [{ id: bindingId, versionId, document: d.notation }],
    objects,
    nodes,
    edges: d.edges.map((e) => ({ ...e, bindingId })),
  };
}
export async function ensureModel(ownerId: string) {
  return db.$transaction(
    async (tx) => {
      const space = await tx.modelSpace.upsert({
        where: { ownerId },
        create: { ownerId },
        update: { revision: { increment: 0 } },
      });
      const allDiagrams = await tx.diagram.findMany({ where: { ownerId } });
      const diagrams = allDiagrams.filter(
        (d) =>
          !d.modelSpaceId ||
          !Array.isArray((d.document as unknown as ModelDocument).relations) ||
          (d.document as unknown as ModelDocument).edges.some((e) => !e.relationId),
      );
      for (const diagram of diagrams) {
        let document = diagram.modelSpaceId
          ? modelDiagramSchema.parse(diagram.document)
          : await legacy(
              tx,
              diagramSchema.parse(diagram.document),
              space.id,
              diagram.id,
              diagram.notationVersionId,
            );
        document = await materializeRelations(tx, document, diagram.id, undefined, true);
        await tx.diagram.update({ where: { id: diagram.id }, data: { modelSpaceId: space.id } });
        await commit(tx, diagram, document, diagram.revision, 'migration');
      }
      const unlinked = await tx.diagram.findMany({ where: { ownerId, entityId: null } });
      for (const diagram of unlinked) {
        const entity = await createObject(tx, space.id, { kind: 'diagram', name: diagram.name });
        await tx.diagram.update({ where: { id: diagram.id }, data: { entityId: entity.id } });
      }
      if (diagrams.length || unlinked.length)
        await tx.modelSpace.update({
          where: { id: space.id },
          data: { revision: { increment: 1 } },
        });
      return {
        ...(await tx.modelSpace.findUniqueOrThrow({ where: { id: space.id } })),
        diagrams: await tx.diagram.findMany({
          where: { ownerId },
          select: { id: true, entityId: true, name: true },
        }),
        relations: (
          await tx.modelRelation.findMany({
            where: { spaceId: space.id },
            orderBy: { createdAt: 'asc' },
          })
        ).map(relationSnapshot),
        objects: (
          await tx.modelObject.findMany({
            where: { spaceId: space.id },
            orderBy: { createdAt: 'asc' },
          })
        ).map(snapshot),
      };
    },
    { timeout: 60000 },
  );
}
export async function getDiagram(ownerId: string, diagramId: string, historicalNumber?: number) {
  await ensureModel(ownerId);
  return db.$transaction(async (tx) => {
    const d = await tx.diagram.findFirst({ where: { id: diagramId, ownerId } });
    if (!d) reject(404, 'Диаграмма не найдена');
    if (historicalNumber !== undefined) {
      const revision = await tx.diagramRevision.findUnique({
        where: { diagramId_number: { diagramId, number: historicalNumber } },
      });
      if (!revision) reject(404, 'Версия не найдена');
      return { ...d, revision: revision.number, document: revision.document };
    }
    return { ...d, document: await liveDocument(tx, modelDiagramSchema.parse(d.document)) };
  });
}
export async function listDiagrams(ownerId: string) {
  await ensureModel(ownerId);
  const ds = await db.diagram.findMany({ where: { ownerId }, orderBy: { updatedAt: 'desc' } });
  return Promise.all(
    ds.map((d) =>
      db.$transaction(async (tx) => ({
        ...d,
        document: await liveDocument(tx, modelDiagramSchema.parse(d.document)),
      })),
    ),
  );
}
async function notationBinding(
  tx: Tx,
  ownerId: string,
  notationId: string,
): Promise<NotationBinding> {
  if (notationId === 'builtin') return { id: uuid(), versionId: null, document: builtinNotation };
  const n = await tx.notation.findFirst({
    where: { id: notationId, ownerId },
    include: { versions: { orderBy: { number: 'desc' }, take: 1 } },
  });
  if (!n) reject(404, 'Нотация не найдена');
  return {
    id: uuid(),
    versionId: n.versions[0].id,
    document: notationSchema.parse(n.versions[0].document),
  };
}
export async function newDiagram(
  ownerId: string,
  input: { name: string; parentId?: string | null; notationIds?: string[]; document?: unknown },
) {
  const space = await ensureModel(ownerId);
  return db.$transaction(
    async (tx) => {
      await tx.modelSpace.update({ where: { id: space.id }, data: { revision: { increment: 0 } } });
      if (
        input.parentId &&
        !(await modelEntities(tx, space.id)).some((o) => o.id === input.parentId && !o.archived)
      )
        reject(400, 'Активный родитель диаграммы не найден');
      let document: ModelDocument;
      if (input.document) {
        if ((input.document as { schemaVersion?: number }).schemaVersion === 1)
          document = await legacy(tx, diagramSchema.parse(input.document), space.id);
        else {
          const imported = modelDiagramSchema.parse(input.document);
          valid(imported);
          const relationIds = new Map((imported.relations ?? []).map((r) => [r.id, uuid()]));
          const ids = new Map([
            ...imported.objects.map((o) => [o.id, uuid()] as const),
            ...relationIds,
          ]);
          const bindings = new Map(imported.bindings.map((b) => [b.id, uuid()]));
          const objects: ModelObject[] = [];
          for (const o of imported.objects) {
            objects.push(
              await createObject(tx, space.id, {
                id: ids.get(o.id),
                kind: o.kind === 'diagram' ? 'folder' : o.kind,
                parentId: o.parentId ? ids.get(o.parentId) : null,
                name: o.name,
                description: o.description,
                attributes: o.attributes,
                archived: o.archived,
                copiedFrom: { id: o.id, name: o.name },
              }),
            );
          }
          const pending = [...(imported.relations ?? [])];
          const relations = [];
          const present = new Set(imported.objects.map((o) => o.id));
          while (pending.length) {
            const i = pending.findIndex((r) => present.has(r.sourceId) && present.has(r.targetId));
            if (i < 0) reject(400, 'Цикл между участниками импортируемых связей');
            const [r] = pending.splice(i, 1);
            relations.push(
              await createRelation(
                tx,
                space.id,
                {
                  ...r,
                  id: ids.get(r.id)!,
                  sourceId: ids.get(r.sourceId)!,
                  targetId: ids.get(r.targetId)!,
                  parentId: r.parentId ? ids.get(r.parentId) : null,
                  copiedFrom: { id: r.id, name: r.name },
                },
                true,
              ),
            );
            present.add(r.id);
          }
          document = {
            ...imported,
            relations,
            modelSpaceId: space.id,
            objects,
            bindings: imported.bindings.map((b) => ({
              ...b,
              id: bindings.get(b.id)!,
              versionId: null,
            })),
            nodes: imported.nodes.map((n) => ({
              ...n,
              objectId: ids.get(n.objectId)!,
              bindingId: bindings.get(n.bindingId)!,
              profiles: n.profiles
                ? Object.fromEntries(
                    Object.entries(n.profiles).map(([key, values]) => {
                      const [bindingId, typeId] = splitType(key);
                      return [qualify(bindings.get(bindingId)!, typeId), values];
                    }),
                  )
                : undefined,
            })),
            edges: imported.edges.map((e) => ({
              ...e,
              relationId: e.relationId ? relationIds.get(e.relationId) : undefined,
              bindingId: e.bindingId ? bindings.get(e.bindingId)! : null,
            })),
          };
        }
      } else
        document = {
          schemaVersion: 2,
          modelSpaceId: space.id,
          bindings: await Promise.all(
            (input.notationIds ?? ['builtin']).map((id) => notationBinding(tx, ownerId, id)),
          ),
          objects: [],
          nodes: [],
          edges: [],
        };
      document = await materializeRelations(tx, document, undefined, undefined, !!input.document);
      document = await liveDocument(tx, document);
      valid(document);
      const entity = await createObject(tx, space.id, {
        kind: 'diagram',
        name: input.name,
        parentId: input.parentId,
      });
      const d = await tx.diagram.create({
        data: {
          entityId: entity.id,
          ownerId,
          modelSpaceId: space.id,
          name: input.name,
          notationVersionId: document.bindings[0].versionId,
          document: json(document),
          revisions: { create: { number: 1, document: json(document), reason: 'create' } },
        },
      });
      await indexes(tx, d.id, document);
      await tx.modelSpace.update({ where: { id: space.id }, data: { revision: { increment: 1 } } });
      return { ...d, document };
    },
    { timeout: 60000 },
  );
}
async function checkBindings(
  tx: Tx,
  ownerId: string,
  diagramId: string,
  old: ModelDocument,
  next: ModelDocument,
) {
  for (const b of next.bindings) {
    const previous = old.bindings.find((x) => x.id === b.id);
    if (previous) {
      if (JSON.stringify(previous) !== JSON.stringify(b))
        reject(400, 'Сохранённую версию нотации нельзя заменять');
      continue;
    }
    if (b.versionId) {
      const v = await tx.notationVersion.findFirst({
        where: { id: b.versionId, notation: { ownerId } },
      });
      if (!v || JSON.stringify(notationSchema.parse(v.document)) !== JSON.stringify(b.document))
        reject(400, 'Неизвестная версия нотации');
    } else if (JSON.stringify(b.document) !== JSON.stringify(builtinNotation)) {
      const revisions = await tx.diagramRevision.findMany({
        where: { diagramId },
        select: { document: true },
      });
      if (
        !revisions.some((r) =>
          (r.document as unknown as ModelDocument).bindings?.some(
            (x) =>
              JSON.stringify({ ...bindingSchema.parse(x), versionId: null }) === JSON.stringify(b),
          ),
        )
      )
        reject(400, 'Подключите нотацию из библиотеки');
    }
  }
}
export async function saveModelDiagram(
  ownerId: string,
  diagramId: string,
  expected: number,
  raw?: unknown,
  restoreNumber?: number,
) {
  await ensureModel(ownerId);
  return db.$transaction(
    async (tx) => {
      const d = await tx.diagram.findFirst({ where: { id: diagramId, ownerId } });
      if (!d) reject(404, 'Диаграмма не найдена');
      const current = modelDiagramSchema.parse(d.document);
      await tx.modelSpace.update({
        where: { id: current.modelSpaceId },
        data: { revision: { increment: 0 } },
      });
      if (restoreNumber !== undefined) {
        const r = await tx.diagramRevision.findUnique({
          where: { diagramId_number: { diagramId, number: restoreNumber } },
        });
        if (!r) reject(404, 'Версия не найдена');
        raw = r.document;
      }
      if (!raw) reject(400, 'Документ обязателен');
      let next: ModelDocument;
      if ((raw as { schemaVersion?: number }).schemaVersion === 1) {
        if (restoreNumber === undefined)
          reject(
            400,
            'Сохранение выполняется в формате v2; импортируйте старый файл через библиотеку',
          );
        const bindingId = `legacy_${createHash('sha256').update(d.id).digest('hex').slice(0, 32)}`;
        const revisions = await tx.diagramRevision.findMany({
          where: { diagramId },
          select: { document: true },
        });
        const original = revisions
          .flatMap((r) => (r.document as unknown as ModelDocument).bindings ?? [])
          .find((b) => b.id === bindingId);
        next = await legacy(
          tx,
          diagramSchema.parse(raw),
          current.modelSpaceId,
          d.id,
          original?.versionId ?? null,
          bindingId,
        );
      } else next = modelDiagramSchema.parse(raw);
      if (restoreNumber !== undefined) {
        const knownVersions = await tx.notationVersion.findMany({
          where: {
            id: { in: next.bindings.flatMap((b) => (b.versionId ? [b.versionId] : [])) },
            notation: { ownerId },
          },
          select: { id: true },
        });
        const known = new Set(knownVersions.map((v) => v.id));
        next = {
          ...next,
          bindings: next.bindings.map((b) =>
            b.versionId && !known.has(b.versionId) ? { ...b, versionId: null } : b,
          ),
        };
      }
      if (next.modelSpaceId !== current.modelSpaceId)
        reject(400, 'Пространство диаграммы нельзя менять');
      await checkBindings(tx, ownerId, diagramId, current, next);
      if (restoreNumber !== undefined) {
        // Historical snapshots remain self-contained even after an unused object is deleted.
        const known = await tx.modelObject.findMany({
          where: { id: { in: next.objects.map((o) => o.id) } },
          select: { id: true, spaceId: true },
        });
        if (known.some((o) => o.spaceId !== current.modelSpaceId))
          reject(409, 'Идентификатор исторического объекта занят в другом пространстве');
        const present = new Set(known.map((o) => o.id)),
          pending = next.objects.filter((o) => !present.has(o.id));
        if (pending.length)
          await tx.modelSpace.update({
            where: { id: current.modelSpaceId },
            data: { revision: { increment: 1 } },
          });
        while (pending.length) {
          const o = pending.shift()!;
          await createObject(tx, current.modelSpaceId, {
            id: o.id,
            kind: o.kind === 'diagram' ? 'folder' : o.kind,
            name: o.name,
            parentId: o.parentId,
            description: o.description,
            attributes: o.attributes,
            archived: o.archived,
            copiedFrom: o.copiedFrom,
          });
          present.add(o.id);
        }
      }
      next = await materializeRelations(tx, next, diagramId, current, restoreNumber !== undefined);
      const live = await liveDocument(tx, next);
      const prior = new Set(current.nodes.map((n) => `${n.id}:${n.objectId}`));
      for (const n of live.nodes) {
        const o = live.objects.find((o) => o.id === n.objectId);
        if (!o) reject(400, 'Объект не принадлежит пространству диаграммы');
        if (o.archived && !prior.has(`${n.id}:${n.objectId}`) && restoreNumber === undefined)
          reject(400, 'Архивный объект нельзя размещать заново');
      }
      if (restoreNumber === undefined)
        for (const r of (raw as ModelDocument).relations ?? []) {
          const actual = live.relations?.find((x) => x.id === r.id);
          if (
            actual &&
            (actual.revision !== r.revision ||
              (r.incarnation && actual.incarnation !== r.incarnation))
          )
            reject(409, 'Связь изменена в другой вкладке. Обновите модель');
        }
      // Stale shared data must not silently change a revision snapshot. Restoration deliberately uses current objects.
      if (restoreNumber === undefined)
        for (const o of next.objects) {
          const actual = live.objects.find((x) => x.id === o.id);
          if (actual && actual.revision !== o.revision)
            reject(409, 'Объект изменён в другой вкладке. Обновите модель и повторите сохранение');
        }
      const result = await commit(
        tx,
        d,
        live,
        expected,
        restoreNumber !== undefined ? 'restore' : 'save',
      );
      return { ...result, document: live };
    },
    { timeout: 60000 },
  );
}
export async function attachNotation(
  ownerId: string,
  diagramId: string,
  expected: number,
  notationId?: string,
  removeBindingId?: string,
) {
  await ensureModel(ownerId);
  return db.$transaction(async (tx) => {
    const d = await tx.diagram.findFirst({ where: { id: diagramId, ownerId } });
    if (!d) reject(404, 'Диаграмма не найдена');
    let document = await liveDocument(tx, modelDiagramSchema.parse(d.document));
    if (removeBindingId) {
      if (
        document.nodes.some((n) => n.bindingId === removeBindingId) ||
        document.edges.some((e) => e.bindingId === removeBindingId)
      )
        reject(409, 'Нотация используется представлениями или связями');
      document = {
        ...document,
        bindings: document.bindings.filter((b) => b.id !== removeBindingId),
        nodes: document.nodes.map((n) => ({
          ...n,
          profiles: n.profiles
            ? Object.fromEntries(
                Object.entries(n.profiles).filter(([key]) => splitType(key)[0] !== removeBindingId),
              )
            : undefined,
        })),
      };
      if (!document.bindings.length) reject(400, 'Оставьте хотя бы одну нотацию');
    } else {
      const binding = await notationBinding(tx, ownerId, notationId!);
      if (
        document.bindings.some(
          (b) =>
            b.versionId === binding.versionId &&
            b.document.id === binding.document.id &&
            b.document.version === binding.document.version,
        )
      )
        reject(409, 'Эта версия нотации уже подключена');
      document = { ...document, bindings: [...document.bindings, binding] };
    }
    modelDiagramSchema.parse(document);
    const result = await commit(tx, d, document, expected, 'notations');
    return { ...result, document };
  });
}
export async function duplicateModelDiagram(ownerId: string, diagramId: string) {
  const space = await ensureModel(ownerId);
  return db.$transaction(async (tx) => {
    await tx.modelSpace.update({ where: { id: space.id }, data: { revision: { increment: 0 } } });
    const original = await tx.diagram.findFirst({ where: { id: diagramId, ownerId } });
    if (!original) reject(404, 'Диаграмма не найдена');
    const document = await liveDocument(tx, modelDiagramSchema.parse(original.document));
    valid(document);
    const parent = original.entityId
      ? await tx.modelObject.findUnique({ where: { id: original.entityId } })
      : null;
    const entity = await createObject(tx, space.id, {
      kind: 'diagram',
      name: `${original.name.slice(0, 90)} — копия`,
      parentId: parent?.parentId,
    });
    const d = await tx.diagram.create({
      data: {
        entityId: entity.id,
        ownerId,
        modelSpaceId: document.modelSpaceId,
        name: `${original.name.slice(0, 90)} — копия`,
        notationVersionId: document.bindings[0].versionId,
        document: json(document),
        revisions: { create: { number: 1, document: json(document), reason: 'duplicate' } },
      },
    });
    await indexes(tx, d.id, document);
    return { ...d, document };
  });
}
export async function addObject(
  ownerId: string,
  input: {
    kind?: ModelObject['kind'];
    name: string;
    description?: string;
    parentId?: string | null;
    attributes?: ModelObject['attributes'];
    copyOf?: string;
  },
) {
  const space = await ensureModel(ownerId);
  return db.$transaction(async (tx) => {
    await tx.modelSpace.update({ where: { id: space.id }, data: { revision: { increment: 1 } } });
    if (
      input.parentId &&
      !(await modelEntities(tx, space.id)).some((o) => o.id === input.parentId && !o.archived)
    )
      reject(400, 'Активный родительский объект не найден');
    const { copyOf, ...data } = input;
    if (data.kind === 'diagram') reject(400, 'Создайте диаграмму через API диаграмм');
    const existingEntities = (await modelEntities(tx, space.id)).map((o) => snapshot(o));
    const kindError = structureError([
      ...existingEntities,
      {
        id: uuid(),
        parentId: data.parentId ?? null,
        name: data.name,
        kind: data.kind,
        description: '',
        attributes: {},
        archived: false,
        revision: 1,
      },
    ]);
    if (kindError) reject(400, kindError);
    let copiedFrom: ModelObject['copiedFrom'];
    if (copyOf) {
      const origin = await tx.modelObject.findFirst({ where: { id: copyOf, spaceId: space.id } });
      if (!origin) reject(404, 'Исходный объект не найден');
      copiedFrom = { id: origin.id, name: origin.name };
    }
    return createObject(tx, space.id, { ...data, copiedFrom });
  });
}
export async function deleteObject(
  ownerId: string,
  objectId: string,
  expected: number,
  incarnation?: string,
) {
  const space = await ensureModel(ownerId);
  return db.$transaction(async (tx) => {
    await tx.modelSpace.update({ where: { id: space.id }, data: { revision: { increment: 1 } } });
    const object = await tx.modelObject.findFirst({ where: { id: objectId, spaceId: space.id } });
    if (!object) reject(404, 'Объект не найден');
    if (incarnation && incarnation !== object.createdAt.toISOString())
      reject(409, 'Объект был удалён и восстановлен. Обновите модель');
    if (object.revision !== expected)
      reject(409, 'Объект изменён в другой вкладке. Обновите модель');
    if ((await modelEntities(tx, space.id)).some((o) => o.parentId === objectId))
      reject(409, 'У объекта есть дочерние объекты. Сначала переместите или удалите их');
    if (
      await tx.modelRelation.count({
        where: { spaceId: space.id, OR: [{ sourceId: objectId }, { targetId: objectId }] },
      })
    )
      reject(409, 'У объекта есть связи модели. Сначала удалите их в разделе «Связи»');
    const usages = await tx.diagramObjectUsage.findMany({
      where: { objectId },
      include: { diagram: { select: { name: true } } },
    });
    if (usages.length)
      reject(
        409,
        `Объект используется в диаграммах: ${usages.map((u) => u.diagram.name).join(', ')}. Сначала удалите его представления и сохраните диаграммы`,
      );
    if (object.kind === 'diagram')
      reject(409, 'Удалите диаграмму через её карточку в обозревателе');
    await tx.modelObject.delete({ where: { id: objectId } });
    return { ok: true };
  });
}
export async function updateObject(
  ownerId: string,
  objectId: string,
  input: {
    revision: number;
    incarnation?: string;
    name?: string;
    description?: string;
    parentId?: string | null;
    attributes?: ModelObject['attributes'];
    archived?: boolean;
  },
  restoreNumber?: number,
) {
  const space = await ensureModel(ownerId);
  return db.$transaction(async (tx) => {
    await tx.modelSpace.update({ where: { id: space.id }, data: { revision: { increment: 1 } } });
    const current = await tx.modelObject.findFirst({ where: { id: objectId, spaceId: space.id } });
    if (!current) reject(404, 'Объект не найден');
    if (input.incarnation && input.incarnation !== current.createdAt.toISOString())
      reject(409, 'Объект был удалён и восстановлен. Обновите модель');
    const { incarnation: _incarnation, ...fields } = input;
    let data = { ...fields };
    delete (data as Partial<typeof input>).revision;
    if (restoreNumber !== undefined) {
      const r = await tx.modelObjectRevision.findUnique({
        where: { objectId_number: { objectId, number: restoreNumber } },
      });
      if (!r) reject(404, 'Версия объекта не найдена');
      const s = objectSnapshotSchema.parse(r.snapshot);
      data = {
        revision: input.revision,
        name: s.name,
        description: s.description,
        parentId: s.parentId,
        attributes: s.attributes,
        archived: s.archived,
      };
      delete (data as Partial<typeof input>).revision;
    }
    if (data.parentId !== undefined && data.parentId !== current.parentId) {
      const objects = await modelEntities(tx, space.id);
      if (data.parentId && !objects.some((o) => o.id === data.parentId && !o.archived))
        reject(400, 'Активный родительский объект не найден');
      const error = structureError(
        objects.map((o) => snapshot(o.id === objectId ? { ...o, parentId: data.parentId! } : o)),
      );
      if (error) reject(400, error);
    }
    const changed = await tx.modelObject.updateMany({
      where: { id: objectId, spaceId: space.id, revision: input.revision },
      data: {
        ...data,
        attributes: data.attributes ? json(data.attributes) : undefined,
        revision: { increment: 1 },
      },
    });
    if (changed.count !== 1) reject(409, 'Объект изменён в другой вкладке. Обновите модель');
    const object = await tx.modelObject.findUniqueOrThrow({ where: { id: objectId } });
    if (object.kind === 'diagram')
      await tx.diagram.updateMany({ where: { entityId: object.id }, data: { name: object.name } });
    await recordObject(tx, object);
    return snapshot(object);
  });
}
export async function addRepresentation(
  ownerId: string,
  diagramId: string,
  expected: number,
  input: {
    bindingId: string;
    typeId: string;
    objectId?: string;
    properties?: ModelObject['attributes'];
    position: { x: number; y: number };
  },
) {
  await ensureModel(ownerId);
  return db.$transaction(async (tx) => {
    const d = await tx.diagram.findFirst({ where: { id: diagramId, ownerId } });
    if (!d) reject(404, 'Диаграмма не найдена');
    const stored = modelDiagramSchema.parse(d.document);
    await tx.modelSpace.update({
      where: { id: stored.modelSpaceId },
      data: { revision: { increment: 0 } },
    });
    let document = await liveDocument(tx, stored);
    const type = document.bindings
      .find((b) => b.id === input.bindingId)
      ?.document.nodeTypes.find((t) => t.id === input.typeId);
    if (!type) reject(400, 'Неизвестное отображение объекта');
    for (const [key, value] of Object.entries(input.properties ?? {})) {
      const p = type.properties.find((p) => p.key === key);
      if (!p || typeof value !== p.type) reject(400, 'Неверные свойства представления');
    }
    let object: ModelObject;
    if (input.objectId) {
      const existing = await tx.modelObject.findFirst({
        where: { id: input.objectId, spaceId: document.modelSpaceId, archived: false },
      });
      if (!existing) reject(404, 'Активный объект не найден');
      if (existing.kind === 'folder' || existing.kind === 'diagram')
        reject(400, 'Папки и диаграммы организуют структуру и не размещаются на канвасе');
      object = snapshot(existing);
      for (const p of type.properties)
        if (
          p.scope === 'object' &&
          input.properties?.[p.key] !== undefined &&
          input.properties[p.key] !== object.attributes[p.objectKey ?? p.key]
        )
          reject(400, 'Общие свойства существующего объекта изменяются отдельно');
    } else {
      await tx.modelSpace.update({
        where: { id: document.modelSpaceId },
        data: { revision: { increment: 1 } },
      });
      const attributes: ModelObject['attributes'] = {};
      for (const p of type.properties)
        if (p.scope === 'object' && p.default !== undefined)
          attributes[p.objectKey ?? p.key] = p.default;
      for (const p of type.properties)
        if (p.scope === 'object' && input.properties?.[p.key] !== undefined)
          attributes[p.objectKey ?? p.key] = input.properties[p.key];
      object = await createObject(tx, document.modelSpaceId, {
        name:
          String(
            input.properties?.title ??
              type.properties.find((p) => p.key === 'title')?.default ??
              type.name,
          )
            .slice(0, 100)
            .trim() ||
          type.name.trim() ||
          'Объект',
        attributes,
        parentId: d.entityId
          ? (await tx.modelObject.findUnique({ where: { id: d.entityId } }))?.parentId
          : null,
      });
    }
    const properties: ModelObject['attributes'] = {};
    for (const p of type.properties)
      if (
        (p.key !== 'title' ||
          p.type !== 'string' ||
          (typeof p.default === 'string' && p.default.length > 100)) &&
        p.scope !== 'object' &&
        p.default !== undefined
      )
        properties[p.key] = p.default;
    for (const p of type.properties)
      if (p.scope !== 'object' && input.properties?.[p.key] !== undefined) {
        const value = input.properties[p.key];
        if (
          !input.objectId &&
          p.key === 'title' &&
          p.type === 'string' &&
          String(value).trim().length > 0 &&
          String(value).length <= 100
        )
          continue;
        properties[p.key] = value;
      }
    document = await liveDocument(tx, {
      ...document,
      nodes: [
        ...document.nodes,
        {
          id: `node-${uuid()}`,
          objectId: object.id,
          bindingId: input.bindingId,
          typeId: input.typeId,
          position: input.position,
          properties,
        },
      ],
    });
    const result = await commit(tx, d, document, expected, 'representation');
    return { ...result, document };
  });
}
