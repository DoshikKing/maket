-- A context transition is a specialization of a model relation, sharing its identity.
-- Preserve existing transition IDs, URLs and revisions when adding model bindings.
INSERT INTO "ModelRelation" (
  "id", "spaceId", "sourceId", "targetId", "name", "relationType", "description",
  "attributes", "archived", "revision", "createdAt", "updatedAt"
)
SELECT l."id", l."spaceId", l."entityId", d."entityId",
  LEFT((CASE WHEN l."kind" = 'decomposition' THEN 'Декомпозиция' ELSE 'Углубление' END) || ': ' || d."name", 100),
  CASE WHEN l."kind" = 'decomposition' THEN 'Декомпозиция' ELSE 'Углубление' END,
  l."meaning", '{}'::jsonb, FALSE, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "DiagramContextLink" l JOIN "Diagram" d ON d."id" = l."targetDiagramId";

INSERT INTO "ModelRelationRevision" ("id", "relationId", "number", "snapshot", "createdAt")
SELECT r."id" || ':initial', r."id", 1,
  jsonb_build_object(
    'id', r."id", 'sourceId', r."sourceId", 'targetId', r."targetId", 'parentId', r."parentId",
    'name', r."name", 'relationType', r."relationType", 'description', r."description",
    'attributes', r."attributes", 'archived', r."archived", 'revision', r."revision",
    'incarnation', to_char(r."createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ), CURRENT_TIMESTAMP
FROM "ModelRelation" r JOIN "DiagramContextLink" l ON l."id" = r."id";

ALTER TABLE "DiagramContextLink" ADD CONSTRAINT "DiagramContextLink_id_fkey"
  FOREIGN KEY ("id") REFERENCES "ModelRelation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
