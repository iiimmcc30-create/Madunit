import { describe, expect, it } from "vitest";
import { Bot } from "grammy";
import { registerBot, SCRIM_BOT_COMMANDS } from "./create-bot";

type Handler = { kind: string; trigger: unknown };

function recordingBot() {
  const bot = new Bot("1:test", { botInfo: { id: 1, is_bot: true, first_name: "t", username: "t" } as never });
  const commands: string[] = [];
  const original = bot.command.bind(bot);
  (bot as unknown as { command: (c: string | string[], ...h: unknown[]) => unknown }).command = (c, ...h) => {
    commands.push(...(Array.isArray(c) ? c : [c]));
    return original(c as never, ...(h as never[]));
  };
  return { bot, commands };
}

const deps = {
  storeId: "s1",
  botUsername: "t",
  logger: { error() {}, info() {}, warn() {} },
  config: {},
} as never;

describe("bot roles", () => {
  it("market bot has no scrim commands, scrims bot has no market commands", () => {
    const market = recordingBot();
    registerBot(market.bot as never, deps, "market");
    expect(market.commands).toContain("sold");
    expect(market.commands).toContain("add_scrim_bot");
    expect(market.commands.some((c) => c.startsWith("scrim"))).toBe(false);

    const scrims = recordingBot();
    registerBot(scrims.bot as never, deps, "scrims");
    expect(scrims.commands).toContain("scrim");
    expect(scrims.commands).toContain("scrim_group");
    expect(scrims.commands).not.toContain("sold");
    expect(scrims.commands).not.toContain("add_scrim_bot");

    const both = recordingBot();
    registerBot(both.bot as never, deps, "both");
    expect(both.commands).toContain("sold");
    expect(both.commands).toContain("scrim");
  });
  it("lists scrim commands for the scrims bot menu", () => {
    expect(SCRIM_BOT_COMMANDS.map((c) => c.command)).toContain("scrim_settings");
  });
});
