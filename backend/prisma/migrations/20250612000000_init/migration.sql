-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'HQ_SALES', 'UAE_JEBEL_ALI', 'UAE_SHARJAH', 'UAE_ABU_DHABI', 'LOGISTICS', 'VIEWER');

-- CreateEnum
CREATE TYPE "AccessLevel" AS ENUM ('FULL', 'READ_WRITE', 'READ_ONLY');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'VIEWER',
    "accessLevel" "AccessLevel" NOT NULL DEFAULT 'READ_ONLY',
    "restrictedPages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" SERIAL NOT NULL,
    "poNo" TEXT NOT NULL,
    "rev" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PO Received',
    "poDate" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "skids" DOUBLE PRECISION,
    "stockingLocation" TEXT,
    "portOfDest" TEXT,
    "poValue" DOUBLE PRECISION,
    "totalM2" DOUBLE PRECISION,
    "productionSite" TEXT,
    "productionStart" TEXT,
    "productionEtc" TEXT,
    "piNo" TEXT,
    "piDate" TEXT,
    "piValue" DOUBLE PRECISION,
    "dpDate" TEXT,
    "dpAmount" DOUBLE PRECISION,
    "ciNo" TEXT,
    "ciDate" TEXT,
    "ciValue" DOUBLE PRECISION,
    "freight" DOUBLE PRECISION,
    "inland" DOUBLE PRECISION,
    "balanceDue" DOUBLE PRECISION,
    "bpDate" TEXT,
    "bpAmount" DOUBLE PRECISION,
    "telexDate" TEXT,
    "containerNo" TEXT,
    "bol" TEXT,
    "isf" TEXT,
    "shippingLine" TEXT,
    "shippingUrl" TEXT,
    "shippingEta" TEXT,
    "actualDeparture" TEXT,
    "arrivalDate" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoLine" (
    "id" SERIAL NOT NULL,
    "poId" INTEGER NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "partNo" TEXT,
    "custPartNo" TEXT,
    "size" TEXT,
    "widthMm" DOUBLE PRECISION,
    "lengthMm" DOUBLE PRECISION,
    "color" TEXT,
    "qtyMsf" DOUBLE PRECISION,
    "qtyM2" DOUBLE PRECISION,
    "sheets" DOUBLE PRECISION,
    "skids" DOUBLE PRECISION,
    "unitMsf" DOUBLE PRECISION,
    "unitM2" DOUBLE PRECISION,
    "extPo" DOUBLE PRECISION,
    "leadTime" INTEGER,

    CONSTRAINT "PoLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoHistory" (
    "id" SERIAL NOT NULL,
    "poId" INTEGER NOT NULL,
    "stage" TEXT NOT NULL,
    "note" TEXT,
    "userId" TEXT,
    "byRole" TEXT,
    "at" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PoHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "master" JSONB NOT NULL,
    "pricing" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "PurchaseOrder_poNo_idx" ON "PurchaseOrder"("poNo");

-- CreateIndex
CREATE INDEX "PurchaseOrder_status_idx" ON "PurchaseOrder"("status");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoLine" ADD CONSTRAINT "PoLine_poId_fkey" FOREIGN KEY ("poId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoHistory" ADD CONSTRAINT "PoHistory_poId_fkey" FOREIGN KEY ("poId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoHistory" ADD CONSTRAINT "PoHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
