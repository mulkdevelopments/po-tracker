-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "allMaterialAvailable" TEXT,
ADD COLUMN     "dispatchFromFactory" TEXT,
ADD COLUMN     "piSent" TEXT,
ADD COLUMN     "productionBegin" TEXT,
ADD COLUMN     "productionComplete" TEXT,
ADD COLUMN     "productionNotes" TEXT,
ADD COLUMN     "productionStatus" TEXT,
ADD COLUMN     "soNo" TEXT,
ADD COLUMN     "standardColorsOnly" TEXT;

