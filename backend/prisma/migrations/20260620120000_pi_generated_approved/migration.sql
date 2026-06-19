-- Rename Proforma Invoice Sent → PI Generated, add PI Approved stage.

ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "piApprovedDate" TEXT;

UPDATE "PurchaseOrder" SET status = 'PI Generated' WHERE status = 'Proforma Invoice Sent';
UPDATE "PoHistory" SET stage = 'PI Generated' WHERE stage = 'Proforma Invoice Sent';

UPDATE "ProcessStage" SET name = 'PI Generated' WHERE name = 'Proforma Invoice Sent';
UPDATE "ProcessStage" SET "order" = "order" + 100 WHERE "order" >= 3;
UPDATE "ProcessStage" SET "order" = "order" - 99 WHERE "order" >= 100;
INSERT INTO "ProcessStage" ("order", name) VALUES (3, 'PI Approved')
ON CONFLICT ("order") DO UPDATE SET name = EXCLUDED.name;
