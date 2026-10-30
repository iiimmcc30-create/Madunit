-- AlterTable
ALTER TABLE "ScrimTemplate" ADD COLUMN "organizersGroupId" TEXT;
ALTER TABLE "ScrimTemplate" ADD COLUMN "dropsGroupLink" TEXT;
ALTER TABLE "ScrimTemplate" ADD COLUMN "postRoomPassToChannel" BOOLEAN NOT NULL DEFAULT false;
