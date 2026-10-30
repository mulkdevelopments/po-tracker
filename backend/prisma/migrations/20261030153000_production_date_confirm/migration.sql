-- Tentative vs correct production dates. Dates already on an order count as correct.
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "productionBeginConfirmed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "productionCompleteConfirmed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "dispatchConfirmed" BOOLEAN NOT NULL DEFAULT false;

UPDATE "PurchaseOrder"
SET "productionBeginConfirmed" = true
WHERE "productionBegin" IS NOT NULL AND btrim("productionBegin") <> '';

UPDATE "PurchaseOrder"
SET "productionCompleteConfirmed" = true
WHERE "productionComplete" IS NOT NULL AND btrim("productionComplete") <> '';

UPDATE "PurchaseOrder"
SET "dispatchConfirmed" = true
WHERE "dispatchFromFactory" IS NOT NULL AND btrim("dispatchFromFactory") <> '';
