-- Staging table is also used by the separate cynergyform app (shared Postgres).
DO $$ BEGIN
  CREATE TYPE "CynergySubmissionStatus" AS ENUM ('PENDING', 'REJECTED', 'IMPORTED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "CynergyFormSubmission" (
    "id" SERIAL NOT NULL,
    "status" "CynergySubmissionStatus" NOT NULL DEFAULT 'PENDING',
    "poNo" TEXT NOT NULL,
    "poDate" TEXT,
    "stockingLocation" TEXT,
    "portOfDest" TEXT,
    "notes" TEXT,
    "submitterName" TEXT,
    "submitterEmail" TEXT,
    "submitterPhone" TEXT,
    "lines" JSONB NOT NULL,
    "rejectReason" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "importedPoId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CynergyFormSubmission_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CynergyFormSubmission_status_idx" ON "CynergyFormSubmission"("status");
CREATE INDEX IF NOT EXISTS "CynergyFormSubmission_poNo_idx" ON "CynergyFormSubmission"("poNo");
CREATE INDEX IF NOT EXISTS "CynergyFormSubmission_createdAt_idx" ON "CynergyFormSubmission"("createdAt");
