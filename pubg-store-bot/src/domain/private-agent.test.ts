import { describe, expect, it } from "vitest";
import {
  isDmstorBot,
  isPrivateAgentDisabled,
  PRIVATE_AGENT_DISABLED_BOTS,
} from "./private-agent";

describe("isPrivateAgentDisabled", () => {
  it("disables private MAD AI for DMSTOR and Sultan", () => {
    expect(PRIVATE_AGENT_DISABLED_BOTS).toEqual(["dmstor_bot", "sultan_sl_bot", "s3dstore_bot"]);
    expect(isPrivateAgentDisabled("DMSTOR_bot")).toBe(true);
    expect(isPrivateAgentDisabled("@DMSTOR_bot")).toBe(true);
    expect(isPrivateAgentDisabled("dmstor_bot")).toBe(true);
    expect(isPrivateAgentDisabled("sultan_sl_bot")).toBe(true);
    expect(isPrivateAgentDisabled("@Sultan_SL_Bot")).toBe(true);
  });

  it("leaves other store bots enabled", () => {
    expect(isPrivateAgentDisabled("sarhstoree_bot")).toBe(false);
    expect(isPrivateAgentDisabled("")).toBe(false);
    expect(isPrivateAgentDisabled(null)).toBe(false);
  });
});

describe("isDmstorBot", () => {
  it("matches DMSTOR only", () => {
    expect(isDmstorBot("DMSTOR_bot")).toBe(true);
    expect(isDmstorBot("@dmstor_bot")).toBe(true);
    expect(isDmstorBot("sarhstoree_bot")).toBe(false);
  });
});
