ALTER TABLE "ModelObject" ADD COLUMN "shareToken" TEXT;
ALTER TABLE "ModelObject" ADD COLUMN "shareEnabled" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "ModelObject_shareToken_key" ON "ModelObject"("shareToken");
