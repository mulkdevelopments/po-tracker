-- Add Maintainer role for full PO operational control.

ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'MAINTAINER';
