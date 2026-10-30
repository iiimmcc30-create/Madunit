import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { loadConfig } from "../src/config";
import { DEFAULT_LISTING_TEMPLATE } from "../src/domain/caption";

const prisma = new PrismaClient();

async function main() {
  const config = loadConfig();
  await prisma.store.upsert({
    where: { channelId: config.DEFAULT_CHANNEL_ID },
    create: {
      channelId: config.DEFAULT_CHANNEL_ID,
      title: config.ownerUsername,
      ownerUsername: config.ownerUsername,
      ownerTelegramId: config.OWNER_TELEGRAM_ID,
      listingTemplate: DEFAULT_LISTING_TEMPLATE,
      listingFee: config.LISTING_FEE,
      publishMode: config.PUBLISH_MODE,
    },
    update: {
      ownerUsername: config.ownerUsername,
      ownerTelegramId: config.OWNER_TELEGRAM_ID,
      listingFee: config.LISTING_FEE,
      publishMode: config.PUBLISH_MODE,
    },
  });
  console.log("seeded default store for channel", config.DEFAULT_CHANNEL_ID);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
