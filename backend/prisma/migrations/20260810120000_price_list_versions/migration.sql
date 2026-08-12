-- CreateEnum
CREATE TYPE "PriceListStatus" AS ENUM ('LIVE', 'PAST');

-- CreateTable
CREATE TABLE "PriceListVersion" (
    "id" SERIAL NOT NULL,
    "label" TEXT NOT NULL,
    "effectiveFrom" TEXT NOT NULL,
    "effectiveTo" TEXT,
    "status" "PriceListStatus" NOT NULL DEFAULT 'LIVE',
    "sourceSheet" TEXT,
    "sourceFile" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "PriceListVersion_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "ProductPrice" ADD COLUMN "priceListVersionId" INTEGER;

-- CreateIndex
CREATE INDEX "PriceListVersion_status_effectiveFrom_idx" ON "PriceListVersion"("status", "effectiveFrom");

-- CreateIndex
CREATE INDEX "ProductPrice_priceListVersionId_idx" ON "ProductPrice"("priceListVersionId");

-- AddForeignKey
ALTER TABLE "PriceListVersion" ADD CONSTRAINT "PriceListVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPrice" ADD CONSTRAINT "ProductPrice_priceListVersionId_fkey" FOREIGN KEY ("priceListVersionId") REFERENCES "PriceListVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
