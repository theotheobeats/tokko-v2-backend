/**
 * SingaPay payment provider client (hosted payment links API).
 *
 * Maps the provider-agnostic PaymentProviderClient to SingaPay:
 *   createInvoice → POST /api/v1.0/payment-link-manage/{account_id}
 *   getInvoice    → GET  /api/v1.0/payment-link-manage/{account_id} (match reff_no)
 *
 * Auth: OAuth 2.0 client-credentials JWT via POST /api/v1.1/access-token/b2b,
 * authenticated with an HMAC-SHA512 `X-Signature` header. Tokens are cached
 * until expiry (module-level, per isolate).
 *
 * Sandbox-safe: real calls when SINGAPAY_CLIENT_ID + SINGAPAY_CLIENT_SECRET
 * are configured; a deterministic mock otherwise (same pattern as Xendit).
 *
 * Env:
 *   SINGAPAY_CLIENT_ID      (secret) — merchant client_id
 *   SINGAPAY_CLIENT_SECRET  (secret) — signs the X-Signature HMAC
 *   SINGAPAY_PARTNER_ID     (secret) — X-PARTNER-ID merchant API key
 *   SINGAPAY_ACCOUNT_ID     (var)    — account ULID used in URL paths
 *   SINGAPAY_API_URL        (var)    — API base (defaults to sandbox host)
 *   SINGAPAY_KYB_URL_BASE   (var)    — host for merchant KYB self-onboarding
 *                                     links (defaults to sandbox payment-link
 *                                     host — SingaPay echoes the caller's Host,
 *                                     which through a proxy is unusable)
 *   SINGAPAY_PROXY_URL      (var)    — optional static-IP reverse proxy (VPS)
 *                                     — overrides the API base so SingaPay sees
 *                                     the proxy's fixed egress IP
 *   SINGAPAY_PROXY_TOKEN    (secret) — optional shared secret the proxy
 *                                     requires (sent as X-Proxy-Token header)
 *   SINGAPAY_WEBHOOK_SECRET (secret) — webhook signature verification (Phase 2)
 *   SINGAPAY_FORCE_MOCK     (var)    — "1" forces mock even with keys
 */

import type {
  CreateInvoiceInput,
  InvoiceResult,
  InvoiceStatusResult,
  PaymentProviderClient,
} from "./xendit-client";
import { encodeSingaPayRef } from "./singapay-ref";

export interface SingaPayEnv {
  SINGAPAY_CLIENT_ID?: string;
  SINGAPAY_CLIENT_SECRET?: string;
  SINGAPAY_PARTNER_ID?: string;
  SINGAPAY_ACCOUNT_ID?: string;
  SINGAPAY_API_URL?: string;
  /** Base host for merchant KYB links (SingaPay echoes the caller's Host). */
  SINGAPAY_KYB_URL_BASE?: string;
  /** Optional static-IP reverse proxy (VPS) — overrides the API base. */
  SINGAPAY_PROXY_URL?: string;
  /** Optional shared secret the proxy requires (X-Proxy-Token header). */
  SINGAPAY_PROXY_TOKEN?: string;
  SINGAPAY_WEBHOOK_SECRET?: string;
  SINGAPAY_FORCE_MOCK?: string;
  NODE_ENV?: string;
}

/** Sandbox API host (production base is configured via SINGAPAY_API_URL). */
const DEFAULT_API_URL = "https://sandbox-payment-b2b.singapay.id";

/**
 * SingaPay builds kyb_onboarding_url from the caller's Host header — through
 * a proxy (or any foreign Host) the link would point at the wrong origin.
 * Rebuild it on the API host's origin: that is where the real
 * "Business Verification" form lives (the payment-link host serves an SPA
 * that 404s the KYB route client-side).
 */
function normalizeKybUrl(url: string | null | undefined, kybBase: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const base = new URL(kybBase ?? DEFAULT_API_URL);
    u.protocol = base.protocol;
    u.host = base.host;
    return u.toString();
  } catch {
    return null;
  }
}

/** SingaPay's standard response envelope: { status, success, data }. */
interface SingaPayEnvelope<T> {
  status: number;
  success: boolean;
  data: T;
}

/** Payment link resource (subset we read). */
interface SingaPayPaymentLink {
  reff_no: string;
  payment_url: string;
  status?: string;
  is_expired?: boolean;
  current_usage?: number;
  payment_date?: string | null;
}

