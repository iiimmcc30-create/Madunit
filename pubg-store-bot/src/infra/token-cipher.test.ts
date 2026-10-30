import { describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  parseTokenEncryptionKey,
  redactTelegramError,
} from "./token-cipher";

const KEY = parseTokenEncryptionKey("a".repeat(64));

describe("token cipher", () => {
  it("round-trips a bot token without leaving plaintext in the cipher", () => {
    const token = "123456789:AAExampleTokenValue_for_tests";
    const cipher = encryptSecret(token, KEY);
    expect(cipher.startsWith("v1:")).toBe(true);
    expect(cipher).not.toContain(token);
    expect(cipher).not.toContain("AAExampleTokenValue");
    expect(decryptSecret(cipher, KEY)).toBe(token);
  });

  it("rejects a different key", () => {
    const cipher = encryptSecret("secret-token", KEY);
    const other = parseTokenEncryptionKey("b".repeat(64));
    expect(() => decryptSecret(cipher, other)).toThrow();
  });

  it("redacts tokens from Telegram errors", () => {
    const message = redactTelegramError(
      new Error("Request failed https://api.telegram.org/bot123456:AAHideme1234567890abcd/getMe"),
    );
    expect(message).not.toContain("AAHideme");
    expect(message).toContain("bot<redacted>");
  });
});
