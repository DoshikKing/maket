-- Preserve the existing model as the first area; newly created areas start empty.
ALTER TABLE "ModelSpace" DROP CONSTRAINT IF EXISTS "ModelSpace_ownerId_key";
DROP INDEX IF EXISTS "ModelSpace_ownerId_key";
ALTER TABLE "ModelSpace" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX "ModelSpace_ownerId_createdAt_idx" ON "ModelSpace"("ownerId", "createdAt");
CREATE INDEX "Diagram_modelSpaceId_updatedAt_idx" ON "Diagram"("modelSpaceId", "updatedAt");
