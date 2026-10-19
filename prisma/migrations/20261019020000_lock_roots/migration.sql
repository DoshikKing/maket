ALTER TABLE "WorkspaceLock" ADD COLUMN "rootId" TEXT;
UPDATE "WorkspaceLock" SET "rootId" = "targetId";
ALTER TABLE "WorkspaceLock" ALTER COLUMN "rootId" SET NOT NULL;
ALTER TABLE "WorkspaceLock" DROP CONSTRAINT "WorkspaceLock_pkey";
ALTER TABLE "WorkspaceLock" ADD CONSTRAINT "WorkspaceLock_pkey" PRIMARY KEY ("spaceId", "targetId", "rootId");