/** Managed sub-account (merchant KYB). */
export interface SingaPayAccount {
  id: string;
  name: string;
  status: string; // active | inactive
  account_type?: string | null; // owned | partner | personal_managed | business_managed
  kyb_status?: string | null; // kyb_in_review | kyb_verified
  kyb_onboarding_url?: string | null;
  legal_name?: string | null;
  brand_name?: string | null;
}

/** Live payment-methods catalog entry (SingaPay does not publish fee rates via API). */
export interface SingaPayPaymentMethod {
  code: string;
  name: string;
  group: string;
  desc?: string | null;
}

export interface SingaPayPaymentMethodCatalog {
  payment_methods: SingaPayPaymentMethod[];
  available_codes: string[];
}

/** Real payments are used whenever a full credential set is configured. */
export function useRealSingaPay(env: SingaPayEnv): boolean {
  if (env.SINGAPAY_FORCE_MOCK === "1" || env.SINGAPAY_FORCE_MOCK === "true") return false;
  return !!env.SINGAPAY_CLIENT_ID && !!env.SINGAPAY_CLIENT_SECRET;
}

/**
 * Best-effort SingaPay payment-link codes per catalog id. The authoritative
 * list is account-specific — GET /api/v1.0/payment-link-manage/payment-methods
 * returns the account's `available_codes`; keep this map in sync when the
 * account catalog changes. Unknown ids are dropped; if nothing maps, the
 * whitelist is omitted (all active methods allowed).
 */
export const SINGAPAY_METHOD_CODES: Record<string, string[]> = {
  qris: ["QRIS"],
  bca: ["VA_BCA"],
  mandiri: ["VA_MANDIRI"],
  bni: ["VA_BNI"],
  bri: ["VA_BRI"],
  ovo: ["OVO"],
  gopay: ["GOPAY"],
  dana: ["DANA"],
  shopeepay: ["SHOPEEPAY"],
  credit_card: ["CARD"],
};

/** Catalog ids → SingaPay codes; undefined = no whitelist (all methods). */
function resolveSingaPayMethodCodes(input: CreateInvoiceInput): string[] | undefined {
  if (!input.paymentMethodIds?.length) return undefined; // allow all active
  const codes = input.paymentMethodIds.flatMap((id) => SINGAPAY_METHOD_CODES[id] ?? []);
  return codes.length ? codes : undefined;
}

