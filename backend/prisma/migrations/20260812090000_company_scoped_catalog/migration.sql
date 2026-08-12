-- Keep UFP and Cynergy data fully separate: every reference / master-data table
-- gains a company column, and uniqueness moves from (key) to (company, key).
--
-- This is required because Cynergy reuses UFP part numbers for different products
-- (1250mm vs 1245mm, ACM vs ACP, $7.50 vs $7.73/m2), so a globally unique partNo
-- cannot hold both price sheets at once.
--
-- Also drops per-product / per-line lead time: neither price sheet needs it.
-- (AppConfig.leadTimeStandard / leadTimeNonStandard are Master Data constants and stay.)

-- ---------- Product ----------
ALTER TABLE "Product" ADD COLUMN "company" "Company" NOT NULL DEFAULT 'UFP';
ALTER TABLE "Product" ADD COLUMN "vendorPartNo" TEXT;
ALTER TABLE "Product" ADD COLUMN "shortColorName" TEXT;
ALTER TABLE "Product" DROP COLUMN "leadTimeDays";

DROP INDEX IF EXISTS "Product_partNo_key";
CREATE UNIQUE INDEX "Product_company_partNo_key" ON "Product"("company", "partNo");
CREATE INDEX "Product_company_idx" ON "Product"("company");

-- ---------- ProductPrice ----------
ALTER TABLE "ProductPrice" DROP COLUMN "leadTimeDays";

-- ---------- PoLine ----------
ALTER TABLE "PoLine" DROP COLUMN "leadTime";

-- ---------- PriceListVersion ----------
ALTER TABLE "PriceListVersion" ADD COLUMN "company" "Company" NOT NULL DEFAULT 'UFP';

DROP INDEX IF EXISTS "PriceListVersion_status_effectiveFrom_idx";
CREATE INDEX "PriceListVersion_company_status_effectiveFrom_idx"
  ON "PriceListVersion"("company", "status", "effectiveFrom");

-- ---------- Color ----------
ALTER TABLE "Color" ADD COLUMN "company" "Company" NOT NULL DEFAULT 'UFP';
ALTER TABLE "Color" ADD COLUMN "shortName" TEXT;
ALTER TABLE "Color" ADD COLUMN "construction" TEXT;

DROP INDEX IF EXISTS "Color_code_key";
CREATE UNIQUE INDEX "Color_company_code_key" ON "Color"("company", "code");

-- ---------- StockingLocation ----------
ALTER TABLE "StockingLocation" ADD COLUMN "company" "Company" NOT NULL DEFAULT 'UFP';

DROP INDEX IF EXISTS "StockingLocation_name_key";
CREATE UNIQUE INDEX "StockingLocation_company_name_key" ON "StockingLocation"("company", "name");

-- ---------- Port ----------
ALTER TABLE "Port" ADD COLUMN "company" "Company" NOT NULL DEFAULT 'UFP';

DROP INDEX IF EXISTS "Port_name_key";
CREATE UNIQUE INDEX "Port_company_name_key" ON "Port"("company", "name");

-- ---------- ShippingLine ----------
ALTER TABLE "ShippingLine" ADD COLUMN "company" "Company" NOT NULL DEFAULT 'UFP';

DROP INDEX IF EXISTS "ShippingLine_name_key";
CREATE UNIQUE INDEX "ShippingLine_company_name_key" ON "ShippingLine"("company", "name");

-- ---------- ProcessStage ----------
ALTER TABLE "ProcessStage" ADD COLUMN "company" "Company" NOT NULL DEFAULT 'UFP';

DROP INDEX IF EXISTS "ProcessStage_order_key";
DROP INDEX IF EXISTS "ProcessStage_name_key";
CREATE UNIQUE INDEX "ProcessStage_company_order_key" ON "ProcessStage"("company", "order");
CREATE UNIQUE INDEX "ProcessStage_company_name_key" ON "ProcessStage"("company", "name");

-- ---------- CapacityPeriod ----------
ALTER TABLE "CapacityPeriod" ADD COLUMN "company" "Company" NOT NULL DEFAULT 'UFP';

DROP INDEX IF EXISTS "CapacityPeriod_effectiveFrom_idx";
CREATE INDEX "CapacityPeriod_company_effectiveFrom_idx"
  ON "CapacityPeriod"("company", "effectiveFrom");

-- ---------- AppConfig ----------
-- Was a singleton pinned to id = 1; becomes one row per company.
ALTER TABLE "AppConfig" ADD COLUMN "company" "Company" NOT NULL DEFAULT 'UFP';
ALTER TABLE "AppConfig" ADD COLUMN "finalPaymentDays" INTEGER;

CREATE SEQUENCE IF NOT EXISTS "AppConfig_id_seq" AS INTEGER OWNED BY "AppConfig"."id";
SELECT setval('"AppConfig_id_seq"', GREATEST(COALESCE((SELECT MAX("id") FROM "AppConfig"), 1), 1));
ALTER TABLE "AppConfig" ALTER COLUMN "id" SET DEFAULT nextval('"AppConfig_id_seq"');

CREATE UNIQUE INDEX "AppConfig_company_key" ON "AppConfig"("company");
