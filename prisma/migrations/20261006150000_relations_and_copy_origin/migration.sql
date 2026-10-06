ALTER TABLE "ModelObject" ADD COLUMN "copiedFrom" JSONB;
CREATE TABLE "ModelRelation" (
 "id" TEXT PRIMARY KEY, "spaceId" TEXT NOT NULL, "sourceId" TEXT NOT NULL, "targetId" TEXT NOT NULL,
 "name" TEXT NOT NULL, "description" TEXT NOT NULL DEFAULT '', "attributes" JSONB NOT NULL DEFAULT '{}',
 "copiedFrom" JSONB, "archived" BOOLEAN NOT NULL DEFAULT false, "revision" INTEGER NOT NULL DEFAULT 1,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "ModelRelation_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "ModelSpace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "ModelRelation_source_fkey" FOREIGN KEY ("spaceId","sourceId") REFERENCES "ModelObject"("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "ModelRelation_target_fkey" FOREIGN KEY ("spaceId","targetId") REFERENCES "ModelObject"("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION
);
CREATE UNIQUE INDEX "ModelRelation_spaceId_id_key" ON "ModelRelation"("spaceId","id");
CREATE INDEX "ModelRelation_spaceId_sourceId_idx" ON "ModelRelation"("spaceId","sourceId");
CREATE INDEX "ModelRelation_spaceId_targetId_idx" ON "ModelRelation"("spaceId","targetId");
CREATE TABLE "ModelRelationRevision" (
 "id" TEXT PRIMARY KEY, "relationId" TEXT NOT NULL, "number" INTEGER NOT NULL, "snapshot" JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ModelRelationRevision_relationId_fkey" FOREIGN KEY ("relationId") REFERENCES "ModelRelation"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ModelRelationRevision_relationId_number_key" ON "ModelRelationRevision"("relationId","number");
CREATE TABLE "DiagramRelationUsage" (
 "diagramId" TEXT NOT NULL, "relationId" TEXT NOT NULL, "count" INTEGER NOT NULL,
 PRIMARY KEY ("diagramId","relationId"),
 CONSTRAINT "DiagramRelationUsage_diagramId_fkey" FOREIGN KEY ("diagramId") REFERENCES "Diagram"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "DiagramRelationUsage_relationId_fkey" FOREIGN KEY ("relationId") REFERENCES "ModelRelation"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "DiagramRelationUsage_relationId_idx" ON "DiagramRelationUsage"("relationId");
