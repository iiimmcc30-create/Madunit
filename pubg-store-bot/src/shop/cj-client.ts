import { readFileSync, writeFileSync } from "node:fs";

/** CJdropshipping API v2 client. Docs: https://developers.cjdropshipping.com/en/api/api2/ */
export const CJ_BASE = "https://developers.cjdropshipping.com/api2.0/v1";

export interface CjEnvelope<T> {
  code: number;
  result: boolean;
  message: string;
  data: T;
  requestId?: string;
}

export class CjError extends Error {
  constructor(
    message: string,
    readonly code?: number,
    readonly requestId?: string,
  ) {
    super(message);
  }
}

export interface CjListProduct {
  id: string;
  nameEn: string;
  sku: string;
  bigImage: string;
  sellPrice: string;
  nowPrice?: string;
  listedNum?: number;
  threeCategoryName?: string;
  warehouseInventoryNum?: number;
  addMarkStatus?: number;
  deliveryCycle?: string;
}

export interface CjVariant {
  vid: string;
  pid: string;
  variantNameEn?: string;
  variantSku?: string;
  variantImage?: string;
  variantSellPrice?: number | string;
  variantKey?: string;
}

export interface CjProductDetail {
  pid: string;
  productNameEn: string;
  productSku?: string;
  productImage?: string | string[];
  productImageSet?: string[];
  sellPrice?: string | number;
  description?: string;
  categoryName?: string;
  listedNum?: number;
  variants?: CjVariant[];
}

export interface CjFreightOption {
  logisticName: string;
  logisticPrice: number;
  logisticAging?: string;
  totalPostageFee?: number;
}

export interface CjCreateOrderInput {
  orderNumber: string;
  shippingCountryCode: string;
  shippingCountry: string;
  shippingProvince: string;
  shippingCity: string;
  shippingAddress: string;
  shippingAddress2?: string;
  shippingZip?: string;
  shippingCustomerName: string;
  shippingPhone: string;
  logisticName: string;
  fromCountryCode: string;
  remark?: string;
  /** 2 = pay from CJ balance, 3 = create only (pay manually in CJ). */
  payType?: 2 | 3;
  products: { vid: string; quantity: number; storeLineItemId?: string }[];
}

export interface CjOrderDetail {
  orderId: string;
  orderNum?: string;
  orderStatus?: string;
  trackNumber?: string | null;
  logisticName?: string;
  orderAmount?: number;
}

type FetchLike = typeof fetch;

export interface CjClientOptions {
  apiKey: string;
  fetchImpl?: FetchLike;
  /** Optional JSON file to persist the access token (CJ rate-limits getAccessToken). */
  tokenCacheFile?: string;
  /** Minimum ms between calls (CJ QPS=1 on most endpoints). */
  minIntervalMs?: number;
  baseUrl?: string;
  /** Retries on CJ "Too Many Requests" (default 3). */
  retries?: number;
  retryDelayMs?: number;
}

interface TokenState {
  accessToken: string;
  expiresAt: number;
  keyHint: string;
}

export class CjClient {
  private token: TokenState | null = null;
  private tokenPromise: Promise<string> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private lastCall = 0;
  private readonly fetchImpl: FetchLike;
  private readonly base: string;

  constructor(private readonly options: CjClientOptions) {
    if (!options.apiKey) throw new CjError("CJ_API_KEY is not set");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.base = options.baseUrl ?? CJ_BASE;
    this.loadCachedToken();
  }

  private keyHint(): string {
    // Non-reversible hint so a cached token is only reused for the same key.
    let h = 0;
    for (const ch of this.options.apiKey) h = (h * 31 + ch.charCodeAt(0)) | 0;
    return String(h);
  }

