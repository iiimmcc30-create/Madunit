import { describe, expect, it } from "vitest";
import {
  collectFingerprints,
  fingerprintFromFields,
  fingerprintFromPlayerId,
  fingerprintFromVideo,
  primaryFingerprint,
  strongFingerprints,
} from "./fingerprint";

describe("account fingerprints", () => {
  it("prefers player id, then video, and keeps a fields hash", () => {
    const keys = collectFingerprints({
      videoUniqueId: "vid-1",
      fields: { playerId: "5123456789", level: 70, binding: "جوجل", skins: ["إيبك"] },
    });
    expect(keys).toContain("player:5123456789");
    expect(keys).toContain("video:vid-1");
    expect(keys.some((key) => key.startsWith("fields:"))).toBe(true);
    expect(primaryFingerprint(keys)).toBe("player:5123456789");
    expect(strongFingerprints(keys)).toEqual(["player:5123456789", "video:vid-1"]);
  });

  it("treats the same account fields as the same hash", () => {
    const a = fingerprintFromFields({ level: 70, binding: "جوجل", skins: ["ب", "أ"] });
    const b = fingerprintFromFields({ level: 70, binding: "جوجل", skins: ["أ", "ب"] });
    expect(a).toBe(b);
    expect(fingerprintFromPlayerId("id 51234")).toBe("player:51234");
    expect(fingerprintFromVideo(null)).toBeNull();
  });
});
