-- Configurable under/overpayment tolerance (request log #3).
ALTER TABLE "AppConfig" ADD COLUMN IF NOT EXISTS "paymentTolerancePct" DOUBLE PRECISION DEFAULT 0.01;
ALTER TABLE "AppConfig" ADD COLUMN IF NOT EXISTS "paymentToleranceAbs" DOUBLE PRECISION DEFAULT 1;
