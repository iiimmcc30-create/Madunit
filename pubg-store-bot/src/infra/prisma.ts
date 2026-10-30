import { PrismaClient } from "@prisma/client";

export function createPrisma(): PrismaClient {
  return new PrismaClient();
}
