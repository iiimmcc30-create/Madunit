-- CreateEnum
CREATE TYPE "BuyerRequestStatus" AS ENUM ('OPEN', 'MATCHED', 'CLOSED');

-- AlterTable
ALTER TABLE "Store" ADD COLUMN "customGlossary" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "BuyerRequest" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "buyerTelegramId" TEXT NOT NULL,
    "budgetMax" DECIMAL(10,2),
    "skins" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "binding" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "status" "BuyerRequestStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuyerRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnmatchedUtterance" (
    "id" TEXT NOT NULL,
    "storeId" TEXT,
    "telegramId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnmatchedUtterance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BuyerRequest_storeId_status_idx" ON "BuyerRequest"("storeId", "status");

-- CreateIndex
CREATE INDEX "BuyerRequest_buyerTelegramId_idx" ON "BuyerRequest"("buyerTelegramId");

-- CreateIndex
CREATE INDEX "UnmatchedUtterance_createdAt_idx" ON "UnmatchedUtterance"("createdAt");

-- CreateIndex
CREATE INDEX "UnmatchedUtterance_storeId_idx" ON "UnmatchedUtterance"("storeId");

-- AddForeignKey
ALTER TABLE "BuyerRequest" ADD CONSTRAINT "BuyerRequest_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnmatchedUtterance" ADD CONSTRAINT "UnmatchedUtterance_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;
