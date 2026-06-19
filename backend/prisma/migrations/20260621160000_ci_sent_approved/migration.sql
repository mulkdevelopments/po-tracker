-- Rename Commercial Invoice Sent → CI sent, add CI approved stage and rejection fields.

ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "ciApprovedDate" TEXT;
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "ciRejectedNote" TEXT;
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "ciResubmitCount" INTEGER NOT NULL DEFAULT 0;

UPDATE "PurchaseOrder" SET status = 'CI sent' WHERE status = 'Commercial Invoice Sent';
UPDATE "PoHistory" SET stage = 'CI sent' WHERE stage = 'Commercial Invoice Sent';

UPDATE "ProcessStage" SET name = 'CI sent' WHERE name = 'Commercial Invoice Sent';

UPDATE "ProcessStage" SET "order" = "order" + 1000;

UPDATE "ProcessStage" SET "order" = 1014 WHERE name = 'PO Cancelled';
UPDATE "ProcessStage" SET "order" = 1013 WHERE name = 'PO Revised';
UPDATE "ProcessStage" SET "order" = 1012 WHERE name = 'Arrived';
UPDATE "ProcessStage" SET "order" = 1011 WHERE name = 'Telex / Seaway Released';
UPDATE "ProcessStage" SET "order" = 1010 WHERE name = 'Balance Payment Received';

INSERT INTO "ProcessStage" ("order", "name")
VALUES (1009, 'CI approved')
ON CONFLICT ("name") DO UPDATE SET "order" = 1009;

UPDATE "ProcessStage" SET "order" = 1 WHERE name = 'PO Received';
UPDATE "ProcessStage" SET "order" = 2 WHERE name = 'PI Generated';
UPDATE "ProcessStage" SET "order" = 3 WHERE name = 'PI Approved';
UPDATE "ProcessStage" SET "order" = 4 WHERE name = 'Downpayment Received';
UPDATE "ProcessStage" SET "order" = 5 WHERE name = 'In Production';
UPDATE "ProcessStage" SET "order" = 6 WHERE name = 'Production Complete';
UPDATE "ProcessStage" SET "order" = 7 WHERE name = 'Container Loaded';
UPDATE "ProcessStage" SET "order" = 8 WHERE name = 'CI sent';
UPDATE "ProcessStage" SET "order" = 9 WHERE name = 'CI approved';
UPDATE "ProcessStage" SET "order" = 10 WHERE name = 'Balance Payment Received';
UPDATE "ProcessStage" SET "order" = 11 WHERE name = 'Telex / Seaway Released';
UPDATE "ProcessStage" SET "order" = 12 WHERE name = 'Arrived';
UPDATE "ProcessStage" SET "order" = 13 WHERE name = 'PO Revised';
UPDATE "ProcessStage" SET "order" = 14 WHERE name = 'PO Cancelled';
