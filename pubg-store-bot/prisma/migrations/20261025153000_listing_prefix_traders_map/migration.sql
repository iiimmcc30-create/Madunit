-- AlterTable
ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "listingPrefix" TEXT NOT NULL DEFAULT 'A';

-- CreateTable
CREATE TABLE IF NOT EXISTS "TradersMirrorMap" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "tradersGroupId" TEXT NOT NULL,
    "tradersMessageId" TEXT NOT NULL,
    "channelMessageId" TEXT NOT NULL,
    "shortCode" TEXT,
    "captionSnippet" TEXT,
    "soldNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradersMirrorMap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "TradersMirrorMap_storeId_tradersMessageId_key" ON "TradersMirrorMap"("storeId", "tradersMessageId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TradersMirrorMap_storeId_shortCode_idx" ON "TradersMirrorMap"("storeId", "shortCode");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TradersMirrorMap_tradersGroupId_tradersMessageId_idx" ON "TradersMirrorMap"("tradersGroupId", "tradersMessageId");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "TradersMirrorMap" ADD CONSTRAINT "TradersMirrorMap_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
