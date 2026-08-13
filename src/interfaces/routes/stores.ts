import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { createAuth } from "../../lib/auth";
import { createDb } from "../../infrastructure/db/drizzle";
import type { Env } from "../../types";
import { GenerateStore, AIGenerationFailedError } from "../../application/store/generate-store";
import { serializePage } from "../../application/page/render-section";
import { D1StoreRepository } from "../../infrastructure/repos/d1-store-repo";
import { D1ProductRepository } from "../../infrastructure/repos/d1-product-repo";
import { D1CategoryRepository } from "../../infrastructure/repos/d1-category-repo";
import { ListProducts } from "../../application/product/list-products";
import { D1PageRepository } from "../../infrastructure/repos/d1-page-repo";
import { SubdomainAlreadyTakenError, generateSubdomain } from "../../domain/store/rules";
import { eq } from "drizzle-orm";
import { stores } from "../../infrastructure/db/schema";
import { BusinessType, Aesthetic } from "../../domain/store/types";
import type { EntityId } from "../../domain/shared/types";
import { mockAIGenerate, generateStore } from "../../infrastructure/ai/deepseek-client";
import { useRealAi } from "../../infrastructure/ai/ai-mode";
import { PAYMENT_METHOD_CATALOG, DEFAULT_ENABLED_PAYMENT_METHODS, type PaymentMethodInfo } from "../../application/payment/payment-method-catalog";
import { COURIER_CATALOG, DEFAULT_COURIERS } from "../../application/shipping/courier-catalog";
import { PlanService, type PlanView } from "../../application/plan/plan-service";
import { D1SubscriptionRepository } from "../../infrastructure/repos/d1-subscription-repo";
import { D1PendingPlanRepository } from "../../infrastructure/repos/d1-pending-plan-repo";
import { isTestEmail, resolveTestAccess } from "../../application/payout/test-access";
import { activatePendingPlan } from "../../application/plan/pending-plan";
import { createProviderClient, resolveActivePaymentProvider, providerIsReal } from "../../infrastructure/payments/registry";
import { createSingaPayAccountsClient, SINGAPAY_METHOD_CODES } from "../../infrastructure/payments/singapay-client";
import { StartMerchantKYB, GetMerchantKYBStatus, KYBStoreNotFoundError } from "../../application/kyb/merchant-kyb";
import { isSupportedBankCode, swiftCodeFor } from "../../application/admin/admin-payouts";
import { D1AppSettingsRepository } from "../../infrastructure/repos/d1-app-settings-repo";
import { subscriptionExternalId, priceFor } from "../../domain/plan/pricing";

const storesRouter = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Full store JSON (all settings incl. shipping origin + payment config). */
function storeJSON(store: {
  id: string; name: string; subdomain: string; description: string | null;
  businessType: string; aestheticPreference: string; whatsappNumber: string;
  status: string; heroImageUrl: string | null; logoUrl: string | null;
  originAddress: string | null; originPostalCode: string | null;
  originRt: string | null; originRw: string | null; originKelurahan: string | null;
  originKecamatan: string | null; originCity: string | null; originProvince: string | null;
  originContactName: string | null; originContactPhone: string | null;
  originLatitude: number | null; originLongitude: number | null;
  paymentOnline: boolean; bankName: string | null;
  bankAccountNumber: string | null; bankAccountName: string | null;
  enabledPaymentMethods: string[] | null; enabledCouriers: string[] | null;
  singapayAccountId: string | null; kybStatus: string | null;
  payoutBankCode: string | null; payoutBankAccountNumber: string | null; payoutBankAccountName: string | null;
}, plan?: PlanView) {
  return {
    id: store.id,
    name: store.name,
    subdomain: store.subdomain,
    description: store.description,
    businessType: store.businessType,
    aestheticPreference: store.aestheticPreference,
    whatsappNumber: store.whatsappNumber,
    status: store.status,
    heroImageUrl: store.heroImageUrl,
    logoUrl: store.logoUrl,
    originAddress: store.originAddress,
    originRt: store.originRt,
    originRw: store.originRw,
    originKelurahan: store.originKelurahan,
    originKecamatan: store.originKecamatan,
    originCity: store.originCity,
    originProvince: store.originProvince,
    originPostalCode: store.originPostalCode,
    originContactName: store.originContactName,
    originContactPhone: store.originContactPhone,
    originLatitude: store.originLatitude,
    originLongitude: store.originLongitude,
    paymentOnline: store.paymentOnline,
    bankName: store.bankName,
    bankAccountNumber: store.bankAccountNumber,
    bankAccountName: store.bankAccountName,
    enabledPaymentMethods: store.enabledPaymentMethods,
    enabledCouriers: store.enabledCouriers,
    // SingaPay managed sub-account (merchant KYB) — owner/admin only;
    // the public storefront strips these (see by-subdomain).
    singapayAccountId: store.singapayAccountId,
    kybStatus: store.kybStatus,
    payoutBankCode: store.payoutBankCode,
    payoutBankAccountNumber: store.payoutBankAccountNumber,
    payoutBankAccountName: store.payoutBankAccountName,
    ...(plan ? { plan } : {}),
  };
}

