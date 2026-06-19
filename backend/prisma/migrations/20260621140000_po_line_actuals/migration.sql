-- Separate production actuals from ordered line quantities (reference only).

ALTER TABLE "PoLine" ADD COLUMN IF NOT EXISTS "actualQtyM2" DOUBLE PRECISION;
ALTER TABLE "PoLine" ADD COLUMN IF NOT EXISTS "actualSheets" DOUBLE PRECISION;
ALTER TABLE "PoLine" ADD COLUMN IF NOT EXISTS "actualSkids" DOUBLE PRECISION;
ALTER TABLE "PoLine" ADD COLUMN IF NOT EXISTS "actualNotes" TEXT;
