ALTER TABLE "Diagram" ADD COLUMN "shareToken" TEXT;
CREATE UNIQUE INDEX "Diagram_shareToken_key" ON "Diagram"("shareToken");