/** Require authenticated user — returns 401 if not logged in */
async function requireAuth(c: any) {
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "Silakan login terlebih dahulu." } }, 401);
  }
  return session;
}

/** PlanService bound to a request's D1. */
function planService(db: ReturnType<typeof createDb>) {
  return new PlanService(new D1SubscriptionRepository(db));
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const generateSchema = z.object({
  businessName: z.string().min(1, "Nama bisnis wajib diisi"),
  businessType: z.enum(["food", "fashion", "gift", "beauty", "craft", "gadget", "home", "service"]),
  productCategory: z.string().min(1, "Kategori produk wajib diisi"),
  aesthetic: z.enum(["minimal", "warm", "bold"]),
  whatsappNumber: z.string().min(10, "Nomor WhatsApp wajib diisi"),
});

// ---------------------------------------------------------------------------
// GET /api/stores/check-subdomain?name=... | ?subdomain=...
// ---------------------------------------------------------------------------
storesRouter.get("/check-subdomain", async (c) => {
  const name = c.req.query("name");
  const direct = c.req.query("subdomain");
  if (!name && !direct) {
    return c.json({ error: { code: "VALIDATION", message: "Parameter 'name' atau 'subdomain' diperlukan." } }, 400);
  }

  const subdomain = direct?.trim().toLowerCase() ?? generateSubdomain(name ?? "");
  const db = createDb(c.env.DB);
  const storeRepo = new D1StoreRepository(db);

  // Format + reserved checks for direct subdomain lookups.
  const RESERVED_SUBDOMAINS = new Set(["app", "api", "www", "admin", "checkout"]);
  const invalid = subdomain.length < 2 || subdomain.length > 40 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(subdomain);
  if (invalid || RESERVED_SUBDOMAINS.has(subdomain)) {
    return c.json({ subdomain, available: false, reserved: RESERVED_SUBDOMAINS.has(subdomain), invalid });
  }

  const existing = await storeRepo.findBySubdomain(subdomain);
  return c.json({ subdomain, available: !existing });
});

// ---------------------------------------------------------------------------
// POST /api/stores/generate
// ---------------------------------------------------------------------------
storesRouter.post("/generate", zValidator("json", generateSchema), async (c) => {
  const session = await requireAuth(c);
  if (session instanceof Response) return session;

  const input = c.req.valid("json");
  const db = createDb(c.env.DB);

  // One user, one store — prevent duplicate
  const checkRepo = new D1StoreRepository(db);
  const existing = await checkRepo.findByOwnerId(session.user.id as EntityId);
  if (existing) {
    return c.json({ error: { code: "ALREADY_ONBOARDED", message: "Anda sudah memiliki toko." } }, 409);
  }

  // Use the real LLM whenever a valid key is configured (dev or prod); only
  // fall back to the deterministic mock when no key is set or LLM_FORCE_MOCK=1.
  const aiGenerate = useRealAi(c.env)
    ? (input: Parameters<typeof generateStore>[1]) => {
        console.log(`[LLM] generating with ${c.env.LLM_MODEL || "deepseek-chat"} @ ${c.env.LLM_BASE_URL || "https://api.deepseek.com/v1"}`);
        return generateStore({
          apiKey: c.env.LLM_API_KEY,
          model: c.env.LLM_MODEL,
          baseUrl: c.env.LLM_BASE_URL,
        }, input);
      }
    : mockAIGenerate;

  const useCase = new GenerateStore(
    new D1StoreRepository(db),
    new D1ProductRepository(db),
    new D1PageRepository(db),
    aiGenerate,
  );

  const pendingRepo = new D1PendingPlanRepository(db);
  // Paid a plan before onboarding? → the new store gets the subscription,
  // no trial window (consumed below). Otherwise a 14-day trial starts.
  const pending = await pendingRepo.findByUserIdConsumable(session.user.id as EntityId);

  const result = await useCase.execute({
    ownerId: session.user.id as EntityId,
    businessName: input.businessName,
    businessType: input.businessType as typeof BusinessType[keyof typeof BusinessType],
    productCategory: input.productCategory,
    aesthetic: input.aesthetic as typeof Aesthetic[keyof typeof Aesthetic],
    whatsappNumber: input.whatsappNumber,
    // Trial lifecycle starts at signup (14 days) — unless a paid plan was
    // bought pre-store (then no trial; the plan is already active).
    trialEndsAt: pending ? undefined : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
  });

  if (!result.ok) {
    if (result.error instanceof SubdomainAlreadyTakenError) {
      return c.json({
        error: { code: "SUBDOMAIN_TAKEN", message: "Subdomain sudah dipakai. Coba nama lain." },
      }, 409);
    }
    if (result.error instanceof AIGenerationFailedError) {
      console.error("AI_GENERATION_FAILED:", result.error.message);
      return c.json({
        error: { code: "AI_GENERATION_FAILED", message: result.error.message },
      }, 422);
    }
    return c.json({ error: { code: "UNKNOWN", message: "Terjadi kesalahan." } }, 500);
  }

  // Pre-store paid plan → create the store's subscription right away.
  if (pending) {
    const saved = await checkRepo.findById(result.value.store.id as EntityId);
    if (saved) {
      const subRepo = new D1SubscriptionRepository(db);
      await activatePendingPlan(saved, pending, subRepo);
      await checkRepo.save(saved);
    }
    await pendingRepo.markConsumed(pending.id);
  }

  return c.json(result.value, 201);
});

// ---------------------------------------------------------------------------
// GET /api/stores/me
// ---------------------------------------------------------------------------
storesRouter.get("/me", async (c) => {
  const session = await requireAuth(c);
  if (session instanceof Response) return session;

  const db = createDb(c.env.DB);
  const storeRepo = new D1StoreRepository(db);
  const store = await storeRepo.findByOwnerId(session.user.id as EntityId);

  if (!store) {
    return c.json({ store: null });
  }

  return c.json({
    store: storeJSON(store, await planService(db).viewOf(store)),
  });
});

// ---------------------------------------------------------------------------
// GET /api/stores/by-subdomain?subdomain=xxx (public)
// ---------------------------------------------------------------------------
storesRouter.get("/by-subdomain", async (c) => {
  const subdomain = c.req.query("subdomain");
  if (!subdomain) {
    return c.json({ error: { code: "VALIDATION", message: "Parameter 'subdomain' diperlukan." } }, 400);
  }

  const db = createDb(c.env.DB);
  const storeRepo = new D1StoreRepository(db);
  const store = await storeRepo.findBySubdomain(subdomain);

  if (!store) {
    return c.json({ error: { code: "STORE_NOT_FOUND", message: "Toko tidak ditemukan." } }, 404);
  }

  // Trial-expired stores stay readable with a "toko sedang libur" notice.
  const paused = store.isPaused;
  if (!store.isPublished && !paused) {
    return c.json({ error: { code: "STORE_NOT_PUBLISHED", message: "Toko belum dipublikasikan." } }, 404);
  }

  // Suspended by moderation → hidden from the public storefront.
  if (store.isSuspended) {
    return c.json({ error: { code: "STORE_SUSPENDED", message: "Toko sedang ditinjau." } }, 404);
  }

  // Get the requested page (default home) + the page list for the navbar.
  const pageSlug = c.req.query("page") ?? "beranda";
  const productRepo = new D1ProductRepository(db);
  const pageRepo = new D1PageRepository(db);
  const listProducts = new ListProducts(productRepo);
  const productsResult = await listProducts.execute({ storeId: store.id });
  const products = productsResult.ok ? productsResult.value : [];
  const [page, pages, categories] = await Promise.all([
    pageRepo.findByStoreIdAndSlug(store.id, pageSlug),
    pageRepo.listByStoreId(store.id),
    new D1CategoryRepository(db).findByStoreId(store.id),
  ]);

  if (!page) {
    return c.json({ error: { code: "PAGE_NOT_FOUND", message: "Halaman tidak ditemukan." } }, 404);
  }

  const plan = await planService(db).viewOf(store);
  const base = storeJSON(store, plan);
  // Test-owner bypass (KYB_TEST_EMAILS): the whitelisted owner sees online
  // checkout on their own storefront even without KYB/plan — staging testing
  // needs the full payment → settlement flow to work end-to-end.
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({ headers: c.req.raw.headers }).catch(() => null);
  const isTestOwner =
    !!session && session.user.id === store.ownerId && isTestEmail(session.user.email, resolveTestAccess(c.env));
  // Online checkout must ALSO pass merchant KYB (SingaPay managed sub-account)
  // — otherwise the storefront falls back to manual transfer via WhatsApp.
  const settings = new D1AppSettingsRepository(db);
  const providerId = await resolveActivePaymentProvider((k) => settings.get(k));
  const kybOk = providerId !== "singapay" || store.kybStatus === "kyb_verified";
  // Online checkout is available on Pro & Commerce — hide it only from trial/none storefronts
  // (the merchant toggle stays on their settings, but it doesn't surface).
  // KYB fields are owner/admin-only — never expose them on the public storefront.
  const { singapayAccountId: _sa, kybStatus: _kb, ...publicBase } = base;
  const storePayload = {
    ...publicBase,
    paymentOnline: isTestOwner ? true : base.paymentOnline && plan.onlineCheckout && kybOk,
    paused,
  };

  return c.json({
    store: storePayload,
    sections: serializePage(page, store.designTokens).sections,
    products: products.map((p) => ({
      ...p,
      id: p.id,
      storeId: p.storeId,
      name: p.name,
      description: p.description,
      price: p.price,
      imageUrl: p.imageUrl,
      isAvailable: p.isAvailable,
      type: p.type,
    })),
    theme: store.designTokens ?? undefined,
    pages: pages.map((p) => ({ slug: p.slug, title: p.title })),
    categories: categories.map((c) => c.toJSON()),
    pageSlug: page.slug,
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/stores/:id
// ---------------------------------------------------------------------------
storesRouter.patch("/:id", zValidator("json", z.object({
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  whatsappNumber: z.string().optional(),
  heroImageUrl: z.string().nullable().optional(),
  logoUrl: z.string().nullable().optional(),
  subdomain: z.string().optional(),
  // Payment config
  paymentOnline: z.boolean().optional(),
  bankName: z.string().nullable().optional(),
  bankAccountNumber: z.string().nullable().optional(),
  bankAccountName: z.string().nullable().optional(),
  enabledPaymentMethods: z.array(z.string()).optional(),
  enabledCouriers: z.array(z.string()).optional(),
  // Payout bank (SingaPay disbursement destination)
  payoutBankCode: z.string().optional(),
  payoutBankAccountNumber: z.string().nullable().optional(),
  payoutBankAccountName: z.string().nullable().optional(),
})), async (c) => {
  const session = await requireAuth(c);
  if (session instanceof Response) return session;

  const storeId = c.req.param("id");
  const db = createDb(c.env.DB);
  const storeRepo = new D1StoreRepository(db);
  const store = await storeRepo.findById(storeId as EntityId);

  if (!store) {
    return c.json({ error: { code: "NOT_FOUND", message: "Toko tidak ditemukan." } }, 404);
  }

  if (store.ownerId !== session.user.id) {
    return c.json({ error: { code: "FORBIDDEN", message: "Hanya pemilik toko yang dapat mengubah." } }, 403);
  }

  const body = c.req.valid("json");
  store.updateDetails({
    name: body.name,
    description: body.description,
    whatsappNumber: body.whatsappNumber,
  });

  // Gate: online checkout (Xendit) is available on Pro & Commerce.
  if (body.paymentOnline === true && !(await planService(db).canUseOnlineCheckout(store))) {
    // Test-owner bypass (KYB_TEST_EMAILS) — the whitelisted owner may enable it.
    const isTestOwner = isTestEmail(session.user.email, resolveTestAccess(c.env));
    if (!isTestOwner) {
      return c.json({
        error: { code: "PLAN_REQUIRED", message: "Pembayaran online tersedia di paket Pro dan Commerce.", field: "paymentOnline" },
      }, 403);
    }
  }

  // Enforce e-payment once merchant KYB is approved (SingaPay) — online
  // checkout is mandatory for verified merchants; WhatsApp/manual transfer is
  // only the pre-verification fallback.
  if (body.paymentOnline === false && store.kybStatus === "kyb_verified") {
    const settings = new D1AppSettingsRepository(db);
    const providerId = await resolveActivePaymentProvider((k) => settings.get(k));
    if (providerId === "singapay") {
      return c.json({
        error: { code: "KYB_ENFORCED", message: "Pembayaran online wajib aktif setelah verifikasi merchant selesai.", field: "paymentOnline" },
      }, 403);
    }
  }

  if (body.heroImageUrl !== undefined) {
    store.setHeroImage(body.heroImageUrl);
  }

  if (body.logoUrl !== undefined) {
    store.setLogo(body.logoUrl);
  }

  // Subdomain change — validated + uniqueness checked (excluding self).
  const RESERVED_SUBDOMAINS = new Set(["app", "api", "www", "admin", "checkout"]);
  if (body.subdomain !== undefined) {
    const sub = body.subdomain.trim().toLowerCase();
    if (sub.length < 2 || sub.length > 40 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(sub)) {
      return c.json({ error: { code: "VALIDATION", message: "Subdomain hanya huruf kecil, angka, dan tanda hubung (2-40 karakter).", field: "subdomain" } }, 400);
    }
    if (RESERVED_SUBDOMAINS.has(sub)) {
      return c.json({ error: { code: "VALIDATION", message: "Subdomain tersebut dipakai platform.", field: "subdomain" } }, 400);
    }
    const clash = await storeRepo.findBySubdomain(sub);
    if (clash && clash.id !== store.id) {
      return c.json({ error: { code: "VALIDATION", message: "Subdomain sudah dipakai toko lain.", field: "subdomain" } }, 400);
    }
    store.changeSubdomain(sub);
  }

  store.updatePaymentConfig({
    paymentOnline: body.paymentOnline,
    bankName: body.bankName,
    bankAccountNumber: body.bankAccountNumber,
    bankAccountName: body.bankAccountName,
    enabledPaymentMethods: body.enabledPaymentMethods,
    enabledCouriers: body.enabledCouriers,
  });

  // Payout bank — validated against the supported bank codes.
  if (body.payoutBankCode !== undefined || body.payoutBankAccountNumber !== undefined) {
    const code = body.payoutBankCode ?? store.payoutBankCode ?? "";
    if (!isSupportedBankCode(code)) {
      return c.json({
        error: { code: "VALIDATION", message: "Bank tujuan pencairan tidak didukung — pilih dari daftar.", field: "payoutBankCode" },
      }, 400);
    }
    store.setPayoutBank({
      code,
      accountNumber: (body.payoutBankAccountNumber ?? store.payoutBankAccountNumber ?? "").replace(/\D/g, ""),
      accountName: body.payoutBankAccountName ?? store.payoutBankAccountName ?? null,
    });
  }

  await storeRepo.save(store);

  return c.json({ store: storeJSON(store, await planService(db).viewOf(store)) });
});

// ---------------------------------------------------------------------------
// POST /api/stores/:id/subscription-checkout — buy/upgrade a plan (owner)
// ---------------------------------------------------------------------------
const subscriptionCheckoutSchema = z.object({
  plan: z.enum(["pro", "commerce"]),
  cycle: z.enum(["monthly", "annual"]).default("annual"),
});

storesRouter.post("/:id/subscription-checkout", zValidator("json", subscriptionCheckoutSchema), async (c) => {
  const session = await requireAuth(c);
  if (session instanceof Response) return session;

  const storeId = c.req.param("id") as EntityId;
  const db = createDb(c.env.DB);
  const storeRepo = new D1StoreRepository(db);
  const store = await storeRepo.findById(storeId);
  if (!store) return c.json({ error: { code: "NOT_FOUND", message: "Toko tidak ditemukan." } }, 404);
  if (store.ownerId !== session.user.id) {
    return c.json({ error: { code: "FORBIDDEN", message: "Hanya pemilik toko." } }, 403);
  }

  const { plan, cycle } = c.req.valid("json");
  const amount = priceFor(plan, cycle);

  // Route through the active provider (admin switch); real payments only —
  // no mock invoices for subscriptions.
  const providerId = await resolveActivePaymentProvider((k) => new D1AppSettingsRepository(db).get(k));
  if (!providerIsReal(c.env, providerId)) {
    return c.json({
      error: { code: "PAYMENT_UNAVAILABLE", message: "Pembayaran langganan belum tersedia saat ini." },
    }, 502);
  }
  const provider = createProviderClient(c.env, providerId);

  const externalId = subscriptionExternalId(store.id, plan, cycle, `${Date.now()}`);
  const label = plan === "pro" ? "Pro" : "Commerce";
  const cycleLabel = cycle === "annual" ? "tahunan" : "bulanan";
  let invoice;
  try {
    invoice = await provider.createInvoice({
      externalId,
      amount,
      description: `Langganan Tokko ${label} (${cycleLabel})`,
      customer: { givenNames: store.name, email: session.user.email },
      successRedirectUrl: `${c.env.FRONTEND_URL ?? "https://7okko.com"}/dashboard/settings`,
      failureRedirectUrl: `${c.env.FRONTEND_URL ?? "https://7okko.com"}/dashboard/settings`,
    });
  } catch (e) {
    return c.json({
      error: { code: "PAYMENT_PROVIDER_ERROR", message: e instanceof Error ? e.message : "Gagal membuat pembayaran." },
    }, 502);
  }

  return c.json({
    invoiceUrl: invoice.invoiceUrl,
    externalId,
    plan,
    cycle,
    amount,
  }, 201);
});

// ---------------------------------------------------------------------------
// Merchant KYB (SingaPay managed sub-account) — owner only
// ---------------------------------------------------------------------------

// POST /api/stores/:id/kyb — start/resume the KYB flow (creates the
// managed sub-account on first call, returns the self-onboarding link).
storesRouter.post("/:id/kyb", async (c) => {
  const session = await requireAuth(c);
  if (session instanceof Response) return session;

  const storeId = c.req.param("id") as EntityId;
  const db = createDb(c.env.DB);
  const storeRepo = new D1StoreRepository(db);
  const store = await storeRepo.findById(storeId);
  if (!store) return c.json({ error: { code: "NOT_FOUND", message: "Toko tidak ditemukan." } }, 404);
  if (store.ownerId !== session.user.id) {
    return c.json({ error: { code: "FORBIDDEN", message: "Hanya pemilik toko." } }, 403);
  }

  const result = await new StartMerchantKYB(storeRepo, createSingaPayAccountsClient(c.env)).execute(storeId);
  if (!result.ok) {
    if (result.error instanceof KYBStoreNotFoundError) return c.json({ error: result.error }, 404);
    return c.json({ error: result.error }, 502);
  }
  return c.json({ kyb: result.value });
});

// GET /api/stores/:id/kyb — current KYB status (live from the provider).
storesRouter.get("/:id/kyb", async (c) => {
  const session = await requireAuth(c);
  if (session instanceof Response) return session;

  const storeId = c.req.param("id") as EntityId;
  const db = createDb(c.env.DB);
  const storeRepo = new D1StoreRepository(db);
  const store = await storeRepo.findById(storeId);
  if (!store) return c.json({ error: { code: "NOT_FOUND", message: "Toko tidak ditemukan." } }, 404);
  if (store.ownerId !== session.user.id) {
    return c.json({ error: { code: "FORBIDDEN", message: "Hanya pemilik toko." } }, 403);
  }

  const result = await new GetMerchantKYBStatus(storeRepo, createSingaPayAccountsClient(c.env)).execute(storeId);
  if (!result.ok) {
    if (result.error instanceof KYBStoreNotFoundError) return c.json({ error: result.error }, 404);
    return c.json({ error: result.error }, 502);
  }
  return c.json({ kyb: result.value });
});

// POST /api/stores/:id/payout-bank/check — validate the payout bank account
// via SingaPay's check-beneficiary (best-effort; digital banks have no SWIFT).
storesRouter.post("/:id/payout-bank/check", zValidator("json", z.object({
  bankCode: z.string(),
  accountNumber: z.string(),
})), async (c) => {
  const session = await requireAuth(c);
  if (session instanceof Response) return session;

  const storeId = c.req.param("id") as EntityId;
  const db = createDb(c.env.DB);
  const storeRepo = new D1StoreRepository(db);
  const store = await storeRepo.findById(storeId);
  if (!store) return c.json({ error: { code: "NOT_FOUND", message: "Toko tidak ditemukan." } }, 404);
  if (store.ownerId !== session.user.id) {
    return c.json({ error: { code: "FORBIDDEN", message: "Hanya pemilik toko." } }, 403);
  }

  const { bankCode, accountNumber } = c.req.valid("json");
  if (!isSupportedBankCode(bankCode)) {
    return c.json({ valid: false, message: "Bank tidak didukung." });
  }
  const swift = swiftCodeFor(bankCode);
  if (!swift) {
    return c.json({ valid: null, message: "Bank digital tidak bisa dicek otomatis — akan diverifikasi saat pencairan." });
  }
  try {
    await createSingaPayAccountsClient(c.env).checkBeneficiary({ bankSwiftCode: swift, bankAccountNumber: accountNumber });
    return c.json({ valid: true, message: "Rekening valid." });
  } catch {
    return c.json({ valid: false, message: "Rekening tidak ditemukan di bank tersebut — periksa nomor rekening." });
  }
});

// ---------------------------------------------------------------------------
// POST /api/stores/:id/subscription/cancel — cancel / resume (owner)
// ---------------------------------------------------------------------------
storesRouter.post("/:id/subscription/cancel", zValidator("json", z.object({ cancel: z.boolean() })), async (c) => {
  const session = await requireAuth(c);
  if (session instanceof Response) return session;

  const storeId = c.req.param("id") as EntityId;
  const db = createDb(c.env.DB);
  const storeRepo = new D1StoreRepository(db);
  const store = await storeRepo.findById(storeId);
  if (!store) return c.json({ error: { code: "NOT_FOUND", message: "Toko tidak ditemukan." } }, 404);
  if (store.ownerId !== session.user.id) {
    return c.json({ error: { code: "FORBIDDEN", message: "Hanya pemilik toko." } }, 403);
  }

  const { CancelSubscription, SubscriptionNotFoundError, SubscriptionAlreadyCanceledError, SubscriptionChangePendingError } =
    await import("../../application/plan/cancel-subscription");
  const body = c.req.valid("json");
  const result = await new CancelSubscription(new D1SubscriptionRepository(db)).execute({
    storeId: store.id as string,
    cancel: body.cancel,
  });

  if (!result.ok) {
    if (result.error instanceof SubscriptionNotFoundError) return c.json({ error: { code: "SUBSCRIPTION_NOT_FOUND" } }, 404);
    if (result.error instanceof SubscriptionAlreadyCanceledError) return c.json({ error: { code: "SUBSCRIPTION_ALREADY_CANCELED" } }, 400);
    if (result.error instanceof SubscriptionChangePendingError) return c.json({ error: { code: "SUBSCRIPTION_CHANGE_PENDING" } }, 400);
    return c.json({ error: { code: "UNKNOWN" } }, 400);
  }

  const saved = await storeRepo.findById(storeId);
  if (!saved) return c.json({ error: { code: "NOT_FOUND" } }, 404);
  return c.json({ plan: await planService(db).viewOf(saved) });
});

// ---------------------------------------------------------------------------
// GET /api/stores/:id/payment-methods — active provider + method list
// (SingaPay: live catalog from the API merged with our fee schedule;
// Xendit: static catalog. SingaPay does not publish fee rates via API —
// fees are charged per transaction, so unknown methods show no rate.)
// ---------------------------------------------------------------------------
storesRouter.get("/:id/payment-methods", async (c) => {
  const session = await requireAuth(c);
  if (session instanceof Response) return session;

  const storeId = c.req.param("id") as EntityId;
  const db = createDb(c.env.DB);
  const storeRepo = new D1StoreRepository(db);
  const store = await storeRepo.findById(storeId);
  if (!store) return c.json({ error: { code: "NOT_FOUND" } }, 404);
  if (store.ownerId !== session.user.id) return c.json({ error: { code: "FORBIDDEN" } }, 403);

  const settings = new D1AppSettingsRepository(db);
  const providerId = await resolveActivePaymentProvider((k) => settings.get(k));
  const enabled = new Set(store.enabledPaymentMethods ?? DEFAULT_ENABLED_PAYMENT_METHODS);

  // SingaPay: live catalog (codes/names/groups) merged with our fee schedule.
  if (providerId === "singapay") {
    try {
      const live = await createSingaPayAccountsClient(c.env).listPaymentMethods();
      const oursByCode = new Map<string, PaymentMethodInfo>();
      for (const m of PAYMENT_METHOD_CATALOG) {
        for (const code of SINGAPAY_METHOD_CODES[m.id] ?? []) oursByCode.set(code, m);
      }
      return c.json({
        provider: providerId,
        methods: live.payment_methods.map((pm) => {
          const ours = oursByCode.get(pm.code);
          return {
            id: ours?.id ?? pm.code,
            label: pm.name,
            group: pm.group,
            feePercent: ours?.feePercent ?? null,
            feeFixed: ours?.feeFixed ?? null,
            enabled: ours ? enabled.has(ours.id) : false,
            providerCode: pm.code,
          };
        }),
      });
    } catch {
      // provider unreachable — fall through to the static catalog
    }
  }

  return c.json({
    provider: providerId,
    methods: PAYMENT_METHOD_CATALOG.map((m) => ({
      id: m.id,
      label: m.label,
      group: m.group,
      feePercent: m.feePercent,
      feeFixed: m.feeFixed,
      enabled: enabled.has(m.id),
    })),
  });
});

// ---------------------------------------------------------------------------
// GET /api/stores/:id/couriers — courier catalog + per-store enabled flags
// ---------------------------------------------------------------------------
storesRouter.get("/:id/couriers", async (c) => {
  const session = await requireAuth(c);
  if (session instanceof Response) return session;

  const storeId = c.req.param("id") as EntityId;
  const db = createDb(c.env.DB);
  const storeRepo = new D1StoreRepository(db);
  const store = await storeRepo.findById(storeId);
  if (!store) return c.json({ error: { code: "NOT_FOUND" } }, 404);
  if (store.ownerId !== session.user.id) return c.json({ error: { code: "FORBIDDEN" } }, 403);

  const enabled = new Set(store.enabledCouriers ?? DEFAULT_COURIERS);
  return c.json({
    couriers: COURIER_CATALOG.map((c) => ({
      code: c.code,
      name: c.name,
      type: c.type,
      enabled: enabled.has(c.code),
    })),
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/stores/:id/shipping — shipping origin (Biteship pickup location)
// ---------------------------------------------------------------------------
storesRouter.patch("/:id/shipping", zValidator("json", z.object({
  originAddress: z.string().nullable().optional(),
  originRt: z.string().nullable().optional(),
  originRw: z.string().nullable().optional(),
  originKelurahan: z.string().nullable().optional(),
  originKecamatan: z.string().nullable().optional(),
  originCity: z.string().nullable().optional(),
  originProvince: z.string().nullable().optional(),
  originPostalCode: z.string().nullable().optional(),
  originContactName: z.string().nullable().optional(),
  originContactPhone: z.string().nullable().optional(),
  originLatitude: z.number().nullable().optional(),
  originLongitude: z.number().nullable().optional(),
})), async (c) => {
  const session = await requireAuth(c);
  if (session instanceof Response) return session;

  const storeId = c.req.param("id") as EntityId;
  const db = createDb(c.env.DB);
  const storeRepo = new D1StoreRepository(db);
  const store = await storeRepo.findById(storeId);

  if (!store) return c.json({ error: { code: "NOT_FOUND", message: "Toko tidak ditemukan." } }, 404);
  if (store.ownerId !== session.user.id) {
    return c.json({ error: { code: "FORBIDDEN", message: "Hanya pemilik toko yang dapat mengubah." } }, 403);
  }

  const body = c.req.valid("json");
  store.updateShippingOrigin({
    originAddress: body.originAddress,
    originRt: body.originRt,
    originRw: body.originRw,
    originKelurahan: body.originKelurahan,
    originKecamatan: body.originKecamatan,
    originCity: body.originCity,
    originProvince: body.originProvince,
    originPostalCode: body.originPostalCode,
    originContactName: body.originContactName,
    originContactPhone: body.originContactPhone,
    originLatitude: body.originLatitude,
    originLongitude: body.originLongitude,
  });

  await storeRepo.save(store);

  return c.json({ store: storeJSON(store) });
});

// ---------------------------------------------------------------------------
// POST /api/stores/:id/publish
// ---------------------------------------------------------------------------
storesRouter.post("/:id/publish", async (c) => {
  const session = await requireAuth(c);
  if (session instanceof Response) return session;

  const storeId = c.req.param("id") as EntityId;
  const db = createDb(c.env.DB);
  const storeRepo = new D1StoreRepository(db);

  const store = await storeRepo.findById(storeId);
  if (!store) return c.json({ error: { code: "NOT_FOUND", message: "Toko tidak ditemukan." } }, 404);
  if (store.ownerId !== session.user.id) {
    return c.json({ error: { code: "FORBIDDEN" } }, 403);
  }

  const { PublishStore } = await import("../../application/store/publish-store");
  const useCase = new PublishStore(storeRepo);
  const result = await useCase.execute({ storeId });

  if (!result.ok) {
    const status = result.error.code === "STORE_HAS_NO_PRODUCTS" ? 400 : 404;
    return c.json({ error: result.error }, status);
  }

  const saved = await storeRepo.findById(storeId);
  if (!saved) return c.json({ error: { code: "NOT_FOUND" } }, 404);
  return c.json({
    store: storeJSON(saved, await planService(db).viewOf(saved)),
  });
});

// ---------------------------------------------------------------------------
// POST /api/stores/:id/unpublish
// ---------------------------------------------------------------------------
storesRouter.post("/:id/unpublish", async (c) => {
  const session = await requireAuth(c);
  if (session instanceof Response) return session;

  const storeId = c.req.param("id") as EntityId;
  const db = createDb(c.env.DB);
  const storeRepo = new D1StoreRepository(db);

  const store = await storeRepo.findById(storeId);
  if (!store) return c.json({ error: { code: "NOT_FOUND" } }, 404);
  if (store.ownerId !== session.user.id) {
    return c.json({ error: { code: "FORBIDDEN" } }, 403);
  }

  const { UnpublishStore } = await import("../../application/store/unpublish-store");
  const useCase = new UnpublishStore(storeRepo);
  const result = await useCase.execute({ storeId });

  if (!result.ok) {
    return c.json({ error: result.error }, 404);
  }

  const saved = await storeRepo.findById(storeId);
  if (!saved) return c.json({ error: { code: "NOT_FOUND" } }, 404);
  return c.json({
    store: storeJSON(saved, await planService(db).viewOf(saved)),
  });
});

export { storesRouter };
