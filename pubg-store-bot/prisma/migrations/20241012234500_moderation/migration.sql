-- AlterTable
ALTER TABLE "Seller" ADD COLUMN "banReason" TEXT;
ALTER TABLE "Seller" ADD COLUMN "bannedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Listing" ADD COLUMN "fingerprints" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
