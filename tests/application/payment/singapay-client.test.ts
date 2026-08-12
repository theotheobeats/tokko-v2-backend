import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  SingaPayClient,
  MockSingaPayProvider,
  createSingaPayProvider,
  useRealSingaPay,
} from "../../../src/infrastructure/payments/singapay-client";

/**
 * fetch mock — routes by URL, returns a SingaPay envelope per path.
 */
function mockFetch(routes: Record<string, unknown>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const key = Object.keys(routes).find((k) => url.includes(k));
    const payload = key ? routes[key] : { status: 404, success: false, error: { message: "not found" } };
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  return { fn, calls };
}

const creds = {
  clientId: "SGP-CLIENT-001",
  clientSecret: "s3cret",
  partnerId: "b3ed7d4b-a96c-6c08-b3c7-12c3124242d9",
  accountId: "01HZTESTACCOUNT0000000000",
  apiUrl: "https://sandbox-payment-b2b.singapay.id",
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("useRealSingaPay", () => {
  it("requires full credentials", () => {
    expect(useRealSingaPay({ SINGAPAY_CLIENT_ID: "a", SINGAPAY_CLIENT_SECRET: "b" })).toBe(true);
    expect(useRealSingaPay({ SINGAPAY_CLIENT_ID: "a" })).toBe(false);
    expect(useRealSingaPay({})).toBe(false);
  });

  it("honors the force-mock flag", () => {
    expect(
      useRealSingaPay({ SINGAPAY_CLIENT_ID: "a", SINGAPAY_CLIENT_SECRET: "b", SINGAPAY_FORCE_MOCK: "1" }),
    ).toBe(false);
  });
});

describe("SingaPayClient.createInvoice", () => {
  it("exchanges credentials for a token, then creates a payment link", async () => {
    const { fn, calls } = mockFetch({
      "/access-token/b2b": {
        status: 200,
        success: true,
        data: { access_token: "jwt-abc", token_type: "Bearer", expires_in: "216000" },
      },
      "/payment-link-manage/": {
        status: 200,
        success: true,
        data: {
          reff_no: "tokko-test-1",
          payment_url: "https://sandbox-paymentlink.singapay.id/b2b/PL123",
          title: "Pesanan TK-8F3K2",
        },
      },
    });
    vi.stubGlobal("fetch", fn);

    const client = new SingaPayClient(creds);
    const result = await client.createInvoice({
      externalId: "tokko-test-1",
      amount: 85000,
      description: "Pesanan TK-8F3K2",
      successRedirectUrl: "https://7okko.com/dashboard/orders",
    });

    expect(result.invoiceUrl).toBe("https://sandbox-paymentlink.singapay.id/b2b/PL123");
    expect(result.externalId).toBe("tokko-test-1");

    // 1. token request — signed headers
    const tokenCall = calls.find((c) => c.url.includes("access-token/b2b"));
    expect(tokenCall).toBeDefined();
    const tokenHeaders = tokenCall!.init!.headers as Record<string, string>;
    expect(tokenHeaders["X-PARTNER-ID"]).toBe(creds.partnerId);
    expect(tokenHeaders["X-CLIENT-ID"]).toBe(creds.clientId);
    expect(tokenHeaders["X-Signature"]).toMatch(/^[0-9a-f]{128}$/); // lowercase hex HMAC-SHA512
    expect(JSON.parse(String(tokenCall!.init!.body))).toEqual({ grant_type: "client_credentials" });

    // 2. payment link request — bearer + body
    const linkCall = calls.find((c) => c.url.includes("payment-link-manage/"));
    expect(linkCall).toBeDefined();
    const linkHeaders = linkCall!.init!.headers as Record<string, string>;
    expect(linkHeaders["Authorization"]).toBe("Bearer jwt-abc");
    const body = JSON.parse(String(linkCall!.init!.body));
    expect(body.reff_no).toBe("tokko-test-1");
    expect(body.total_amount).toBe(85000);
    expect(body.max_usage).toBe(1);
    expect(body.items).toEqual([{ name: "Pesanan TK-8F3K2", quantity: 1, unit_price: 85000 }]);
    expect(body.success_redirect_url).toBe("https://7okko.com/dashboard/orders");
    expect(typeof body.expired_at).toBe("number");
  });

  it("caches the access token across calls", async () => {
    const { fn, calls } = mockFetch({
      "/access-token/b2b": {
        status: 200,
        success: true,
        data: { access_token: "jwt-abc", token_type: "Bearer", expires_in: "216000" },
      },
      "/payment-link-manage/": {
        status: 200,
        success: true,
        data: { reff_no: "tokko-test-2", payment_url: "https://sandbox-paymentlink.singapay.id/b2b/PL456" },
      },
    });
    vi.stubGlobal("fetch", fn);

    const client = new SingaPayClient({ ...creds, clientId: "SGP-CLIENT-CACHE" });
    await client.createInvoice({ externalId: "tokko-test-2", amount: 10000, description: "x" });
    await client.createInvoice({ externalId: "tokko-test-3", amount: 20000, description: "y" });

    const tokenCalls = calls.filter((c) => c.url.includes("access-token/b2b"));
    expect(tokenCalls).toHaveLength(1); // second call reused the cached token
  });

  it("maps catalog method ids to SingaPay whitelist codes", async () => {
    const { fn, calls } = mockFetch({
      "/access-token/b2b": {
        status: 200,
        success: true,
        data: { access_token: "jwt-abc", token_type: "Bearer", expires_in: "216000" },
      },
      "/payment-link-manage/": {
        status: 200,
        success: true,
        data: { reff_no: "tokko-test-m", payment_url: "https://sandbox-paymentlink.singapay.id/b2b/PLM" },
      },
    });
    vi.stubGlobal("fetch", fn);

    const client = new SingaPayClient({ ...creds, clientId: "SGP-CLIENT-MAP" });
    await client.createInvoice({
      externalId: "tokko-test-m",
      amount: 50000,
      description: "x",
      paymentMethodIds: ["qris", "bri", "unknown-id"],
    });

    const linkCall = calls.find((c) => c.url.includes("payment-link-manage/"));
    const body = JSON.parse(String(linkCall!.init!.body));
    expect(body.whitelisted_payment_method).toEqual(["QRIS", "VA_BRI"]); // unknown dropped
  });

  it("omits the whitelist when no catalog ids are given (all methods)", async () => {
    const { fn, calls } = mockFetch({
      "/access-token/b2b": {
        status: 200,
        success: true,
        data: { access_token: "jwt-abc", token_type: "Bearer", expires_in: "216000" },
      },
      "/payment-link-manage/": {
        status: 200,
        success: true,
        data: { reff_no: "tokko-test-n", payment_url: "https://sandbox-paymentlink.singapay.id/b2b/PLN" },
      },
    });
    vi.stubGlobal("fetch", fn);

    const client = new SingaPayClient({ ...creds, clientId: "SGP-CLIENT-NO-WL" });
    await client.createInvoice({ externalId: "tokko-test-n", amount: 50000, description: "x" });

    const linkCall = calls.find((c) => c.url.includes("payment-link-manage/"));
    const body = JSON.parse(String(linkCall!.init!.body));
    expect(body.whitelisted_payment_method).toBeUndefined();
  });

  it("routes through a VPS proxy when configured (URL + token header)", async () => {
    const { fn, calls } = mockFetch({
      "/access-token/b2b": {
        status: 200,
        success: true,
        data: { access_token: "jwt-abc", token_type: "Bearer", expires_in: "216000" },
      },
      "/payment-link-manage/": {
        status: 200,
        success: true,
        data: { reff_no: "tokko-proxy-1", payment_url: "https://sandbox-paymentlink.singapay.id/b2b/PLP" },
      },
    });
    vi.stubGlobal("fetch", fn);

    const proxyUrl = "https://proxy.example.com/singapay";
    const client = new SingaPayClient({
      ...creds,
      clientId: "SGP-CLIENT-PROXY",
      apiUrl: proxyUrl,
      proxyToken: "topsecret",
    });
    await client.createInvoice({ externalId: "tokko-proxy-1", amount: 10000, description: "x" });

    const tokenCall = calls.find((c) => c.url.includes("access-token/b2b"));
    expect(tokenCall!.url.startsWith(proxyUrl)).toBe(true);
    const tokenHeaders = tokenCall!.init!.headers as Record<string, string>;
    expect(tokenHeaders["X-Proxy-Token"]).toBe("topsecret");

    const linkCall = calls.find((c) => c.url.includes("payment-link-manage/"));
    expect(linkCall!.url.startsWith(proxyUrl)).toBe(true);
    const linkHeaders = linkCall!.init!.headers as Record<string, string>;
    expect(linkHeaders["X-Proxy-Token"]).toBe("topsecret");
  });

  it("throws a clear error when the token exchange fails", async () => {
    const { fn } = mockFetch({
      "/access-token/b2b": { status: 200, success: false, error: { code: 401, message: "Unauthorized" } },
    });
    vi.stubGlobal("fetch", fn);

    // Unique client id so a cached token from another test can't mask the failure.
    const client = new SingaPayClient({ ...creds, clientId: "SGP-CLIENT-FAIL" });
    await expect(client.createInvoice({ externalId: "x", amount: 1, description: "x" })).rejects.toThrow(
      /SingaPay auth/,
    );
  });
});

describe("SingaPayClient.getInvoice", () => {
  it("maps a paid link to PAID with the payment date", async () => {
    const { fn } = mockFetch({
      "/access-token/b2b": { status: 200, success: true, data: { access_token: "jwt-abc", expires_in: "216000" } },
      "/payment-link-manage/": {
        status: 200,
        success: true,
        data: [
          { reff_no: "tokko-paid-1", payment_date: "2026-08-12T00:00:00.000000Z", is_expired: false },
          { reff_no: "tokko-other", payment_date: null, is_expired: false },
        ],
      },
    });
    vi.stubGlobal("fetch", fn);

    const result = await new SingaPayClient(creds).getInvoice("tokko-paid-1");
    expect(result).toEqual({ status: "PAID", paidAt: "2026-08-12T00:00:00.000000Z" });
  });

  it("maps an expired link to EXPIRED", async () => {
    const { fn } = mockFetch({
      "/access-token/b2b": { status: 200, success: true, data: { access_token: "jwt-abc", expires_in: "216000" } },
      "/payment-link-manage/": {
        status: 200,
        success: true,
        data: [{ reff_no: "tokko-expired-1", payment_date: null, is_expired: true }],
      },
    });
    vi.stubGlobal("fetch", fn);

    const result = await new SingaPayClient(creds).getInvoice("tokko-expired-1");
    expect(result.status).toBe("EXPIRED");
  });

  it("returns PENDING when the link is not found (no attempt yet)", async () => {
    const { fn } = mockFetch({
      "/access-token/b2b": { status: 200, success: true, data: { access_token: "jwt-abc", expires_in: "216000" } },
      "/payment-link-manage/": { status: 200, success: true, data: [] },
    });
    vi.stubGlobal("fetch", fn);

    const result = await new SingaPayClient(creds).getInvoice("tokko-unknown");
    expect(result.status).toBe("PENDING");
  });
});

describe("MockSingaPayProvider", () => {
  it("returns a deterministic invoice URL and stays pending", async () => {
    const mock = new MockSingaPayProvider();
    const invoice = await mock.createInvoice({ externalId: "tokko-mock-1", amount: 5000, description: "x" });
    expect(invoice.externalId).toBe("tokko-mock-1");
    expect(invoice.invoiceUrl).toContain("checkout.payments.test/sp/");
    expect((await mock.getInvoice("tokko-mock-1")).status).toBe("PENDING");
  });
});

describe("createSingaPayProvider", () => {
  it("returns the mock when credentials are missing", () => {
    const provider = createSingaPayProvider({ NODE_ENV: "development" });
    expect(provider).toBeInstanceOf(MockSingaPayProvider);
  });

  it("returns the real client when credentials are set", () => {
    const provider = createSingaPayProvider({
      NODE_ENV: "development",
      SINGAPAY_CLIENT_ID: "a",
      SINGAPAY_CLIENT_SECRET: "b",
    });
    expect(provider).toBeInstanceOf(SingaPayClient);
  });
});
