-- AlterTable
ALTER TABLE "Store" ALTER COLUMN "listingFee" SET DEFAULT 0;
ALTER TABLE "Store" ADD COLUMN "paymentInstructions" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Store" ADD COLUMN "coverTheme" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "Listing" ADD COLUMN "channelVideoMessageId" TEXT;
