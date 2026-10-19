ALTER TABLE "WorkspaceLock" ADD COLUMN "leaseId" TEXT;
UPDATE "WorkspaceLock" SET "leaseId" = "clientId";
ALTER TABLE "WorkspaceLock" ALTER COLUMN "leaseId" SET NOT NULL;
