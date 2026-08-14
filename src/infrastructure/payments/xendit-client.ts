/**
 * Xendit payment provider client.
 *
 * Uses the Invoices API (hosted checkout page). Sandbox-safe: real calls
 * when a XENDIT_SECRET_KEY is configured; a deterministic mock otherwise
 * (mirrors the AI layer's mock pattern so dev/tests work without keys).
 *
 * Env:
 *   XENDIT_SECRET_KEY    (secret) — sandbox or production secret key
 *   XENDIT_WEBHOOK_TOKEN (secret) — verified on incoming webhooks
 *   XENDIT_FORCE_MOCK    (var)    — "1" forces mock even with a key
 */

export interface CreateInvoiceInput {
  externalId: string;
  amount: number;
  description: string;
  customer?: { givenNames?: string; email?: string; mobileNumber?: string };
  /** Our catalog method ids enabled for this store (e.g. ["qris", "bca"]). */
  paymentMethodIds?: string[];
  /** Legacy channel shortcut (qris | bank_transfer | ewallet | credit_card). */
  channel?: string | null;
  /** Provider account to bill under (merchant sub-account; default = platform). */
  accountId?: string;
  successRedirectUrl?: string;
  failureRedirectUrl?: string;
}

export interface InvoiceResult {
  externalId: string;
  invoiceUrl: string;
}

export type XenditInvoiceStatus = "PENDING" | "PAID" | "EXPIRED" | "FAILED";

export interface InvoiceStatusResult {
  status: XenditInvoiceStatus;
  paidAt?: string;
  paymentMethod?: string;
}

export interface PaymentProviderClient {
  createInvoice(input: CreateInvoiceInput): Promise<InvoiceResult>;
  getInvoice(externalId: string, accountId?: string): Promise<InvoiceStatusResult>;
}

export interface XenditEnv {
  XENDIT_SECRET_KEY?: string;
  XENDIT_WEBHOOK_TOKEN?: string;
  XENDIT_FORCE_MOCK?: string;
  NODE_ENV?: string;
}

/** Xendit invoice payment_methods codes per catalog id. */
const XENDIT_METHOD_CODES: Record<string, string[]> = {
  qris: ["QRIS"],
  bca: ["BANK_BCA"],
  mandiri: ["BANK_MANDIRI"],
  bni: ["BANK_BNI"],
  bri: ["BANK_BRI"],
  ovo: ["EWALLET_OVO"],
  gopay: ["EWALLET_GOPAY"],
  dana: ["EWALLET_DANA"],
  shopeepay: ["EWALLET_SHOPEEPAY"],
  credit_card: ["CREDIT_CARD"],
};

/** Legacy channel shortcut → Xendit codes. */
const XENDIT_CHANNEL_CODES: Record<string, string[]> = {
  qris: ["QRIS"],
  bank_transfer: ["BANK_TRANSFER"],
  ewallet: ["EWALLET"],
  credit_card: ["CREDIT_CARD"],
};

/** Catalog ids / channel → Xendit payment_methods codes (unknowns dropped). */
function resolveXenditMethodCodes(input: CreateInvoiceInput): string[] | undefined {
  if (input.paymentMethodIds?.length) {
    const codes = input.paymentMethodIds.flatMap((id) => XENDIT_METHOD_CODES[id] ?? []);
    return codes.length ? codes : undefined;
  }
  if (input.channel) return XENDIT_CHANNEL_CODES[input.channel];
  return undefined;
}

const XENDIT_API = "https://api.xendit.co";

/** Real payments are used whenever a non-mock key is configured. */
export function useRealPayments(env: XenditEnv): boolean {
  if (env.XENDIT_FORCE_MOCK === "1" || env.XENDIT_FORCE_MOCK === "true") return false;
  const key = env.XENDIT_SECRET_KEY;
  return !!key && !key.startsWith("xnd_mock");
}

export class XenditClient implements PaymentProviderClient {
  constructor(private readonly secretKey: string) {}

  private async request(path: string, init?: RequestInit): Promise<any> {
    const res = await fetch(`${XENDIT_API}${path}`, {
      ...init,
      headers: {
        Authorization: `Basic ${btoa(`${this.secretKey}:`)}`,
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Xendit ${res.status}: ${body.slice(0, 300)}`);
    }
    return res.json();
  }

  async createInvoice(input: CreateInvoiceInput): Promise<InvoiceResult> {
    const data = await this.request("/v2/invoices", {
      method: "POST",
      body: JSON.stringify({
        external_id: input.externalId,
        amount: input.amount,
        currency: "IDR",
        description: input.description,
        ...(input.customer
          ? {
              customer: {
                given_names: input.customer.givenNames,
                email: input.customer.email,
                mobile_number: input.customer.mobileNumber,
              },
            }
          : {}),
        ...(resolveXenditMethodCodes(input)?.length
          ? { payment_methods: resolveXenditMethodCodes(input) }
          : {}),
        ...(input.successRedirectUrl ? { success_redirect_url: input.successRedirectUrl } : {}),
        ...(input.failureRedirectUrl ? { failure_redirect_url: input.failureRedirectUrl } : {}),
      }),
    });

    return {
      externalId: data.external_id,
      invoiceUrl: data.invoice_url,
    };
  }

  async getInvoice(externalId: string): Promise<InvoiceStatusResult> {
    const data = await this.request(`/v2/invoices/${encodeURIComponent(externalId)}`);
    return {
      status: data.status,
      paidAt: data.paid_at,
      paymentMethod: data.payment_method,
    };
  }
}

/**
 * Deterministic mock for dev/tests — no network, no keys.
 * Generates a realistic-looking invoice URL (not reachable).
 */
export class MockXenditClient implements PaymentProviderClient {
  constructor(private readonly prefix = "xnd_mock") {}

  async createInvoice(input: CreateInvoiceInput): Promise<InvoiceResult> {
    return {
      externalId: input.externalId,
      invoiceUrl: `https://checkout.xendit.co/web/${this.prefix}-${input.externalId}`,
    };
  }

  async getInvoice(_externalId: string): Promise<InvoiceStatusResult> {
    return { status: "PENDING" };
  }
}

/**
 * Production without a configured key — payments are unavailable and must
 * fail loudly, NOT pretend with a dead mock URL (customers would click a
 * fake checkout page). The UI falls back to the WhatsApp flow.
 */
export class UnavailablePaymentProvider implements PaymentProviderClient {
  async createInvoice(): Promise<InvoiceResult> {
    throw new Error("Pembayaran online belum tersedia di toko ini");
  }

  async getInvoice(): Promise<InvoiceStatusResult> {
    throw new Error("Pembayaran online belum tersedia di toko ini");
  }
}

/** Pick the client based on env: real key → Xendit; dev/test → mock; prod → unavailable. */
export function createPaymentProvider(env: XenditEnv): PaymentProviderClient {
  const key = env.XENDIT_SECRET_KEY;
  if (useRealPayments(env) && key) return new XenditClient(key);
  if (env.NODE_ENV === "production") return new UnavailablePaymentProvider();
  return new MockXenditClient();
}