  private loadCachedToken() {
    const file = this.options.tokenCacheFile;
    if (!file) return;
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as TokenState;
      if (parsed.keyHint === this.keyHint() && parsed.expiresAt > Date.now() + 3600_000) this.token = parsed;
    } catch {
      /* no cache */
    }
  }

  private saveCachedToken() {
    const file = this.options.tokenCacheFile;
    if (!file || !this.token) return;
    try {
      writeFileSync(file, JSON.stringify(this.token), { mode: 0o600 });
    } catch {
      /* ignore */
    }
  }

  private schedule<T>(fn: () => Promise<T>): Promise<T> {
    const gap = this.options.minIntervalMs ?? 1100;
    const run = async () => {
      const wait = this.lastCall + gap - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastCall = Date.now();
      return fn();
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async raw<T>(method: "GET" | "POST", path: string, body?: unknown, auth = true): Promise<T> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (auth) {
      const token = await this.accessToken();
      headers["CJ-Access-Token"] = token;
      headers.platformToken = "";
    }
    const attempts = this.options.retries ?? 3;
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.schedule(async () => {
          const res = await this.fetchImpl(`${this.base}${path}`, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
          });
          const json = (await res.json()) as CjEnvelope<T>;
          if (!json.result || (json.code !== 200 && json.code !== 0)) {
            throw new CjError(`CJ ${path}: ${json.message}`, json.code, json.requestId);
          }
          return json.data;
        });
      } catch (error) {
        const limited = error instanceof CjError && /too many requests/i.test(error.message);
        if (!limited || attempt >= attempts) throw error;
        await new Promise((r) => setTimeout(r, (this.options.retryDelayMs ?? 3000) * (attempt + 1)));
      }
    }
  }

  async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.accessToken;
    if (!this.tokenPromise) {
      this.tokenPromise = this.raw<{ accessToken: string; accessTokenExpiryDate?: string }>(
        "POST",
        "/authentication/getAccessToken",
        { apiKey: this.options.apiKey },
        false,
      )
        .then((data) => {
          const exp = data.accessTokenExpiryDate ? Date.parse(data.accessTokenExpiryDate) : NaN;
          this.token = {
            accessToken: data.accessToken,
            expiresAt: Number.isFinite(exp) ? exp : Date.now() + 14 * 86400_000,
            keyHint: this.keyHint(),
          };
          this.saveCachedToken();
          return data.accessToken;
        })
        .finally(() => {
          this.tokenPromise = null;
        });
    }
    return this.tokenPromise;
  }

  listProducts(params: {
    keyWord?: string;
    page?: number;
    size?: number;
    orderBy?: 0 | 1 | 2 | 3 | 4;
    sort?: "asc" | "desc";
    countryCode?: string;
    categoryId?: string;
  }) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") q.set(k, String(v));
    return this.raw<{
      totalRecords: number;
      content: { productList: CjListProduct[] }[];
    }>("GET", `/product/listV2?${q}`).then((d) => ({
      total: d.totalRecords,
      products: (d.content ?? []).flatMap((c) => c.productList ?? []),
    }));
  }

  productDetail(pid: string) {
    return this.raw<CjProductDetail>("GET", `/product/query?pid=${encodeURIComponent(pid)}`);
  }

  variants(pid: string) {
    return this.raw<CjVariant[]>("GET", `/product/variant/query?pid=${encodeURIComponent(pid)}`);
  }

  variantStock(vid: string) {
    return this.raw<{ countryCode?: string; storageNum?: number; totalInventoryNum?: number }[]>(
      "GET",
      `/product/stock/queryByVid?vid=${encodeURIComponent(vid)}`,
    ).then((rows) =>
      (rows ?? []).reduce((sum, r) => sum + Number(r.totalInventoryNum ?? r.storageNum ?? 0), 0),
    );
  }

  freight(input: { endCountryCode: string; startCountryCode?: string; zip?: string; products: { vid: string; quantity: number }[] }) {
    return this.raw<CjFreightOption[]>("POST", "/logistic/freightCalculate", {
      startCountryCode: input.startCountryCode ?? "CN",
      endCountryCode: input.endCountryCode,
      zip: input.zip,
      products: input.products,
    });
  }

  createOrder(input: CjCreateOrderInput) {
    return this.raw<{ orderId: string; orderNumber?: string; orderStatus?: string }>(
      "POST",
      "/shopping/order/createOrderV2",
      { payType: 3, platform: "custom", ...input },
    );
  }

  orderDetail(orderId: string) {
    return this.raw<CjOrderDetail>("GET", `/shopping/order/getOrderDetail?orderId=${encodeURIComponent(orderId)}`);
  }

  trackInfo(trackNumber: string) {
    return this.raw<{ trackingNumber: string; trackingStatus?: string; deliveryDay?: string }[]>(
      "GET",
      `/logistic/trackInfo?trackNumber=${encodeURIComponent(trackNumber)}`,
    );
  }
}

/** Accepts a raw CJ pid or a cjdropshipping.com product URL (…-p-<PID>.html or ?id=<PID>). */
export function parseCjProductRef(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  const uuid = s.match(/[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}/i);
  if (uuid) return uuid[0].toUpperCase();
  const p = s.match(/-p-(\d{6,})\.html/i) ?? s.match(/[?&](?:id|pid)=([A-Za-z0-9-]+)/);
  if (p) return p[1];
  if (/^[A-Za-z0-9-]{6,}$/.test(s)) return s;
  return null;
}
