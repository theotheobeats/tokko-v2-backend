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
 *   SINGAPAY_WEBHOOK_SECRET (secret) — webhook signature verification (Phase 2)
 *   SINGAPAY_FORCE_MOCK     (var)    — "1" forces mock even with keys
 */

import type {
  CreateInvoiceInput,
  InvoiceResult,
  InvoiceStatusResult,
  PaymentProviderClient,
} from "./xendit-client";

export interface SingaPayEnv {
  SINGAPAY_CLIENT_ID?: string;
  SINGAPAY_CLIENT_SECRET?: string;
  SINGAPAY_PARTNER_ID?: string;
  SINGAPAY_ACCOUNT_ID?: string;
  SINGAPAY_API_URL?: string;
  SINGAPAY_WEBHOOK_SECRET?: string;
  SINGAPAY_FORCE_MOCK?: string;
  NODE_ENV?: string;
}

/** Sandbox API host (production base is configured via SINGAPAY_API_URL). */
const DEFAULT_API_URL = "https://sandbox-payment-b2b.singapay.id";

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
  payment_date?: string | null;
}

/** Real payments are used whenever a full credential set is configured. */
export function useRealSingaPay(env: SingaPayEnv): boolean {
  if (env.SINGAPAY_FORCE_MOCK === "1" || env.SINGAPAY_FORCE_MOCK === "true") return false;
  return !!env.SINGAPAY_CLIENT_ID && !!env.SINGAPAY_CLIENT_SECRET;
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

    const data = await this.request<SingaPayPaymentLink>(
      `/api/v1.0/payment-link-manage/${this.creds.accountId}`,
      {
        method: "POST",
        body: JSON.stringify({
          reff_no: input.externalId,
          title: label,
          required_customer_detail: true,
          customer_pays_fee: false,
          max_usage: 1, // single successful payment per link
          expired_at: expiredAt,
          total_amount: input.amount,
          items: [{ name: label, quantity: 1, unit_price: input.amount }],
          ...(input.successRedirectUrl ? { success_redirect_url: input.successRedirectUrl } : {}),
          ...(input.failureRedirectUrl ? { expired_redirect_url: input.failureRedirectUrl } : {}),
        }),
      },
    );

    return {
      externalId: data.reff_no ?? input.externalId,
      invoiceUrl: data.payment_url,
    };
  }

  async getInvoice(externalId: string): Promise<InvoiceStatusResult> {
    // List the account's payment links (newest first) and match our ref.
    // The primary status path is the webhook; this is only the reconcile
    // fallback (lost webhooks / admin sync), so page 1 is sufficient.
    const links = await this.request<SingaPayPaymentLink[]>(
      `/api/v1.0/payment-link-manage/${this.creds.accountId}`,
      { method: "GET" },
    );

    const link = (links ?? []).find((l) => l.reff_no === externalId);
    if (!link) return { status: "PENDING" }; // created but not yet visible / no attempt
    if (link.payment_date) return { status: "PAID", paidAt: link.payment_date };
    if (link.is_expired) return { status: "EXPIRED" };
    return { status: "PENDING" };
  }
}

/**
 * Deterministic mock for dev/tests — no network, no keys.
 * Generates a realistic-looking hosted payment URL (not reachable).
 */
export class MockSingaPayProvider implements PaymentProviderClient {
  constructor(private readonly prefix = "mock") {}

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
      apiUrl: env.SINGAPAY_API_URL ?? DEFAULT_API_URL,
    });
  }
  return new MockSingaPayProvider();
}
