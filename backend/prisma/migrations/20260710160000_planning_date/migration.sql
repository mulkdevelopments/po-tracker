-- Add planning date for Planning stage
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "planningDate" TEXT;
