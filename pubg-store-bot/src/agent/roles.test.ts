import { describe, expect, it } from "vitest";
import { canRunTool, isSensitiveTool, resolveActorRole, toolsForRole } from "./roles";

describe("صلاحيات أدوات الوكيل", () => {
  it("يمنع المشتري من النشر والحذف", () => {
    expect(canRunTool("publish_listing", "buyer")).toBe(false);
    expect(canRunTool("delete_listing", "buyer")).toBe(false);
    expect(canRunTool("search_listings", "buyer")).toBe(true);
    expect(canRunTool("start_listing", "seller")).toBe(true);
    expect(canRunTool("store_settings", "owner")).toBe(true);
    expect(canRunTool("store_settings", "seller")).toBe(false);
    expect(canRunTool("list_store_listings", "buyer")).toBe(false);
    expect(canRunTool("list_store_listings", "owner")).toBe(true);
    expect(canRunTool("list_stores", "owner")).toBe(false);
    expect(canRunTool("list_stores", "super_admin")).toBe(true);
    expect(isSensitiveTool("publish_listing")).toBe(true);
    expect(isSensitiveTool("search_listings")).toBe(false);
    expect(toolsForRole("buyer").has("ask_clarification")).toBe(true);
  });

  it("يحسب الدور من الآيدي قبل النموذج: سوبر أدمن ثم مالك المتجر", () => {
    const ids = {
      telegramId: "6769417105",
      storeOwnerTelegramId: "6769417105",
      superAdminTelegramId: "6769417105",
      envOwnerTelegramId: "6769417105",
      isSellerOnStore: false,
    };
    expect(resolveActorRole(ids)).toBe("super_admin");
    expect(
      resolveActorRole({
        ...ids,
        superAdminTelegramId: "",
        envOwnerTelegramId: "",
      }),
    ).toBe("owner");
    expect(
      resolveActorRole({
        ...ids,
        telegramId: "111",
        storeOwnerTelegramId: "222",
        isSellerOnStore: true,
      }),
    ).toBe("seller");
    expect(
      resolveActorRole({
        ...ids,
        telegramId: "111",
        storeOwnerTelegramId: "222",
        superAdminTelegramId: "6769417105",
        isSellerOnStore: false,
      }),
    ).toBe("buyer");
    expect(
      resolveActorRole({
        telegramId: "6769417105",
        storeOwnerTelegramId: "",
        superAdminTelegramId: "6769417105",
        envOwnerTelegramId: "6769417105",
        isSellerOnStore: false,
      }),
    ).toBe("super_admin");
  });
});
