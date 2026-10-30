import Redis from "ioredis";
import type { Logger } from "../logger";

export function createRedis(
  url: string,
  logger: Logger,
  options?: { maxRetriesPerRequest?: number | null },
): Redis {
  const redis = new Redis(url, {
    maxRetriesPerRequest: options?.maxRetriesPerRequest ?? 3,
    enableReadyCheck: true,
    lazyConnect: false,
  });

  redis.on("error", (err) => {
    logger.error({ err }, "redis error");
  });

  return redis;
}
