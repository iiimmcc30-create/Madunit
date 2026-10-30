-- CreateEnum
CREATE TYPE "SellerStatus" AS ENUM ('ACTIVE', 'BANNED');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('DRAFT', 'PENDING_PAYMENT', 'PUBLISHED', 'SOLD', 'DELETED');

-- CreateEnum
CREATE TYPE "PublishMode" AS ENUM ('AUTO', 'APPROVAL');

-- CreateEnum
CREATE TYPE "InquiryStatus" AS ENUM ('WAITING_SELLER', 'AVAILABLE', 'SOLD', 'TIMEOUT');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED');

-- CreateTable
CREATE TABLE "Store" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "ownerUsername" TEXT NOT NULL,
    "ownerTelegramId" TEXT NOT NULL,
    "listingTemplate" TEXT NOT NULL,
    "listingFee" DECIMAL(10,2) NOT NULL DEFAULT 15,
    "publishMode" "PublishMode" NOT NULL DEFAULT 'AUTO',
    "listingSeq" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Seller" (
    "id" TEXT NOT NULL,
    "telegramId" TEXT NOT NULL,
    "phone" TEXT,
    "status" "SellerStatus" NOT NULL DEFAULT 'ACTIVE',
    "listingCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Seller_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Listing" (
    "id" TEXT NOT NULL,
    "shortCode" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "telegramVideoFileId" TEXT NOT NULL,
    "telegramVideoUniqueId" TEXT,
    "description" TEXT NOT NULL,
    "extractedFields" JSONB NOT NULL DEFAULT '{}',
    "price" DECIMAL(10,2) NOT NULL,
    "status" "ListingStatus" NOT NULL DEFAULT 'DRAFT',
    "channelMessageId" TEXT,
    "fingerprint" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inquiry" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "buyerTelegramId" TEXT NOT NULL,
    "status" "InquiryStatus" NOT NULL DEFAULT 'WAITING_SELLER',
    "finalPrice" DECIMAL(10,2),
    "sellerNotifiedAt" TIMESTAMP(3),
    "sellerRepliedAt" TIMESTAMP(3),
    "reminderSentAt" TIMESTAMP(3),
    "timedOutAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Inquiry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "receiptPhotoFileId" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Store_channelId_key" ON "Store"("channelId");

-- CreateIndex
CREATE UNIQUE INDEX "Seller_telegramId_key" ON "Seller"("telegramId");

-- CreateIndex
CREATE UNIQUE INDEX "Listing_shortCode_key" ON "Listing"("shortCode");

-- CreateIndex
CREATE INDEX "Listing_storeId_status_idx" ON "Listing"("storeId", "status");

-- CreateIndex
CREATE INDEX "Listing_sellerId_idx" ON "Listing"("sellerId");

-- CreateIndex
CREATE INDEX "Listing_fingerprint_idx" ON "Listing"("fingerprint");

-- CreateIndex
CREATE INDEX "Inquiry_listingId_status_idx" ON "Inquiry"("listingId", "status");

-- CreateIndex
CREATE INDEX "Inquiry_buyerTelegramId_idx" ON "Inquiry"("buyerTelegramId");

-- CreateIndex
CREATE INDEX "Payment_listingId_status_idx" ON "Payment"("listingId", "status");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Seller"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
