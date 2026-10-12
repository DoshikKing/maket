CREATE TABLE "DiagramViewpoint" (
 "id" TEXT PRIMARY KEY, "spaceId" TEXT NOT NULL REFERENCES "ModelSpace"("id") ON DELETE CASCADE,
 "name" TEXT NOT NULL, "description" TEXT NOT NULL DEFAULT '', "order" INTEGER NOT NULL DEFAULT 0, "revision" INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX "DiagramViewpoint_spaceId_name_key" ON "DiagramViewpoint"("spaceId", "name");
CREATE INDEX "DiagramViewpoint_spaceId_order_idx" ON "DiagramViewpoint"("spaceId", "order");
ALTER TABLE "Diagram" ADD COLUMN "viewpointId" TEXT REFERENCES "DiagramViewpoint"("id") ON DELETE RESTRICT;
CREATE TABLE "DiagramContextLink" (
 "id" TEXT PRIMARY KEY, "spaceId" TEXT NOT NULL REFERENCES "ModelSpace"("id") ON DELETE CASCADE,
 "entityId" TEXT NOT NULL, "sourceDiagramId" TEXT REFERENCES "Diagram"("id") ON DELETE CASCADE,
 "targetDiagramId" TEXT NOT NULL REFERENCES "Diagram"("id") ON DELETE CASCADE,
 "kind" TEXT NOT NULL CHECK ("kind" IN ('decomposition', 'viewpoint')),
 "meaning" TEXT NOT NULL DEFAULT '', "revision" INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX "DiagramContextLink_entityId_sourceDiagramId_targetDiagramId_kind_key" ON "DiagramContextLink"("entityId", "sourceDiagramId", "targetDiagramId", "kind");
CREATE INDEX "DiagramContextLink_spaceId_entityId_idx" ON "DiagramContextLink"("spaceId", "entityId");
