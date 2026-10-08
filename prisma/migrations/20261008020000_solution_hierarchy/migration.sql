ALTER TABLE "ModelObject" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'object';
ALTER TABLE "ModelObject" ADD CONSTRAINT "ModelObject_kind_check" CHECK ("kind" IN ('solution', 'project', 'folder', 'diagram', 'object'));
ALTER TABLE "Diagram" ADD COLUMN "entityId" TEXT;
CREATE UNIQUE INDEX "Diagram_entityId_key" ON "Diagram"("entityId");
-- Existing diagrams become root entries; no invented solutions or projects.
INSERT INTO "ModelObject" ("id", "spaceId", "kind", "name", "description", "attributes", "archived", "revision", "createdAt", "updatedAt")
SELECT 'diagram_' || d."id", d."modelSpaceId", 'diagram', d."name", '', '{}', false, 1, d."createdAt", d."updatedAt"
FROM "Diagram" d WHERE d."modelSpaceId" IS NOT NULL;
UPDATE "Diagram" SET "entityId" = 'diagram_' || "id" WHERE "modelSpaceId" IS NOT NULL;
INSERT INTO "ModelObjectRevision" ("id", "objectId", "number", "snapshot", "createdAt")
SELECT 'hierarchy_' || o."id", o."id", 1,
jsonb_build_object('id', o."id", 'kind', o."kind", 'parentId', NULL, 'name', o."name", 'description', '', 'attributes', '{}'::jsonb, 'archived', false, 'revision', 1), o."createdAt"
FROM "ModelObject" o WHERE o."kind" = 'diagram';
ALTER TABLE "Diagram" ADD CONSTRAINT "Diagram_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "ModelObject"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
