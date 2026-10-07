-- Parent and endpoint IDs can now refer to either kind of model entity.
-- Ownership, hierarchy and deletion are checked under the ModelSpace write lock.
ALTER TABLE "ModelObject" DROP CONSTRAINT "ModelObject_spaceId_parentId_fkey";
ALTER TABLE "ModelRelation" DROP CONSTRAINT "ModelRelation_source_fkey";
ALTER TABLE "ModelRelation" DROP CONSTRAINT "ModelRelation_target_fkey";
ALTER TABLE "ModelRelation" ADD COLUMN "parentId" TEXT;
CREATE INDEX "ModelRelation_spaceId_parentId_idx" ON "ModelRelation"("spaceId", "parentId");
