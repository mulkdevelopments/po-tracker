-- Add BL stage after CI approved (BOL / shipping line / tracking link).

UPDATE "ProcessStage" SET "order" = "order" + 1000;

UPDATE "ProcessStage" SET "order" = 1015 WHERE name = 'PO Cancelled';
UPDATE "ProcessStage" SET "order" = 1014 WHERE name = 'PO Revised';
UPDATE "ProcessStage" SET "order" = 1013 WHERE name = 'Arrived';
UPDATE "ProcessStage" SET "order" = 1012 WHERE name = 'Telex / Seaway Released';
UPDATE "ProcessStage" SET "order" = 1011 WHERE name = 'Balance Payment Received';

INSERT INTO "ProcessStage" ("order", "name")
VALUES (1010, 'BL')
ON CONFLICT ("name") DO UPDATE SET "order" = 1010;

UPDATE "ProcessStage" SET "order" = 1 WHERE name = 'PO Received';
UPDATE "ProcessStage" SET "order" = 2 WHERE name = 'PI Generated';
UPDATE "ProcessStage" SET "order" = 3 WHERE name = 'PI Approved';
UPDATE "ProcessStage" SET "order" = 4 WHERE name = 'Downpayment Received';
UPDATE "ProcessStage" SET "order" = 5 WHERE name = 'In Production';
UPDATE "ProcessStage" SET "order" = 6 WHERE name = 'Production Complete';
UPDATE "ProcessStage" SET "order" = 7 WHERE name = 'Container Loaded';
UPDATE "ProcessStage" SET "order" = 8 WHERE name = 'CI sent';
UPDATE "ProcessStage" SET "order" = 9 WHERE name = 'CI approved';
UPDATE "ProcessStage" SET "order" = 10 WHERE name = 'BL';
UPDATE "ProcessStage" SET "order" = 11 WHERE name = 'Balance Payment Received';
UPDATE "ProcessStage" SET "order" = 12 WHERE name = 'Telex / Seaway Released';
UPDATE "ProcessStage" SET "order" = 13 WHERE name = 'Arrived';
UPDATE "ProcessStage" SET "order" = 14 WHERE name = 'PO Revised';
UPDATE "ProcessStage" SET "order" = 15 WHERE name = 'PO Cancelled';
