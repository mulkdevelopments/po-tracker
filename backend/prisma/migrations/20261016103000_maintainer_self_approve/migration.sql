-- Optional approver switch for maintainers. Off by default.

ALTER TABLE "User" ADD COLUMN "canSelfApprove" BOOLEAN NOT NULL DEFAULT false;
