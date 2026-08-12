-- Cynergy prices per sheet, UFP per MSF. The Cynergy import previously stored its sheet
-- rate in "unitMsf", which made Qty (MSF) x Unit (MSF) meaningless (request log #1).
ALTER TABLE "PoLine" ADD COLUMN IF NOT EXISTS "unitSheet" DOUBLE PRECISION;
