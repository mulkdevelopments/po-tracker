-- CreateEnum
CREATE TYPE "Company" AS ENUM ('UFP', 'SYNERGY');

-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "company" "Company" NOT NULL DEFAULT 'UFP';

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PurchaseOrder_company_idx" ON "PurchaseOrder"("company");

-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "company" "Company";

UPDATE "AppSettings" SET "company" = 'UFP' WHERE "company" IS NULL;

ALTER TABLE "AppSettings" ALTER COLUMN "company" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "AppSettings_company_key" ON "AppSettings"("company");

INSERT INTO "AppSettings" ("id", "company", "master", "pricing", "updatedAt")
SELECT (SELECT COALESCE(MAX(id), 0) + 1 FROM "AppSettings"), 'SYNERGY', '{}'::jsonb, '{"headers":[],"rows":[]}'::jsonb, NOW()
FROM "AppSettings"
WHERE NOT EXISTS (SELECT 1 FROM "AppSettings" s WHERE s."company" = 'SYNERGY')
LIMIT 1;

SELECT setval(
  pg_get_serial_sequence('"AppSettings"', 'id'),
  (SELECT COALESCE(MAX(id), 1) FROM "AppSettings")
);
