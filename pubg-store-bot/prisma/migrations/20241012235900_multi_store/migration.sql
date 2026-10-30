-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'EXPIRED', 'CANCELED');

-- CreateEnum
CREATE TYPE "StorePlan" AS ENUM ('FREE', 'MONTHLY');

-- AlterTable
ALTER TABLE "Store" ADD COLUMN "title" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Store" ADD COLUMN "plan" "StorePlan" NOT NULL DEFAULT 'MONTHLY';
ALTER TABLE "Store" ADD COLUMN "subscriptionStatus" "SubscriptionStatus" NOT NULL DEFAULT 'TRIAL';
ALTER TABLE "Store" ADD COLUMN "subscriptionExpiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Store_ownerTelegramId_idx" ON "Store"("ownerTelegramId");
