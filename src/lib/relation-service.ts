import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { db } from './db';
import { reject } from './model-errors';
import { relationSnapshotSchema, type ModelRelation, type ModelDocument } from './model';
type Tx = Prisma.TransactionClient;
const json = (v: unknown) => v as Prisma.InputJsonValue;
export const relationSnapshot = (row: {
  id: string;
  sourceId: string;
  targetId: string;
  name: string;
  description: string;
  attributes: unknown;
  archived: boolean;
  revision: number;
  createdAt?: Date;
  copiedFrom?: unknown;
}): ModelRelation =>
  relationSnapshotSchema.parse({ ...row, incarnation: row.createdAt?.toISOString() });
async function recordRelation(tx: Tx, r: Parameters<typeof relationSnapshot>[0]) {
  await tx.modelRelationRevision.create({
    data: { relationId: r.id, number: r.revision, snapshot: json(relationSnapshot(r)) },
  });
}
export async function createRelation(
  tx: Tx,
  spaceId: string,
  input: {
    id?: string;
    sourceId: string;
    targetId: string;
    name: string;
    description?: string;
    attributes?: ModelRelation['attributes'];
    archived?: boolean;
    copiedFrom?: ModelRelation['copiedFrom'];
  },
  historical = false,
) {
  const ids = [...new Set([input.sourceId, input.targetId])];
  const ends = await tx.modelObject.findMany({ where: { spaceId, id: { in: ids } } });
  if (ends.length !== ids.length) reject(404, 'Участники связи не найдены в вашей модели');
  if (!historical && ends.some((o) => o.archived))
    reject(400, 'Архивные объекты нельзя связывать заново');
  const r = await tx.modelRelation.create({
    data: {
      id: input.id,
      sourceId: input.sourceId,
      targetId: input.targetId,
      name: input.name.trim(),
      description: input.description,
      archived: input.archived,
      spaceId,
      attributes: json(input.attributes ?? {}),
      copiedFrom: input.copiedFrom ? json(input.copiedFrom) : undefined,
    },
  });
  await recordRelation(tx, r);
  return relationSnapshot(r);
}
export async function materializeRelations(
  tx: Tx,
  d: ModelDocument,
  diagramId?: string,
  previous?: ModelDocument,
  restoring = false,
): Promise<ModelDocument> {
  const nodes = new Map(d.nodes.map((n) => [n.id, n]));
  const relations: ModelRelation[] = [];
  const edges = [];
  let created = false;
  for (const e of d.edges) {
    const sourceId = nodes.get(e.source)?.objectId,
      targetId = nodes.get(e.target)?.objectId;
    if (!sourceId || !targetId) reject(400, 'Связь ссылается на отсутствующее представление');
    const relationId =
      e.relationId ??
      (diagramId
        ? `relation_${createHash('sha256').update(`${diagramId}:${e.id}`).digest('hex').slice(0, 40)}`
        : randomUUID());
    const proposed = d.relations?.find((r) => r.id === relationId);
    let row = await tx.modelRelation.findUnique({ where: { id: relationId } });
    if (row && row.spaceId !== d.modelSpaceId) reject(404, 'Связь не найдена в вашей модели');
    if (!row && previous?.edges.some((x) => x.relationId === relationId) && !restoring)
      reject(409, 'Связь была удалена. Обновите модель');
    let r: ModelRelation;
    if (!row) {
      if (proposed && (proposed.sourceId !== sourceId || proposed.targetId !== targetId))
        reject(400, 'Участники стрелки не соответствуют связи модели');
      const type = e.bindingId
        ? d.bindings
            .find((b) => b.id === e.bindingId)
            ?.document.edgeTypes.find((t) => t.id === e.typeId)
        : undefined;
      r = await createRelation(
        tx,
        d.modelSpaceId,
        {
          id: relationId,
          sourceId,
          targetId,
          name:
            proposed?.name ??
            (typeof e.properties.label === 'string' && e.properties.label.trim()
              ? e.properties.label.trim().slice(0, 100)
              : (type?.name ?? 'Поясняющая связь')),
          description: proposed?.description,
          attributes:
            proposed?.attributes ??
            Object.fromEntries(
              (type?.properties ?? [])
                .filter((p) => p.scope === 'object' && e.properties[p.key] !== undefined)
                .map((p) => [p.objectKey ?? p.key, e.properties[p.key]]),
            ),
          archived: restoring ? proposed?.archived : false,
          copiedFrom: restoring ? proposed?.copiedFrom : undefined,
        },
        restoring,
      );
      created = true;
    } else r = relationSnapshot(row);
    if (r.sourceId !== sourceId || r.targetId !== targetId)
      reject(400, 'Участники стрелки не соответствуют связи модели');
    if (
      r.archived &&
      !restoring &&
      !previous?.edges.some((x) => x.id === e.id && x.relationId === relationId)
    )
      reject(400, 'Архивную связь нельзя размещать заново');
    if (!relations.some((x) => x.id === r.id)) relations.push(r);
    edges.push({ ...e, relationId });
  }
  if (created)
    await tx.modelSpace.update({
      where: { id: d.modelSpaceId },
      data: { revision: { increment: 1 } },
    });
  return { ...d, edges, relations };
}
async function ownSpace(tx: Tx, ownerId: string) {
  const space = await tx.modelSpace.findUnique({ where: { ownerId } });
  if (!space) reject(404, 'Модель не найдена');
  await tx.modelSpace.update({ where: { id: space.id }, data: { revision: { increment: 1 } } });
  return space;
}
export async function addRelation(
  ownerId: string,
  input: {
    name: string;
    sourceId: string;
    targetId: string;
    description?: string;
    attributes?: ModelRelation['attributes'];
    copyOf?: string;
  },
) {
  return db.$transaction(async (tx) => {
    const space = await ownSpace(tx, ownerId);
    const { copyOf, ...data } = input;
    let copiedFrom: ModelRelation['copiedFrom'];
    if (copyOf) {
      const origin = await tx.modelRelation.findFirst({ where: { id: copyOf, spaceId: space.id } });
      if (!origin) reject(404, 'Исходная связь не найдена');
      copiedFrom = { id: origin.id, name: origin.name };
    }
    return createRelation(tx, space.id, { ...data, copiedFrom });
  });
}
export async function updateRelation(
  ownerId: string,
  id: string,
  input: {
    revision: number;
    incarnation?: string;
    name?: string;
    description?: string;
    attributes?: ModelRelation['attributes'];
    archived?: boolean;
  },
  restoreNumber?: number,
) {
  return db.$transaction(async (tx) => {
    const space = await ownSpace(tx, ownerId),
      r = await tx.modelRelation.findFirst({ where: { id, spaceId: space.id } });
    if (!r) reject(404, 'Связь не найдена');
    if (
      r.revision !== input.revision ||
      (input.incarnation && input.incarnation !== r.createdAt.toISOString())
    )
      reject(409, 'Связь изменена. Обновите модель');
    const { revision, incarnation, ...fields } = input;
    let data = fields;
    if (restoreNumber !== undefined) {
      const old = await tx.modelRelationRevision.findUnique({
        where: { relationId_number: { relationId: id, number: restoreNumber } },
      });
      if (!old) reject(404, 'Версия связи не найдена');
      const s = relationSnapshotSchema.parse(old.snapshot);
      data = {
        name: s.name,
        description: s.description,
        attributes: s.attributes,
        archived: s.archived,
      };
    }
    const updated = await tx.modelRelation.update({
      where: { id },
      data: {
        ...data,
        attributes: data.attributes ? json(data.attributes) : undefined,
        revision: { increment: 1 },
      },
    });
    await recordRelation(tx, updated);
    return relationSnapshot(updated);
  });
}
export async function deleteRelation(
  ownerId: string,
  id: string,
  input: { revision: number; incarnation?: string },
) {
  return db.$transaction(async (tx) => {
    const space = await ownSpace(tx, ownerId),
      r = await tx.modelRelation.findFirst({ where: { id, spaceId: space.id } });
    if (!r) reject(404, 'Связь не найдена');
    if (
      r.revision !== input.revision ||
      (input.incarnation && input.incarnation !== r.createdAt.toISOString())
    )
      reject(409, 'Связь изменена. Обновите модель');
    const usages = await tx.diagramRelationUsage.findMany({
      where: { relationId: id },
      include: { diagram: { select: { name: true } } },
    });
    if (usages.length)
      reject(
        409,
        `Связь используется в диаграммах: ${usages.map((u) => u.diagram.name).join(', ')}. Сначала удалите её стрелки и сохраните диаграммы`,
      );
    await tx.modelRelation.delete({ where: { id } });
    return { ok: true };
  });
}
