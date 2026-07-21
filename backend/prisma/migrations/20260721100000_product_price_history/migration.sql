-- Versioned product prices
CREATE TABLE IF NOT EXISTS "ProductPrice" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "pricePerSqft" DOUBLE PRECISION,
    "pricePerM2" DOUBLE PRECISION,
    "pricePerMsq" DOUBLE PRECISION,
    "pricePerSheet" DOUBLE PRECISION,
    "leadTimeDays" INTEGER,
    "effectiveFrom" TEXT NOT NULL,
    "effectiveTo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductPrice_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ProductPrice_productId_effectiveFrom_idx"
  ON "ProductPrice"("productId", "effectiveFrom");

ALTER TABLE "ProductPrice"
  DROP CONSTRAINT IF EXISTS "ProductPrice_productId_fkey";
ALTER TABLE "ProductPrice"
  ADD CONSTRAINT "ProductPrice_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Migrate existing product prices into open-ended history rows
INSERT INTO "ProductPrice" (
  "productId", "pricePerSqft", "pricePerM2", "pricePerMsq", "pricePerSheet",
  "leadTimeDays", "effectiveFrom", "effectiveTo", "createdAt"
)
SELECT
  p."id",
  p."pricePerSqft",
  p."pricePerM2",
  p."pricePerMsq",
  p."pricePerSheet",
  p."leadTimeDays",
  COALESCE(NULLIF(p."effectiveFrom", ''), '2020-01-01'),
  NULLIF(p."effectiveTo", ''),
  CURRENT_TIMESTAMP
FROM "Product" p
WHERE NOT EXISTS (
  SELECT 1 FROM "ProductPrice" pp WHERE pp."productId" = p."id"
)
AND (
  p."pricePerSqft" IS NOT NULL
  OR p."pricePerM2" IS NOT NULL
  OR p."pricePerMsq" IS NOT NULL
  OR p."pricePerSheet" IS NOT NULL
);

-- Stamp on PO lines for audit / reference
ALTER TABLE "PoLine" ADD COLUMN IF NOT EXISTS "priceAsOf" TEXT;
ALTER TABLE "PoLine" ADD COLUMN IF NOT EXISTS "priceEffectiveFrom" TEXT;
