-- AlterTable Product: price sheet effective dates
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "effectiveFrom" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "effectiveTo" TEXT;

-- Capacity periods with effective dates
CREATE TABLE IF NOT EXISTS "CapacityPeriod" (
    "id" SERIAL NOT NULL,
    "effectiveFrom" TEXT NOT NULL,
    "effectiveTo" TEXT,
    "label" TEXT,
    "productionLines" INTEGER NOT NULL DEFAULT 2,
    "m2PerLinePerDay" DOUBLE PRECISION NOT NULL DEFAULT 3000,
    "m2PerContainer" DOUBLE PRECISION NOT NULL DEFAULT 8300,
    "workingDaysPerMonth" INTEGER NOT NULL DEFAULT 26,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CapacityPeriod_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CapacityPeriod_effectiveFrom_idx" ON "CapacityPeriod"("effectiveFrom");

-- Seed one open-ended period from current AppConfig (if any capacity rows exist and periods empty)
INSERT INTO "CapacityPeriod" (
  "effectiveFrom", "effectiveTo", "label",
  "productionLines", "m2PerLinePerDay", "m2PerContainer", "workingDaysPerMonth",
  "createdAt", "updatedAt"
)
SELECT
  '2020-01-01',
  NULL,
  'Default',
  COALESCE("productionLines", 2),
  COALESCE("m2PerLinePerDay", 3000),
  COALESCE("m2PerContainer", 8300),
  COALESCE("workingDaysPerMonth", 26),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "AppConfig"
WHERE "id" = 1
  AND NOT EXISTS (SELECT 1 FROM "CapacityPeriod" LIMIT 1);
