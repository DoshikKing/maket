CREATE TABLE "ModelSpace" (
  "id" TEXT PRIMARY KEY, "ownerId" TEXT NOT NULL UNIQUE REFERENCES "User"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL DEFAULT 'Личная модель', "revision" INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE "ModelObject" (
  "id" TEXT PRIMARY KEY, "spaceId" TEXT NOT NULL REFERENCES "ModelSpace"("id") ON DELETE CASCADE,
  "parentId" TEXT, "name" TEXT NOT NULL, "description" TEXT NOT NULL DEFAULT '',
  "attributes" JSONB NOT NULL DEFAULT '{}', "archived" BOOLEAN NOT NULL DEFAULT FALSE,
  "revision" INTEGER NOT NULL DEFAULT 1, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("spaceId", "id"),
  FOREIGN KEY ("spaceId", "parentId") REFERENCES "ModelObject"("spaceId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION
);
CREATE INDEX "ModelObject_spaceId_parentId_idx" ON "ModelObject"("spaceId", "parentId");
CREATE TABLE "ModelObjectRevision" (
  "id" TEXT PRIMARY KEY, "objectId" TEXT NOT NULL REFERENCES "ModelObject"("id") ON DELETE CASCADE,
  "number" INTEGER NOT NULL, "snapshot" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("objectId", "number")
);
ALTER TABLE "Diagram" ADD COLUMN "modelSpaceId" TEXT REFERENCES "ModelSpace"("id") ON DELETE CASCADE;
CREATE TABLE "DiagramObjectUsage" (
  "diagramId" TEXT NOT NULL REFERENCES "Diagram"("id") ON DELETE CASCADE,
  "objectId" TEXT NOT NULL REFERENCES "ModelObject"("id") ON DELETE CASCADE,
  "count" INTEGER NOT NULL CHECK ("count" > 0), PRIMARY KEY ("diagramId", "objectId")
);
CREATE INDEX "DiagramObjectUsage_objectId_idx" ON "DiagramObjectUsage"("objectId");
CREATE TABLE "DiagramNotation" (
  "diagramId" TEXT NOT NULL REFERENCES "Diagram"("id") ON DELETE CASCADE, "bindingId" TEXT NOT NULL,
  "versionId" TEXT REFERENCES "NotationVersion"("id") ON DELETE RESTRICT,
  PRIMARY KEY ("diagramId", "bindingId")
);
