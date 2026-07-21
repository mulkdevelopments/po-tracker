-- Production schedule sequence for drag-and-drop / auto-calc ordering
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "productionSequence" INTEGER;

-- Backfill spaced sequence for POs that already have production schedule fields
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY company
      ORDER BY
        CASE WHEN priority = 'High' THEN 0 ELSE 1 END,
        COALESCE("allMaterialAvailable", '9999-12-31'),
        id
    ) AS rn
  FROM "PurchaseOrder"
  WHERE "productionSequence" IS NULL
    AND (
      "soNo" IS NOT NULL
      OR "productionStatus" IS NOT NULL
      OR "productionBegin" IS NOT NULL
      OR "productionComplete" IS NOT NULL
      OR "allMaterialAvailable" IS NOT NULL
      OR "productionStart" IS NOT NULL
    )
)
UPDATE "PurchaseOrder" po
SET "productionSequence" = ranked.rn * 10
FROM ranked
WHERE po.id = ranked.id;
