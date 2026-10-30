import { describe, expect, it } from "vitest";
import { listingMatchesRequest } from "../src/services/buyer-request";

const listing = {
  shortCode: "A001",
  storeId: "s1",
  price: 450,
  description: "لفل 70 مثالية الثلجي ربط جوجل",
  binding: "جوجل",
  skins: ["مثالية الثلجي"],
  ownerUsername: "cv_91",
};

describe("مطابقة طلب المشتري", () => {
  it("يطابق ميزانية وسكن الثلجي", () => {
    expect(
      listingMatchesRequest(listing, {
        budgetMax: 500,
        skins: ["مثالية الثلجي"],
        binding: null,
        notes: "",
      }),
    ).toBe(true);
    expect(
      listingMatchesRequest(listing, {
        budgetMax: 400,
        skins: ["مثالية الثلجي"],
        binding: null,
        notes: "",
      }),
    ).toBe(false);
  });

  it("ما يطابق الطلب الفاضي", () => {
    expect(
      listingMatchesRequest(listing, { budgetMax: null, skins: [], binding: null, notes: "" }),
    ).toBe(false);
  });
});