/** Module-level access-token cache (per isolate), keyed by client id. */
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function hmacSha512Hex(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const keyBuf = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", keyBuf, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Shared HMAC-SHA512 hex helper (also used by webhook signature verification). */
export { hmacSha512Hex };

export class SingaPayClient implements PaymentProviderClient {
  constructor(
    private readonly creds: {
      clientId: string;
      clientSecret: string;
      partnerId: string;
      accountId: string;
      apiUrl: string;
      /** Shared secret for a VPS proxy (sent as X-Proxy-Token). */
      proxyToken?: string;
      /** Base host for merchant KYB links (normalized after provider echo). */
      kybUrlBase?: string;
    },
  ) {}

  /**
   * OAuth2 client-credentials JWT. X-Signature is the lowercase hex
   * HMAC-SHA512 of `{client_id}_{client_secret}_{YYYYMMDD}` signed with the
   * client_secret, valid for the current date.
   */
  private async accessToken(): Promise<string> {
    const { clientId, clientSecret, partnerId, apiUrl } = this.creds;

    const cached = tokenCache.get(clientId);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const signature = await hmacSha512Hex(clientSecret, `${clientId}_${clientSecret}_${date}`);

    const res = await fetch(`${apiUrl}/api/v1.1/access-token/b2b`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-PARTNER-ID": partnerId,
        "X-CLIENT-ID": clientId,
        "X-Signature": signature,
        ...(this.creds.proxyToken ? { "X-Proxy-Token": this.creds.proxyToken } : {}),
      },
      body: JSON.stringify({ grant_type: "client_credentials" }),
    });
    const body = (await res.json().catch(() => null)) as SingaPayEnvelope<{
      access_token?: string;
      expires_in?: string;
    }> | null;

    if (!res.ok || !body?.success || !body.data?.access_token) {
      throw new Error(`SingaPay auth ${res.status}: ${JSON.stringify(body ?? "no response").slice(0, 200)}`);
    }

    const expiresIn = Number(body.data.expires_in ?? 3600);
    tokenCache.set(clientId, { token: body.data.access_token, expiresAt: Date.now() + expiresIn * 1000 });
    return body.data.access_token;
  }

  /** Authenticated request — attaches Bearer token + X-PARTNER-ID. */
  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await this.accessToken();
    const res = await fetch(`${this.creds.apiUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "X-PARTNER-ID": this.creds.partnerId,
        Authorization: `Bearer ${token}`,
        ...(this.creds.proxyToken ? { "X-Proxy-Token": this.creds.proxyToken } : {}),
        ...init?.headers,
      },
    });
    const body = (await res.json().catch(() => null)) as SingaPayEnvelope<T> | null;
    if (!res.ok || !body?.success) {
      throw new Error(`SingaPay ${res.status}: ${JSON.stringify(body ?? "no response").slice(0, 300)}`);
    }
    return body.data;
  }

  async createInvoice(input: CreateInvoiceInput): Promise<InvoiceResult> {
    // 24h expiry — matches Xendit's default invoice lifetime.
    const expiredAt = Date.now() + 24 * 60 * 60 * 1000;
    const label = input.description || "Pesanan 7okko";
    // Plan external ids are >40 chars (SingaPay's reff_no cap) — encode them
    // into a compact 33-char ref; the webhook decodes it back.
    const reffNo =
      input.externalId.length > 40 ? encodeSingaPayRef(input.externalId) : input.externalId;

    const data = await this.request<SingaPayPaymentLink>(
      `/api/v1.0/payment-link-manage/${input.accountId ?? this.creds.accountId}`,
      {
        method: "POST",
        body: JSON.stringify({
          reff_no: reffNo,
          title: label,
          required_customer_detail: true,
          customer_pays_fee: false,
          max_usage: 1, // single successful payment per link
          expired_at: expiredAt,
          total_amount: input.amount,
          items: [{ name: label, quantity: 1, unit_price: input.amount }],
          ...(resolveSingaPayMethodCodes(input)?.length
            ? { whitelisted_payment_method: resolveSingaPayMethodCodes(input) }
            : {}),
          ...(input.successRedirectUrl ? { success_redirect_url: input.successRedirectUrl } : {}),
          ...(input.failureRedirectUrl ? { expired_redirect_url: input.failureRedirectUrl } : {}),
        }),
      },
    );

    return {
      // Always the canonical external id (orders pass through; plan ids are
      // reconstructed on the webhook via decodeSingaPayRef).
      externalId: input.externalId,
      invoiceUrl: data.payment_url,
    };
  }

  async getInvoice(externalId: string, accountId?: string): Promise<InvoiceStatusResult> {
    // List the account's payment links (newest first) and match our ref.
    // The primary status path is the webhook; this is only the reconcile
    // fallback (lost webhooks / admin sync), so page 1 is sufficient.
    const links = await this.request<SingaPayPaymentLink[]>(
      `/api/v1.0/payment-link-manage/${accountId ?? this.creds.accountId}`,
      { method: "GET" },
    );

    const ref = externalId.length > 40 ? encodeSingaPayRef(externalId) : externalId;
    const link = (links ?? []).find((l) => l.reff_no === ref);
    if (!link) return { status: "PENDING" }; // created but not yet visible / no attempt
    // current_usage is the reliable paid indicator — SingaPay populates
    // payment_date with created_at at creation, so it can't be trusted alone.
    if ((link.current_usage ?? 0) > 0) return { status: "PAID", paidAt: link.payment_date ?? undefined };
    if (link.is_expired) return { status: "EXPIRED" };
    return { status: "PENDING" };
  }

  /** Create a managed sub-account for a merchant (starts the BOSS KYB flow). */
  async createSubAccount(input: {
    name: string;
    accountType: "personal_managed" | "business_managed";
    inviteMembers?: string[];
  }): Promise<SingaPayAccount> {
    const account = await this.request<SingaPayAccount>("/api/v1.0/accounts", {
      method: "POST",
      body: JSON.stringify({
        name: input.name,
        account_type: input.accountType,
        ...(input.inviteMembers?.length ? { invite_members: input.inviteMembers } : {}),
      }),
    });
    return {
      ...account,
      kyb_onboarding_url: normalizeKybUrl(account.kyb_onboarding_url, this.creds.kybUrlBase),
    };
  }

  /** Fetch a sub-account (KYB status, onboarding URL, legal/brand names). */
  async getAccount(accountId: string): Promise<SingaPayAccount> {
    const account = await this.request<SingaPayAccount>(
      `/api/v1.0/accounts/${encodeURIComponent(accountId)}`,
      { method: "GET" },
    );
    return {
      ...account,
      kyb_onboarding_url: normalizeKybUrl(account.kyb_onboarding_url, this.creds.kybUrlBase),
    };
  }

  /** Live payment-methods catalog for this account (codes/names/groups). */
  async listPaymentMethods(): Promise<SingaPayPaymentMethodCatalog> {
    return this.request<SingaPayPaymentMethodCatalog>(
      "/api/v1.0/payment-link-manage/payment-methods",
      { method: "GET" },
    );
  }
}

/**
 * Deterministic mock for dev/tests — no network, no keys.
 * Generates a realistic-looking hosted payment URL (not reachable).
 */
export class MockSingaPayProvider implements PaymentProviderClient {
  constructor(private readonly prefix = "mock") {}

  async createSubAccount(input: {
    name: string;
    accountType: "personal_managed" | "business_managed";
  }): Promise<SingaPayAccount> {
    return {
      id: `mock-acc-${Date.now()}`,
      name: input.name,
      status: "inactive",
      account_type: input.accountType,
      kyb_status: "kyb_in_review",
      kyb_onboarding_url: `https://checkout.payments.test/kyb/${this.prefix}`,
    };
  }

  async getAccount(accountId: string): Promise<SingaPayAccount> {
    return {
      id: accountId,
      name: "Mock",
      status: "inactive",
      kyb_status: "kyb_in_review",
      kyb_onboarding_url: `https://checkout.payments.test/kyb/${this.prefix}`,
    };
  }

  async listPaymentMethods(): Promise<SingaPayPaymentMethodCatalog> {
    return {
      payment_methods: [
        { code: "QRIS", name: "QRIS", group: "QRIS" },
        { code: "VA_BRI", name: "VA BRI", group: "va" },
        { code: "GOPAY", name: "GoPay", group: "ewallet" },
      ],
      available_codes: ["QRIS", "VA_BRI", "GOPAY"],
    };
  }

  async createInvoice(input: CreateInvoiceInput): Promise<InvoiceResult> {
    return {
      externalId: input.externalId,
      invoiceUrl: `https://checkout.payments.test/sp/${this.prefix}-${input.externalId}`,
    };
  }

  async getInvoice(_externalId: string): Promise<InvoiceStatusResult> {
    return { status: "PENDING" };
  }
}

