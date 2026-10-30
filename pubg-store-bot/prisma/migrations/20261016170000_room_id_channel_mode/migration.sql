-- AlterTable
ALTER TABLE "ScrimTemplate" ADD COLUMN "roomIdChannelMode" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ScrimTemplate" ADD COLUMN "roomIdLeadMinutes" INTEGER NOT NULL DEFAULT 7;

-- AlterTable
ALTER TABLE "ScrimRoom" ADD COLUMN "channelPostAt" TIMESTAMP(3);
ALTER TABLE "ScrimRoom" ADD COLUMN "channelPostedAt" TIMESTAMP(3);
