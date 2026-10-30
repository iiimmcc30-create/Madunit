-- AlterTable
ALTER TABLE "Store" ALTER COLUMN "channelId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "botTelegramId" TEXT;
ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "botUsername" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "botFirstName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "tokenCipher" TEXT;
ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "webhookSecret" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "botEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "subscriptionRemindedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Store_botTelegramId_key" ON "Store"("botTelegramId");
CREATE INDEX IF NOT EXISTS "Store_botEnabled_subscriptionStatus_idx" ON "Store"("botEnabled", "subscriptionStatus");

-- CreateTable
CREATE TABLE "TrialClaim" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrialClaim_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TrialClaim_kind_value_key" ON "TrialClaim"("kind", "value");
CREATE INDEX "TrialClaim_storeId_idx" ON "TrialClaim"("storeId");

ALTER TABLE "TrialClaim" ADD CONSTRAINT "TrialClaim_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "SubscriptionPayment" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "receiptPhotoFileId" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "payerTelegramId" TEXT NOT NULL,
    "periodDays" INTEGER NOT NULL DEFAULT 30,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionPayment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SubscriptionPayment_storeId_status_idx" ON "SubscriptionPayment"("storeId", "status");
CREATE INDEX "SubscriptionPayment_status_idx" ON "SubscriptionPayment"("status");

ALTER TABLE "SubscriptionPayment" ADD CONSTRAINT "SubscriptionPayment_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Listing short codes become unique per store
DROP INDEX IF EXISTS "Listing_shortCode_key";
CREATE UNIQUE INDEX "Listing_storeId_shortCode_key" ON "Listing"("storeId", "shortCode");
