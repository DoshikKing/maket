import { db } from './db';
import { relationSnapshot } from './relation-service';
import { workspaceScope } from './workspace-scope';
import { getDiagram, snapshot } from './model-service';
import { modelDiagramSchema, resolveInheritance } from './model';
// Capability links disclose only this diagram's model closure, never the owner's model catalog.
export async function publicDiagram(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const row = await db.diagram.findUnique({
    where: { shareToken: token, shareEnabled: true },
    select: { id: true, ownerId: true, modelSpaceId: true },
  });
  if (!row) return null;
  const diagram = await workspaceScope.run(row.modelSpaceId ?? undefined, () =>
    getDiagram(row.ownerId, row.id),
  );
  const document = modelDiagramSchema.parse(diagram.document);
  // Check again after loading, so a concurrently revoked link cannot return a document.
  if (!(await db.diagram.count({ where: { id: row.id, shareToken: token, shareEnabled: true } })))
    return null;
  const clean = <T extends { copiedFrom?: unknown; incarnation?: unknown }>(entity: T) => {
    const { copiedFrom, incarnation, ...rest } = entity;
    return rest;
  };
  return {
    name: diagram.name,
    revision: diagram.revision,
    document: {
      ...document,
      modelSpaceId: 'public',
      objects: document.objects.map(clean),
      relations: document.relations?.map(clean),
      bindings: document.bindings.map((b) => ({ ...b, versionId: null })),
    },
  };
}

// Disclose only the selected object's properties; never its workspace, tree or link catalog.
export async function publicObject(id: string, token: string) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id) || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const row = await db.modelObject.findFirst({
    where: { id, shareToken: token, shareEnabled: true },
  });
  if (!row) return null;
  const [objects, relations] = await Promise.all([
    db.modelObject.findMany({ where: { spaceId: row.spaceId } }),
    db.modelRelation.findMany({ where: { spaceId: row.spaceId } }),
  ]);
  const object = resolveInheritance(objects.map(snapshot), relations.map(relationSnapshot)).find(
    (o) => o.id === id,
  );
  // Recheck revocation and token rotation after resolving inherited properties.
  if (
    !object ||
    !(await db.modelObject.count({ where: { id, shareToken: token, shareEnabled: true } }))
  )
    return null;
  return {
    id: object.id,
    name: object.name,
    kind: object.kind ?? 'object',
    description: object.description,
    archived: object.archived,
    revision: object.revision,
    derivation: object.derivation ?? null,
    attributes: { ...object.inheritedAttributes, ...object.attributes },
    ownAttributes: object.attributes,
    inheritedAttributes: object.inheritedAttributes ?? {},
  };
}
export type PublicObject = NonNullable<Awaited<ReturnType<typeof publicObject>>>;
