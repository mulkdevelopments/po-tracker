-- AlterTable
CREATE SEQUENCE appsettings_id_seq;
ALTER TABLE "AppSettings" ALTER COLUMN "id" SET DEFAULT nextval('appsettings_id_seq');
ALTER SEQUENCE appsettings_id_seq OWNED BY "AppSettings"."id";

-- AlterTable
ALTER TABLE "PoLine" ADD COLUMN     "extInv" DOUBLE PRECISION,
ADD COLUMN     "notes" TEXT;

-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "bpToTelex" INTEGER,
ADD COLUMN     "ciToBp" INTEGER,
ADD COLUMN     "concat" TEXT,
ADD COLUMN     "dpToShip" INTEGER,
ADD COLUMN     "piToDp" INTEGER,
ADD COLUMN     "poToPi" INTEGER,
ADD COLUMN     "revisionSent" TEXT,
ADD COLUMN     "siNo" INTEGER;

-- CreateTable
CREATE TABLE "ProcessStage" (
    "id" SERIAL NOT NULL,
    "order" INTEGER NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "ProcessStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Port" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "sailingDays" INTEGER,
    "freight" DOUBLE PRECISION,
    "inland" DOUBLE PRECISION,

    CONSTRAINT "Port_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockingLocation" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "arrivalPort" TEXT,

    CONSTRAINT "StockingLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShippingLine" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "trackingUrl" TEXT,

    CONSTRAINT "ShippingLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Color" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT,
    "isStandard" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Color_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" SERIAL NOT NULL,
    "partNo" TEXT NOT NULL,
    "custPartNo" TEXT,
    "itemType" TEXT,
    "surface" TEXT,
    "construction" TEXT,
    "thickness" TEXT,
    "widthIn" DOUBLE PRECISION,
    "widthMm" DOUBLE PRECISION,
    "lengthIn" DOUBLE PRECISION,
    "lengthMm" DOUBLE PRECISION,
    "description" TEXT,
    "colorName" TEXT,
    "vendorColorCode" TEXT,
    "pricePerSqft" DOUBLE PRECISION,
    "pricePerM2" DOUBLE PRECISION,
    "pricePerMsq" DOUBLE PRECISION,
    "pricePerSheet" DOUBLE PRECISION,
    "leadTimeDays" INTEGER,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppConfig" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "sheetsPerSkid" INTEGER,
    "downpaymentPct" DOUBLE PRECISION,
    "containerMaxM2" DOUBLE PRECISION,
    "leadTimeStandard" INTEGER,
    "leadTimeNonStandard" INTEGER,
    "originPort" TEXT,
    "pricingNote" TEXT,

    CONSTRAINT "AppConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProcessStage_order_key" ON "ProcessStage"("order");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessStage_name_key" ON "ProcessStage"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Port_name_key" ON "Port"("name");

-- CreateIndex
CREATE UNIQUE INDEX "StockingLocation_name_key" ON "StockingLocation"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ShippingLine_name_key" ON "ShippingLine"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Color_code_key" ON "Color"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Product_partNo_key" ON "Product"("partNo");

