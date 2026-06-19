-- PI rejection / resubmit workflow

ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "piResubmitCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "piRejectedNote" TEXT;
