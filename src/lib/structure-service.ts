import { db } from './db';
import { ensureModel } from './model-service';
import { reject } from './model-errors';
import { deleteRelationInTransaction } from './relation-service';
import {
  modelDiagramSchema,
  effectiveNode,
  effectiveEdge,
  projectDocument,
  displayedView,
} from './model';
import type { DiagramDocument } from './notation';
import { nodeLabel } from './appearance';
import type { Structure, Representation } from './structure';
export async function getStructure(
  ownerId: string,
  entityId?: string,
  allDiagramMetadata = false,
  includePreviews = false,
): Promise<Structure & { previews?: Record<string, DiagramDocument> }> {
  const space = await ensureModel(ownerId);
  if (
    allDiagramMetadata &&
    entityId &&
    !space.objects.some((o) => o.id === entityId) &&
    !space.relations.some((r) => r.id === entityId)
  )
    reject(404, 'Элемент не найден');
  const diagrams = await db.diagram.findMany({
    where: {
      ownerId,
      modelSpaceId: space.id,
      ...(entityId
        ? {
            OR: [
              { usages: { some: { objectId: entityId } } },
              { relationUsages: { some: { relationId: entityId } } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      entityId: true,
      name: true,
      document: true,
      viewpointId: true,
      revision: true,
    },
    orderBy: { updatedAt: 'desc' },
  });
  const objects = new Map(space.objects.map((o) => [o.id, o]));
  const relations = new Map(space.relations.map((r) => [r.id, r]));
  const representations: Representation[] = [];
  const previews: Record<string, DiagramDocument> = {};
  for (const d of diagrams) {
    const document = modelDiagramSchema.parse(d.document);
    if (includePreviews)
      previews[d.id] = displayedView(
        projectDocument({
          ...document,
          relations: document.relations?.map((r) => relations.get(r.id) ?? r),
        }),
        space.objects,
      );
    for (const n of document.nodes.filter((n) => !entityId || n.objectId === entityId)) {
      const binding = document.bindings.find((b) => b.id === n.bindingId)!;
      const object = objects.get(n.objectId);
      const type = binding.document.nodeTypes.find((t) => t.id === n.typeId)!;
      representations.push({
        id: n.id,
        entityId: n.objectId,
        diagramId: d.id,
        diagramName: d.name,
        notation: binding.document.name,
        type: type.name,
        name: nodeLabel(effectiveNode(n, type, object), type),
      });
    }
    for (const e of document.edges)
      if (e.relationId && (!entityId || e.relationId === entityId)) {
        const binding = document.bindings.find((b) => b.id === e.bindingId);
        const relation = relations.get(e.relationId);
        const type = binding?.document.edgeTypes.find((t) => t.id === e.typeId);
        const visible = type ? effectiveEdge(e, type, relation) : e;
        representations.push({
          id: e.id,
          entityId: e.relationId,
          diagramId: d.id,
          diagramName: d.name,
          notation: binding?.document.name ?? 'Универсальная связь',
          type: binding?.document.edgeTypes.find((t) => t.id === e.typeId)?.name ?? 'Связь',
          name: String(visible.properties.label || relation?.name || 'Связь'),
        });
      }
  }
  return {
    id: space.id,
    viewpoints: space.viewpoints,
    contextLinks: (await db.diagramContextLink.findMany({
      where: { spaceId: space.id, ...(entityId ? { entityId } : {}) },
    })) as Structure['contextLinks'],
    objects: space.objects,
    relations: space.relations,
    diagrams: allDiagramMetadata
      ? space.diagrams
      : diagrams.map(({ id, entityId, name, viewpointId, revision }) => ({
          id,
          entityId,
          name,
          viewpointId,
          revision,
        })),
    representations,
    ...(includePreviews ? { previews } : {}),
  };
}
export async function deleteDiagram(ownerId: string, id: string) {
  const space = await ensureModel(ownerId);
  return db.$transaction(async (tx) => {
    const d = await tx.diagram.findFirst({ where: { id, ownerId, modelSpaceId: space.id } });
    if (!d) reject(404, 'Диаграмма не найдена');
    if (d.modelSpaceId)
      await tx.modelSpace.update({
        where: { id: d.modelSpaceId },
        data: { revision: { increment: 1 } },
      });
    const transitions = await tx.diagramContextLink.findMany({
      where: { OR: [{ sourceDiagramId: id }, { targetDiagramId: id }] },
      include: { relation: true },
    });
    for (const link of transitions)
      await deleteRelationInTransaction(tx, link.spaceId, link.id, {
        revision: link.relation.revision,
      });
    if (d.entityId) {
      const children =
        (await tx.modelObject.count({ where: { parentId: d.entityId } })) +
        (await tx.modelRelation.count({ where: { parentId: d.entityId } }));
      if (children)
        reject(409, 'У диаграммы есть дочерние элементы. Сначала переместите или удалите их');
      if (
        await tx.modelRelation.count({
          where: { OR: [{ sourceId: d.entityId }, { targetId: d.entityId }] },
        })
      )
        reject(409, 'Диаграмма участвует в связях модели');
      if (await tx.diagramObjectUsage.count({ where: { objectId: d.entityId } }))
        reject(409, 'Диаграмма используется в представлениях');
    }
    if (d.entityId && (await tx.diagramContextLink.count({ where: { entityId: d.entityId } })))
      reject(409, 'У диаграммы есть декомпозиции или переходы к ракурсам. Сначала удалите их');
    await tx.diagram.delete({ where: { id } });
    if (d.entityId) await tx.modelObject.delete({ where: { id: d.entityId } });
    return { ok: true };
  });
}
