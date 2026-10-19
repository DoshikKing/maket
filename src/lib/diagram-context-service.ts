import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { db } from './db';
import { ensureModel, newDiagramInTransaction } from './model-service';
import { reject } from './model-errors';
import { createRelation, deleteRelationInTransaction, recordRelation } from './relation-service';

const id = z.string().min(1).max(100);
export const viewpointInput = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(4000).default(''),
  order: z.number().int().min(-1000000).max(1000000).default(0),
});
export const contextLinkInput = z
  .object({
    entityId: id,
    sourceDiagramId: id.nullable().default(null),
    kind: z.enum(['decomposition', 'viewpoint']),
    meaning: z.string().trim().max(4000).default(''),
    targetDiagramId: id.optional(),
    newDiagram: z
      .object({ name: z.string().trim().min(1).max(100), viewpointId: id.nullable().default(null) })
      .optional(),
  })
  .refine(
    (v) => !!v.targetDiagramId !== !!v.newDiagram,
    'Выберите существующую или новую диаграмму',
  );
async function transaction<T>(
  ownerId: string,
  run: (tx: Prisma.TransactionClient, spaceId: string) => Promise<T>,
) {
  const space = await ensureModel(ownerId);
  return db.$transaction(
    async (tx) => {
      await tx.modelSpace.update({ where: { id: space.id }, data: { revision: { increment: 1 } } });
      return run(tx, space.id);
    },
    { timeout: 60000 },
  );
}
export async function saveViewpoint(
  ownerId: string,
  input: z.infer<typeof viewpointInput>,
  viewpointId?: string,
  revision?: number,
) {
  return transaction(ownerId, async (tx, spaceId) => {
    if (!viewpointId) return tx.diagramViewpoint.create({ data: { ...input, spaceId } });
    const changed = await tx.diagramViewpoint.updateMany({
      where: { id: viewpointId, spaceId, revision },
      data: { ...input, revision: { increment: 1 } },
    });
    if (!changed.count) reject(409, 'Ракурс изменён или удалён. Обновите список');
    return tx.diagramViewpoint.findUniqueOrThrow({ where: { id: viewpointId } });
  });
}
export async function deleteViewpoint(ownerId: string, id: string, revision: number) {
  return transaction(ownerId, async (tx, spaceId) => {
    if (await tx.diagram.count({ where: { viewpointId: id, modelSpaceId: spaceId } }))
      reject(409, 'В ракурсе есть диаграммы. Сначала смените их ракурс');
    if (!(await tx.diagramViewpoint.deleteMany({ where: { id, spaceId, revision } })).count)
      reject(409, 'Ракурс изменён или удалён. Обновите список');
    return { ok: true };
  });
}
export async function assignViewpoint(
  ownerId: string,
  id: string,
  viewpointId: string | null,
  revision: number,
) {
  return transaction(ownerId, async (tx, spaceId) => {
    const diagram = await tx.diagram.findFirst({ where: { id, modelSpaceId: spaceId } });
    if (!diagram) reject(404, 'Диаграмма не найдена');
    if (diagram.revision !== revision) reject(409, 'Диаграмма изменена. Сначала обновите данные');
    if (
      viewpointId &&
      !(await tx.diagramViewpoint.findFirst({ where: { id: viewpointId, spaceId } }))
    )
      reject(404, 'Ракурс не найден');
    const links = await tx.diagramContextLink.findMany({
      where: {
        spaceId,
        kind: 'decomposition',
        sourceDiagramId: { not: null },
        OR: [{ sourceDiagramId: id }, { targetDiagramId: id }],
      },
      include: { sourceDiagram: true, targetDiagram: true },
    });
    if (
      links.some(
        (link) =>
          (link.sourceDiagramId === id
            ? link.targetDiagram.viewpointId
            : link.sourceDiagram!.viewpointId) !== viewpointId,
      )
    )
      reject(409, 'Смена ракурса нарушит декомпозицию. Сначала удалите или перенастройте переход');
    if (diagram.viewpointId === viewpointId) return diagram;
    await tx.diagramRevision.create({
      data: {
        diagramId: id,
        number: revision + 1,
        document: diagram.document as Prisma.InputJsonValue,
        reason: 'viewpoint',
      },
    });
    return tx.diagram.update({ where: { id }, data: { viewpointId, revision: { increment: 1 } } });
  });
}
export async function createContextLink(ownerId: string, input: z.infer<typeof contextLinkInput>) {
  return transaction(ownerId, async (tx, spaceId) => {
    const object = await tx.modelObject.findFirst({
      where: { id: input.entityId, spaceId, archived: false },
    });
    const relation = object
      ? null
      : await tx.modelRelation.findFirst({
          where: { id: input.entityId, spaceId, archived: false },
        });
    const entity = object ?? relation;
    if (!entity) reject(404, 'Активный объект не найден');
    const source = input.sourceDiagramId
      ? await tx.diagram.findFirst({
          where: { id: input.sourceDiagramId, modelSpaceId: spaceId },
        })
      : null;
    if (input.sourceDiagramId && !source) reject(404, 'Исходная диаграмма не найдена');
    let target = input.targetDiagramId
      ? await tx.diagram.findFirst({
          where: { id: input.targetDiagramId, modelSpaceId: spaceId },
        })
      : null;
    if (input.newDiagram) {
      if (
        input.kind === 'decomposition' &&
        source &&
        source.viewpointId !== input.newDiagram.viewpointId
      )
        reject(400, 'Декомпозиция сохраняет ракурс исходной диаграммы');
      target = await newDiagramInTransaction(
        tx,
        ownerId,
        { id: spaceId },
        {
          name: input.newDiagram.name,
          viewpointId: input.newDiagram.viewpointId,
          parentId: input.kind === 'decomposition' ? entity.id : entity.parentId,
        },
      );
    }
    if (!target) reject(404, 'Целевая диаграмма не найдена');
    if (source?.id === target.id) reject(400, 'Выберите другую диаграмму');
    if (input.kind === 'decomposition' && source && source.viewpointId !== target.viewpointId)
      reject(400, 'Декомпозиция сохраняет ракурс исходной диаграммы');
    if (
      await tx.diagramContextLink.findFirst({
        where: {
          spaceId,
          entityId: entity.id,
          sourceDiagramId: source?.id ?? null,
          targetDiagramId: target.id,
          kind: input.kind,
        },
      })
    )
      reject(409, 'Этот переход уже существует');
    if (input.kind === 'decomposition' && source) {
      const links = await tx.diagramContextLink.findMany({
        where: { spaceId, entityId: entity.id, kind: 'decomposition' },
      });
      const pending = [target.id],
        seen = new Set<string>();
      while (pending.length) {
        const id = pending.pop()!;
        if (id === source.id) reject(400, 'Декомпозиция не может образовывать цикл');
        if (seen.has(id)) continue;
        seen.add(id);
        pending.push(
          ...links.filter((l) => l.sourceDiagramId === id).map((l) => l.targetDiagramId),
        );
      }
    }
    if (!target.entityId) reject(409, 'Диаграмма не связана с объектной моделью');
    const type = input.kind === 'decomposition' ? 'Декомпозиция' : 'Углубление';
    const binding = await createRelation(tx, spaceId, {
      sourceId: entity.id,
      targetId: target.entityId,
      name: `${type}: ${target.name}`.slice(0, 100),
      relationType: type,
      description: input.meaning,
    });
    return tx.diagramContextLink.create({
      data: {
        id: binding.id,
        spaceId,
        entityId: entity.id,
        sourceDiagramId: source?.id ?? null,
        targetDiagramId: target.id,
        kind: input.kind,
        meaning: input.meaning,
      },
    });
  });
}
export async function updateContextLink(
  ownerId: string,
  id: string,
  revision: number,
  meaning?: string,
) {
  return transaction(ownerId, async (tx, spaceId) => {
    const link = await tx.diagramContextLink.findFirst({ where: { id, spaceId } });
    if (!link || link.revision !== revision)
      reject(409, 'Переход изменён или удалён. Обновите список');
    if (meaning === undefined) {
      const relation = await tx.modelRelation.findUniqueOrThrow({ where: { id } });
      return deleteRelationInTransaction(tx, spaceId, id, { revision: relation.revision });
    }
    if (
      !(
        await tx.diagramContextLink.updateMany({
          where: { id, spaceId, revision },
          data: { meaning, revision: { increment: 1 } },
        })
      ).count
    )
      reject(409, 'Переход изменён или удалён. Обновите список');
    const relation = await tx.modelRelation.update({
      where: { id },
      data: { description: meaning, revision: { increment: 1 } },
    });
    await recordRelation(tx, relation);
    return tx.diagramContextLink.findUniqueOrThrow({ where: { id } });
  });
}
