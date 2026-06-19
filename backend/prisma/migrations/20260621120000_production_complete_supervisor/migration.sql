-- Add Supervisor role and Production Complete workflow stage.

ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'SUPERVISOR';

UPDATE "ProcessStage" SET "order" = "order" + 1000;

UPDATE "ProcessStage" SET "order" = 1012 WHERE name = 'PO Cancelled';
UPDATE "ProcessStage" SET "order" = 1011 WHERE name = 'PO Revised';
UPDATE "ProcessStage" SET "order" = 1010 WHERE name = 'Telex / Seaway Released';
UPDATE "ProcessStage" SET "order" = 1009 WHERE name = 'Balance Payment Received';
UPDATE "ProcessStage" SET "order" = 1008 WHERE name = 'Commercial Invoice Sent';
UPDATE "ProcessStage" SET "order" = 1007 WHERE name = 'Container Loaded';

INSERT INTO "ProcessStage" ("order", "name")
VALUES (1006, 'Production Complete')
ON CONFLICT ("name") DO UPDATE SET "order" = 1006;

UPDATE "ProcessStage" SET "order" = 1 WHERE name = 'PO Received';
UPDATE "ProcessStage" SET "order" = 2 WHERE name = 'PI Generated';
UPDATE "ProcessStage" SET "order" = 3 WHERE name = 'PI Approved';
UPDATE "ProcessStage" SET "order" = 4 WHERE name = 'Downpayment Received';
UPDATE "ProcessStage" SET "order" = 5 WHERE name = 'In Production';
UPDATE "ProcessStage" SET "order" = 6 WHERE name = 'Production Complete';
UPDATE "ProcessStage" SET "order" = 7 WHERE name = 'Container Loaded';
UPDATE "ProcessStage" SET "order" = 8 WHERE name = 'Commercial Invoice Sent';
UPDATE "ProcessStage" SET "order" = 9 WHERE name = 'Balance Payment Received';
UPDATE "ProcessStage" SET "order" = 10 WHERE name = 'Telex / Seaway Released';
UPDATE "ProcessStage" SET "order" = 11 WHERE name = 'PO Revised';
UPDATE "ProcessStage" SET "order" = 12 WHERE name = 'PO Cancelled';
