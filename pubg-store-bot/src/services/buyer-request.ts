import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { PublicListing } from "../agent/public-listing";

export interface SaveBuyerRequestInput {
  storeId: string;
  buyerTelegramId: string;
  budgetMax?: number | null;
  skins?: string[];
  binding?: string | null;
  notes?: string;
}

export async function saveBuyerRequest(db: PrismaClient, input: SaveBuyerRequestInput) {
  return db.buyerRequest.create({
    data: {
      storeId: input.storeId,
      buyerTelegramId: input.buyerTelegramId,
      budgetMax:
        input.budgetMax != null && input.budgetMax > 0
          ? new Prisma.Decimal(input.budgetMax)
          : null,
      skins: input.skins?.map((skin) => skin.trim()).filter(Boolean) ?? [],
      binding: input.binding?.trim() || null,
      notes: input.notes?.trim() ?? "",
      status: "OPEN",
    },
  });
}

export function listingMatchesRequest(
  listing: PublicListing,
  request: {
    budgetMax: number | null;
    skins: string[];
    binding: string | null;
    notes: string;
  },
): boolean {
  if (request.budgetMax != null && listing.price > request.budgetMax) return false;
  if (request.binding) {
    const binding = `${listing.binding} ${listing.description}`.toLowerCase();
    if (!binding.includes(request.binding.toLowerCase())) return false;
  }
  const haystack = `${listing.description} ${listing.skins.join(" ")}`.toLowerCase();
  const hasBudget = request.budgetMax != null;
  const hasSkins = request.skins.length > 0;
  const hasBinding = Boolean(request.binding);
  const notes = request.notes.trim();
  if (!hasBudget && !hasSkins && !hasBinding && !notes) return false;
  if (hasSkins && !request.skins.some((skin) => haystack.includes(skin.toLowerCase()))) {
    return false;
  }
  if (!hasBudget && !hasSkins && !hasBinding && notes) {
    return notes
      .split(/\s+/)
      .filter((word) => word.length > 2)
      .some((word) => haystack.includes(word.toLowerCase()));
  }
  return true;
}

export async function findMatchingBuyerRequests(db: PrismaClient, listing: PublicListing) {
  const open = await db.buyerRequest.findMany({
    where: { storeId: listing.storeId, status: "OPEN" },
  });
  const matched = open.filter((row) =>
    listingMatchesRequest(listing, {
      budgetMax: row.budgetMax ? row.budgetMax.toNumber() : null,
      skins: row.skins,
      binding: row.binding,
      notes: row.notes,
    }),
  );
  if (matched.length === 0) return [];
  await db.buyerRequest.updateMany({
    where: { id: { in: matched.map((row) => row.id) } },
    data: { status: "MATCHED" },
  });
  return matched;
}
