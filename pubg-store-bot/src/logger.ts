import pino from "pino";

export function createLogger(level = "info", env = process.env.NODE_ENV ?? "development") {
  return pino({
    level,
    base: { service: "pubg-store-bot", env },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export type Logger = ReturnType<typeof createLogger>;
