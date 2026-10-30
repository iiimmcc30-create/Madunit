-- AlterTable
ALTER TABLE "Store" ADD COLUMN "scrimBotTokenCipher" TEXT;
ALTER TABLE "Store" ADD COLUMN "scrimBotTelegramId" TEXT;
ALTER TABLE "Store" ADD COLUMN "scrimBotUsername" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Store_scrimBotTelegramId_key" ON "Store"("scrimBotTelegramId");
