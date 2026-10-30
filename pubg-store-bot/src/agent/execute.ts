import { formatPublicListing, type PublicListing } from "./public-listing";
import { formatSearchReply, type ListingSearchFilters } from "./search";
import type { AgentToolCall } from "../llm/types";
import type { AgentToolRuntime, PendingAgentConfirm } from "./tools";
import { CLARIFY_QUESTION } from "./tools";
import type { HeuristicPlan } from "./heuristic";
import { canRunTool, isSensitiveTool, toolDeniedMessage } from "./roles";

function num(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function strArr(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.map(String).map((item) => item.trim()).filter(Boolean);
  return items.length ? items : undefined;
}

function bool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function filtersFromArgs(args: Record<string, unknown>): ListingSearchFilters {
  return {
    query: str(args.query),
    maxPrice: num(args.maxPrice),
    minPrice: num(args.minPrice),
    skins: strArr(args.skins),
    binding: str(args.binding),
    limit: 3,
  };
}

function publicJson(listing: PublicListing) {
  return {
    shortCode: listing.shortCode,
    price: listing.price,
    description: listing.description,
    binding: listing.binding,
    level: listing.level ?? null,
    skins: listing.skins,
  };
}

export interface ToolCallResult {
  json: string;
  stopLoop?: boolean;
  pendingConfirm?: PendingAgentConfirm;
  finalText?: string;
}

function ok(payload: unknown): ToolCallResult {
  return { json: JSON.stringify(payload) };
}

function confirmPayload(tool: string, args: Record<string, unknown>, summary: string): ToolCallResult {
  return {
    json: JSON.stringify({ needsConfirm: true, summary, tool }),
    stopLoop: true,
    pendingConfirm: { tool, args, summary },
    finalText: summary,
  };
}

export async function executeToolCall(call: AgentToolCall, runtime: AgentToolRuntime): Promise<ToolCallResult> {
  const role = runtime.role ?? "buyer";
  if (!canRunTool(call.name, role)) {
    return ok({ error: toolDeniedMessage(call.name, role) });
  }
  if (call.name === "delete_listing") {
    const code =
      str(call.arguments.shortCode) ??
      runtime.focusShortCode ??
      (await runtime.latestListingShortCode?.()) ??
      undefined;
    if (code) call.arguments = { ...call.arguments, shortCode: code };
  }
  if (isSensitiveTool(call.name) && !runtime.confirmed) {
    return confirmPayload(call.name, call.arguments ?? {}, confirmSummary(call.name, call.arguments, runtime));
  }
  try {
    switch (call.name) {
      case "search_listings": {
        const hits = await runtime.searchListings(filtersFromArgs(call.arguments));
        if (hits[0]) await runtime.setFocus(hits[0].shortCode);
        await runtime.setLastSearchCodes?.(hits.map((item) => item.shortCode));
        return ok({
          listings: hits.map(publicJson),
          replyHint: formatSearchReply(hits),
        });
      }
      case "get_listing": {
        const index = num(call.arguments.index);
        const fromIndex =
          index && runtime.lastSearchCodes[index - 1] ? runtime.lastSearchCodes[index - 1] : undefined;
        const code = str(call.arguments.shortCode) ?? fromIndex ?? runtime.focusShortCode;
        if (!code) {
          return ok({ error: "حدد رقم الإعلان مثل A001" });
        }
        const listing = await runtime.getListing(code);
        if (!listing) {
          return ok({ error: `ما لقيت إعلان منشور برقم ${code}.` });
        }
        await runtime.setFocus(listing.shortCode);
        return ok({ listing: publicJson(listing), replyHint: formatPublicListing(listing) });
      }
      case "create_inquiry": {
        const code = str(call.arguments.shortCode) ?? runtime.focusShortCode;
        if (!code) {
          return ok({ error: "حدد رقم الإعلان مثل A001" });
        }
        const result = await runtime.createInquiry(code);
        if (result.listing) await runtime.setFocus(result.listing.shortCode);
        return ok({
          outcome: result.outcome,
          message: result.buyerMessage,
          shortCode: result.listing?.shortCode ?? code,
        });
      }
      case "save_buyer_request": {
        const saved = await runtime.saveBuyerRequest({
          budgetMax: num(call.arguments.budgetMax) ?? null,
          skins: strArr(call.arguments.skins) ?? [],
          binding: str(call.arguments.binding) ?? null,
          notes: str(call.arguments.notes) ?? "",
        });
        return ok(saved);
      }
      case "start_listing": {
        const started = await runtime.startListing?.({
          description: str(call.arguments.description),
          price: num(call.arguments.price),
          binding: str(call.arguments.binding),
        });
        return ok(started ?? { error: "ما قدرت أبدأ الإعلان." });
      }
      case "update_listing_draft": {
        const updated = await runtime.updateDraft?.({
          description: str(call.arguments.description),
          price: num(call.arguments.price),
          binding: str(call.arguments.binding),
        });
        return ok(updated ?? { error: "ما في مسودة." });
      }
      case "publish_listing": {
        const published = await runtime.publishListing?.();
        return ok(published ?? { error: "ما قدرت أنشر." });
      }
      case "mark_sold": {
        const code = str(call.arguments.shortCode) ?? runtime.focusShortCode;
        if (!code) return ok({ error: "حدد رقم الإعلان." });
        return ok((await runtime.markSold?.(code)) ?? { error: "ما قدرت أعلّمه مباع." });
      }
      case "delete_listing": {
        const code =
          str(call.arguments.shortCode) ??
          runtime.focusShortCode ??
          (await runtime.latestListingShortCode?.()) ??
          undefined;
        if (!code) return ok({ error: "حدد رقم الإعلان." });
        return ok((await runtime.deleteListing?.(code)) ?? { error: "ما قدرت أحذف." });
      }
      case "seller_reply": {
        return ok(
          (await runtime.sellerReply?.({
            available: bool(call.arguments.available),
            price: num(call.arguments.price),
            inquiryId: str(call.arguments.inquiryId),
          })) ?? { error: "ما في استفسار انتظار." },
        );
      }
      case "store_settings": {
        return ok((await runtime.storeSettings?.(call.arguments ?? {})) ?? { error: "ما قدرت أعدّل الإعدادات." });
      }
      case "subscription_status": {
        return ok((await runtime.subscriptionStatus?.()) ?? { error: "ما قدرت أقرأ الاشتراك." });
      }
      case "submit_payment_receipt": {
        return ok(
          (await runtime.submitReceipt?.(str(call.arguments.kind))) ?? { error: "ما في إيصال أو دفعة معلّقة." },
        );
      }
      case "list_store_listings": {
        return ok((await runtime.listStoreListings?.()) ?? { error: "ما قدرت أقرأ الإعلانات." });
      }
      case "list_inquiries": {
        return ok((await runtime.listInquiries?.()) ?? { error: "ما قدرت أقرأ الاستفسارات." });
      }
      case "store_stats": {
        return ok((await runtime.storeStats?.()) ?? { error: "ما قدرت أقرأ الإحصائيات." });
      }
      case "list_stores": {
        return ok((await runtime.listStores?.()) ?? { error: "ما قدرت أقرأ المتاجر." });
      }
      case "owner_help": {
        return ok((await runtime.ownerHelp?.(str(call.arguments.topic))) ?? { error: "ما قدرت أشرح." });
      }
      case "ask_clarification": {
        const question = str(call.arguments.question) || CLARIFY_QUESTION;
        return {
          json: JSON.stringify({ question }),
          stopLoop: true,
          finalText: question,
        };
      }
      default:
        return ok({ error: `أداة غير معروفة: ${call.name}` });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "تعذر تنفيذ الأداة.";
    return ok({ error: message });
  }
}

function confirmSummary(tool: string, args: Record<string, unknown>, runtime: AgentToolRuntime): string {
  const code = str(args.shortCode) ?? runtime.focusShortCode ?? "";
  if (tool === "publish_listing") {
    const price = runtime.draft?.price;
    return price ? `نأكد نشر الإعلان بـ ${price} ريال؟` : "نأكد نشر الإعلان؟";
  }
  if (tool === "mark_sold") return `نأكد إن ${code || "الإعلان"} انباع؟`;
  if (tool === "delete_listing") return `نأكد حذف ${code || "الإعلان"}؟`;
  if (tool === "submit_payment_receipt") return "نأكد إرسال الإيصال للمراجعة؟";
  if (tool === "store_settings") return "نأكد حفظ تعديل إعدادات المتجر؟";
  return "تأكد الإجراء؟";
}

export async function applyHeuristicPlan(
  plan: HeuristicPlan,
  runtime: AgentToolRuntime,
): Promise<{
  text: string;
  unmatched: boolean;
  focusShortCode?: string;
  pendingConfirm?: PendingAgentConfirm;
  usedTools: string[];
}> {
  const run = async (name: string, args: Record<string, unknown>) => {
    const result = await executeToolCall({ id: "h", name, arguments: args }, runtime);
    return result;
  };

  switch (plan.kind) {
    case "glossary":
      return { text: plan.answer, unmatched: false, usedTools: [] };
    case "search": {
      const result = await run("search_listings", plan.filters as Record<string, unknown>);
      const parsed = JSON.parse(result.json) as { replyHint?: string };
      return { text: parsed.replyHint || "ما لقيت إعلان مطابق الحين.", unmatched: false, usedTools: ["search_listings"] };
    }
    case "get": {
      const result = await run("get_listing", { shortCode: plan.shortCode, index: plan.index });
      const parsed = JSON.parse(result.json) as { replyHint?: string; error?: string };
      return {
        text: parsed.replyHint
          ? `${parsed.replyHint}\n\nالتسليم والشراء عبر المالك فقط.`
          : parsed.error || "ما لقيت الإعلان.",
        unmatched: false,
        usedTools: ["get_listing"],
      };
    }
    case "inquire": {
      const result = await run("create_inquiry", { shortCode: plan.shortCode });
      const parsed = JSON.parse(result.json) as { message?: string; error?: string };
      return { text: parsed.message || parsed.error || "تم.", unmatched: false, usedTools: ["create_inquiry"] };
    }
    case "save_request": {
      const result = await run("save_buyer_request", {
        budgetMax: plan.budgetMax,
        skins: plan.skins,
        binding: plan.binding,
        notes: plan.notes,
      });
      const parsed = JSON.parse(result.json) as { message?: string };
      return { text: parsed.message || "تم تسجيل الطلب.", unmatched: false, usedTools: ["save_buyer_request"] };
    }
    case "start_listing": {
      const result = await run("start_listing", {
        description: plan.description,
        price: plan.price,
        binding: plan.binding,
      });
      const parsed = JSON.parse(result.json) as { message?: string; error?: string };
      return { text: parsed.message || parsed.error || "تم.", unmatched: false, usedTools: ["start_listing"] };
    }
    case "update_draft": {
      const result = await run("update_listing_draft", {
        description: plan.description,
        price: plan.price,
        binding: plan.binding,
      });
      const parsed = JSON.parse(result.json) as { message?: string; error?: string };
      return { text: parsed.message || parsed.error || "تم.", unmatched: false, usedTools: ["update_listing_draft"] };
    }
    case "publish": {
      const result = await run("publish_listing", {});
      return {
        text: result.finalText || JSON.parse(result.json).message || JSON.parse(result.json).error || "تم.",
        unmatched: false,
        pendingConfirm: result.pendingConfirm,
        usedTools: ["publish_listing"],
      };
    }
    case "mark_sold": {
      const result = await run("mark_sold", { shortCode: plan.shortCode });
      return {
        text: result.finalText || JSON.parse(result.json).message || JSON.parse(result.json).error || "تم.",
        unmatched: false,
        pendingConfirm: result.pendingConfirm,
        usedTools: ["mark_sold"],
      };
    }
    case "delete_listing": {
      const result = await run("delete_listing", { shortCode: plan.shortCode });
      return {
        text: result.finalText || JSON.parse(result.json).message || JSON.parse(result.json).error || "تم.",
        unmatched: false,
        pendingConfirm: result.pendingConfirm,
        usedTools: ["delete_listing"],
      };
    }
    case "seller_reply": {
      const result = await run("seller_reply", { available: plan.available, price: plan.price });
      const parsed = JSON.parse(result.json) as { message?: string; error?: string };
      return { text: parsed.message || parsed.error || "تم.", unmatched: false, usedTools: ["seller_reply"] };
    }
    case "store_settings": {
      const result = await run("store_settings", plan.patch);
      return {
        text: result.finalText || JSON.parse(result.json).message || JSON.parse(result.json).error || "تم.",
        unmatched: false,
        pendingConfirm: result.pendingConfirm,
        usedTools: ["store_settings"],
      };
    }
    case "subscription": {
      const result = await run("subscription_status", {});
      const parsed = JSON.parse(result.json) as { message?: string; error?: string };
      return { text: parsed.message || parsed.error || "تم.", unmatched: false, usedTools: ["subscription_status"] };
    }
    case "list_listings": {
      const result = await run("list_store_listings", {});
      const parsed = JSON.parse(result.json) as { message?: string; error?: string };
      return { text: parsed.message || parsed.error || "تم.", unmatched: false, usedTools: ["list_store_listings"] };
    }
    case "list_inquiries": {
      const result = await run("list_inquiries", {});
      const parsed = JSON.parse(result.json) as { message?: string; error?: string };
      return { text: parsed.message || parsed.error || "تم.", unmatched: false, usedTools: ["list_inquiries"] };
    }
    case "store_stats": {
      const result = await run("store_stats", {});
      const parsed = JSON.parse(result.json) as { message?: string; error?: string };
      return { text: parsed.message || parsed.error || "تم.", unmatched: false, usedTools: ["store_stats"] };
    }
    case "list_stores": {
      const result = await run("list_stores", {});
      const parsed = JSON.parse(result.json) as { message?: string; error?: string };
      return { text: parsed.message || parsed.error || "تم.", unmatched: false, usedTools: ["list_stores"] };
    }
    case "owner_help": {
      const result = await run("owner_help", { topic: plan.topic });
      const parsed = JSON.parse(result.json) as { message?: string; error?: string };
      return { text: parsed.message || parsed.error || "تم.", unmatched: false, usedTools: ["owner_help"] };
    }
    case "receipt": {
      const result = await run("submit_payment_receipt", { kind: plan.receiptKind });
      return {
        text: result.finalText || JSON.parse(result.json).message || JSON.parse(result.json).error || "تم.",
        unmatched: false,
        pendingConfirm: result.pendingConfirm,
        usedTools: ["submit_payment_receipt"],
      };
    }
    case "clarify":
      return { text: plan.question || CLARIFY_QUESTION, unmatched: true, usedTools: ["ask_clarification"] };
  }
}

export function planToTool(plan: HeuristicPlan): string {
  switch (plan.kind) {
    case "glossary":
      return "glossary";
    case "search":
      return "search_listings";
    case "get":
      return "get_listing";
    case "inquire":
      return "create_inquiry";
    case "save_request":
      return "save_buyer_request";
    case "start_listing":
      return "start_listing";
    case "update_draft":
      return "update_listing_draft";
    case "publish":
      return "publish_listing";
    case "mark_sold":
      return "mark_sold";
    case "delete_listing":
      return "delete_listing";
    case "seller_reply":
      return "seller_reply";
    case "store_settings":
      return "store_settings";
    case "subscription":
      return "subscription_status";
    case "receipt":
      return "submit_payment_receipt";
    case "list_listings":
      return "list_store_listings";
    case "list_inquiries":
      return "list_inquiries";
    case "store_stats":
      return "store_stats";
    case "list_stores":
      return "list_stores";
    case "owner_help":
      return "owner_help";
    case "clarify":
      return "ask_clarification";
  }
}