/** Pick the client based on env: full credentials → real; else mock. */
export function createSingaPayProvider(env: SingaPayEnv): PaymentProviderClient {
  if (useRealSingaPay(env) && env.SINGAPAY_CLIENT_ID && env.SINGAPAY_CLIENT_SECRET) {
    return new SingaPayClient({
      clientId: env.SINGAPAY_CLIENT_ID,
      clientSecret: env.SINGAPAY_CLIENT_SECRET,
      partnerId: env.SINGAPAY_PARTNER_ID ?? "",
      accountId: env.SINGAPAY_ACCOUNT_ID ?? "",
      // Proxy URL overrides the API base so SingaPay sees the proxy's static IP.
      apiUrl: env.SINGAPAY_PROXY_URL ?? env.SINGAPAY_API_URL ?? DEFAULT_API_URL,
      proxyToken: env.SINGAPAY_PROXY_TOKEN,
      // KYB links are served by the API host itself ("Business Verification") —
      // never the proxy (it only forwards /singapay/*) or a separate link host.
      kybUrlBase: env.SINGAPAY_KYB_URL_BASE ?? new URL(env.SINGAPAY_API_URL ?? DEFAULT_API_URL).origin,
    });
  }
  return new MockSingaPayProvider();
}

/** Client surface for merchant KYB (real or mock — both implement it). */
export interface SingaPayAccountsClientLike {
  createSubAccount(input: {
    name: string;
    accountType: "personal_managed" | "business_managed";
  }): Promise<SingaPayAccount>;
  getAccount(accountId: string): Promise<SingaPayAccount>;
  listPaymentMethods(): Promise<SingaPayPaymentMethodCatalog>;
}

/** Create a SingaPay client for merchant KYB flows (real or mock). */
export function createSingaPayAccountsClient(env: SingaPayEnv): SingaPayAccountsClientLike {
  return createSingaPayProvider(env) as unknown as SingaPayAccountsClientLike;
}
