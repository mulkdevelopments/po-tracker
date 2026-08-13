-- Customer-stated pricing kept alongside our price-list values so mismatches can be flagged.
ALTER TABLE "PurchaseOrder" ADD COLUMN "custPoTotal" DOUBLE PRECISION;
ALTER TABLE "PoLine" ADD COLUMN "custUnitMsf" DOUBLE PRECISION;
ALTER TABLE "PoLine" ADD COLUMN "custExtPo" DOUBLE PRECISION;
