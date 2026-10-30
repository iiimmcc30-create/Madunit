-- CreateEnum
CREATE TYPE "ReferralRole" AS ENUM ('SELLER', 'BUYER');

-- AlterTable
ALTER TABLE "Seller" ADD COLUMN "homeStoreId" TEXT;

-- CreateTable
CREATE TABLE "StoreReferral" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "telegramId" TEXT NOT NULL,
    "role" "ReferralRole" NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreReferral_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Seller_homeStoreId_idx" ON "Seller"("homeStoreId");

-- CreateIndex
CREATE INDEX "StoreReferral_storeId_role_idx" ON "StoreReferral"("storeId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "StoreReferral_storeId_telegramId_role_key" ON "StoreReferral"("storeId", "telegramId", "role");

-- AddForeignKey
ALTER TABLE "Seller" ADD CONSTRAINT "Seller_homeStoreId_fkey" FOREIGN KEY ("homeStoreId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreReferral" ADD CONSTRAINT "StoreReferral_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
