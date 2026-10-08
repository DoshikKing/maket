import { db } from './db';
import { getDiagram } from './model-service';
import { modelDiagramSchema } from './model';
// Capability links disclose only this diagram's model closure, never the owner's model catalog.
export async function publicDiagram(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const row = await db.diagram.findUnique({
    where: { shareToken: token },
    select: { id: true, ownerId: true },
  });
  if (!row) return null;
  const diagram = await getDiagram(row.ownerId, row.id);
  const document = modelDiagramSchema.parse(diagram.document);
  // Check again after loading, so a concurrently revoked link cannot return a document.
  if (!(await db.diagram.count({ where: { id: row.id, shareToken: token } }))) return null;
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
