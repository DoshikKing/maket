ALTER TABLE "ModelSpace" ADD COLUMN "collaborationRevision" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "WorkspaceMember" (
 "spaceId" TEXT NOT NULL REFERENCES "ModelSpace"("id") ON DELETE CASCADE,
 "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
 "role" TEXT NOT NULL DEFAULT 'viewer', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("spaceId", "userId")
);
CREATE INDEX "WorkspaceMember_userId_idx" ON "WorkspaceMember"("userId");
CREATE TABLE "WorkspaceRole" (
 "id" TEXT PRIMARY KEY, "spaceId" TEXT NOT NULL REFERENCES "ModelSpace"("id") ON DELETE CASCADE,
 "name" TEXT NOT NULL, "actions" JSONB NOT NULL, "elementIds" JSONB NOT NULL DEFAULT '[]', "revision" INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX "WorkspaceRole_spaceId_idx" ON "WorkspaceRole"("spaceId");
CREATE TABLE "WorkspaceLock" (
 "spaceId" TEXT NOT NULL REFERENCES "ModelSpace"("id") ON DELETE CASCADE, "targetId" TEXT NOT NULL,
 "userId" TEXT NOT NULL, "clientId" TEXT NOT NULL, "userName" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL,
 PRIMARY KEY ("spaceId", "targetId")
);
CREATE INDEX "WorkspaceLock_expiresAt_idx" ON "WorkspaceLock"("expiresAt");
CREATE TABLE "WorkspaceEvent" (
 "id" TEXT PRIMARY KEY, "spaceId" TEXT NOT NULL REFERENCES "ModelSpace"("id") ON DELETE CASCADE,
 "userId" TEXT NOT NULL, "userName" TEXT NOT NULL, "action" TEXT NOT NULL, "targetId" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "WorkspaceEvent_spaceId_createdAt_idx" ON "WorkspaceEvent"("spaceId", "createdAt");
