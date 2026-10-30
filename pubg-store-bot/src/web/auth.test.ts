import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { dashboardSecret, readDashboardUser, signDashboardUser, verifyTelegramLogin } from "./auth";

describe("dashboard auth", () => {
  it("accepts a valid telegram login hash", () => {
    const botToken = "123:abc";
    const payload = {
      id: 99,
      first_name: "Owner",
      username: "shop_owner",
      auth_date: Math.floor(Date.now() / 1000),
      hash: "",
    };
    const dataCheck = Object.entries(payload)
      .filter(([key, value]) => key !== "hash" && value !== undefined && value !== "")
      .map(([key, value]) => `${key}=${value}`)
      .sort()
      .join("\n");
    const secret = createHash("sha256").update(botToken).digest();
    payload.hash = createHmac("sha256", secret).update(dataCheck).digest("hex");
    expect(verifyTelegramLogin(payload, botToken)).toBe(true);
    expect(verifyTelegramLogin({ ...payload, hash: "nope" }, botToken)).toBe(false);
  });

  it("uses any non-empty dashboard token as the cookie secret", () => {
    expect(dashboardSecret("bot-token", "4567890")).toBe("4567890");
    expect(dashboardSecret("bot-token", "")).not.toBe("");
  });

  it("round-trips a signed dashboard cookie", () => {
    const token = signDashboardUser("99", "secret");
    expect(readDashboardUser(token, "secret")).toBe("99");
    expect(readDashboardUser(token, "other")).toBeNull();
  });
});
