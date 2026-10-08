ALTER TABLE "Diagram" ADD COLUMN "shareEnabled" BOOLEAN NOT NULL DEFAULT false;
UPDATE "Diagram" SET "shareEnabled" = true WHERE "shareToken" IS NOT NULL;
