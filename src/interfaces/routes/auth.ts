import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { createAuth } from "../../lib/auth";
import { createDb } from "../../infrastructure/db/drizzle";
import type { Env } from "../../types";
import { eq, count } from "drizzle-orm";
import { stores, consents } from "../../infrastructure/db/schema";
import { D1StoreRepository } from "../../infrastructure/repos/d1-store-repo";
import { D1SubscriptionRepository } from "../../infrastructure/repos/d1-subscription-repo";
import { PlanService } from "../../application/plan/plan-service";
import type { EntityId } from "../../domain/shared/types";

// Versi dokumen legal yang sedang berlaku — dicatat pada consent log.
const TERMS_VERSION = "1.0";
const PRIVACY_VERSION = "1.0";

const authRouter = new Hono<{ Bindings: Env }>();

/** Full store payload matching the frontend Store interface. */
function serializeStoreRow(row: typeof stores.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    subdomain: row.subdomain,
    description: row.description,
    businessType: row.businessType,
    aestheticPreference: row.aestheticPreference,
    whatsappNumber: row.whatsappNumber,
    status: row.status,
    heroImageUrl: row.heroImageUrl,
    logoUrl: row.logoUrl,
    originAddress: row.originAddress,
    originRt: row.originRt,
    originRw: row.originRw,
    originKelurahan: row.originKelurahan,
    originKecamatan: row.originKecamatan,
    originCity: row.originCity,
    originProvince: row.originProvince,
    originPostalCode: row.originPostalCode,
    originContactName: row.originContactName,
    originContactPhone: row.originContactPhone,
    originLatitude: row.originLatitude,
    originLongitude: row.originLongitude,
    paymentOnline: row.paymentOnline === 1,
    singapayAccountId: row.singapayAccountId,
    kybStatus: row.kybStatus,
    bankName: row.bankName,
    bankAccountNumber: row.bankAccountNumber,
    bankAccountName: row.bankAccountName,
    enabledPaymentMethods: row.enabledPaymentMethods ? (JSON.parse(row.enabledPaymentMethods) as string[]) : null,
    enabledCouriers: row.enabledCouriers ? (JSON.parse(row.enabledCouriers) as string[]) : null,
  };
}

/** Serialize the better-auth session user (admin plugin adds role + banned). */
function serializeUser(u: {
  id: string;
  name: string;
  email: string;
  role?: string | null;
  banned?: boolean | null;
  image?: string | null;
}) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role ?? "user",
    banned: u.banned ?? false,
  };
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const registerSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  // Persetujuan S&K + Privasi — wajib (UU PDP Pasal 22 & 24).
  consent: z.boolean().refine((v) => v === true, "Consent to terms is required"),
});

const loginSchema = z.object({
  email: z.string().email("Invalid email"),
  password: z.string().min(1, "Password is required"),
});

// ---------------------------------------------------------------------------
// POST /api/auth/register
// ---------------------------------------------------------------------------
authRouter.post("/register", zValidator("json", registerSchema), async (c) => {
  const { name, email, password } = c.req.valid("json");
  const auth = createAuth(c.env);

  try {
    const { headers } = await auth.api.signUpEmail({
      body: { name, email, password },
      headers: c.req.raw.headers,
      returnHeaders: true,
    });

    // Forward cookies from better-auth
    const setCookie = headers?.get("set-cookie");
    if (setCookie) {
      c.header("set-cookie", setCookie);
    }

    // Get session using the response headers that contain the new cookie
    const session = await auth.api.getSession({
      headers: new Headers({ cookie: setCookie ?? "" }),
    });

    // Catat bukti persetujuan S&K + Privasi (UU PDP Pasal 22 & 24 —
    // consent tanpa bukti = tidak ada).
    if (session) {
      try {
        const db = createDb(c.env.DB);
        const ip =
          c.req.header("cf-connecting-ip") ??
          c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
          "unknown";
        await db.insert(consents).values({
          id: crypto.randomUUID(),
          userId: session.user.id,
          type: "terms_privacy",
          termsVersion: TERMS_VERSION,
          privacyVersion: PRIVACY_VERSION,
          ip,
          userAgent: c.req.header("user-agent") ?? null,
        });
      } catch (consentErr) {
        console.error("CONSENT LOG ERROR:", consentErr);
        // Jangan gagalkan registrasi karena kegagalan pencatatan consent —
        // tapi log error untuk investigasi.
      }
    }

    return c.json({
      user: serializeUser(session!.user),
    }, 201);
  } catch (error: any) {
    console.error("REGISTER ERROR:", JSON.stringify(error, Object.getOwnPropertyNames(error)));
    if (error?.status === 422 || error?.message?.includes("already exists")) {
      return c.json({
        error: { code: "EMAIL_TAKEN", message: "Email sudah terdaftar. Silakan login." },
      }, 409);
    }
    return c.json({
      error: { code: "VALIDATION", message: error?.message ?? "Registration failed", detail: error?.cause?.message ?? "" },
    }, 400);
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------
authRouter.post("/login", zValidator("json", loginSchema), async (c) => {
  const { email, password } = c.req.valid("json");
  const auth = createAuth(c.env);

  try {
    const { headers: authHeaders } = await auth.api.signInEmail({
      body: { email, password },
      headers: c.req.raw.headers,
      returnHeaders: true,
    });

    // Forward cookies
    const setCookie = authHeaders?.get("set-cookie");
    if (setCookie) {
      c.header("set-cookie", setCookie);
    }

    // Get the session using the NEW cookie from the sign-in response — the
    // original request headers carry no session cookie yet, so querying with
    // them always returns null and login would always 401.
    const session = await auth.api.getSession({
      headers: new Headers({ cookie: setCookie ?? "" }),
    });

    if (!session) {
      return c.json({
        error: { code: "INVALID_CREDENTIALS", message: "Email atau password salah." },
      }, 401);
    }

    // Check if user has a store
    const db = createDb(c.env.DB);
    const storeRow = await db
      .select()
      .from(stores)
      .where(eq(stores.ownerId, session.user.id))
      .get();

    const consentRow = await db
      .select({ c: count() })
      .from(consents)
      .where(eq(consents.userId, session.user.id))
      .get();

    return c.json({
      user: serializeUser(session.user),
      store: storeRow ? serializeStoreRow(storeRow) : null,
      hasConsent: (consentRow?.c ?? 0) > 0,
    });
  } catch (error: any) {
    return c.json({
      error: { code: "INVALID_CREDENTIALS", message: "Email atau password salah." },
    }, 401);
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/logout
// ---------------------------------------------------------------------------
authRouter.post("/logout", async (c) => {
  const auth = createAuth(c.env);

  try {
    const { headers: authHeaders } = await auth.api.signOut({
      headers: c.req.raw.headers,
      returnHeaders: true,
    });

    const setCookie = authHeaders?.get("set-cookie");
    if (setCookie) {
      c.header("set-cookie", setCookie);
    }

    return c.json({ success: true });
  } catch {
    return c.json({ success: true }); // Always succeed
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/consent — log terms+privacy consent for the current user.
// Used after OAuth (Google) signups, where registration happens server-side
// and the register route's consent log doesn't run. UU PDP Pasal 22 & 24.
// ---------------------------------------------------------------------------
authRouter.post("/consent", async (c) => {
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "Silakan login terlebih dahulu." } }, 401);
  }

  try {
    const db = createDb(c.env.DB);
    const ip =
      c.req.header("cf-connecting-ip") ??
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      "unknown";
    await db.insert(consents).values({
      id: crypto.randomUUID(),
      userId: session.user.id,
      type: "terms_privacy",
      termsVersion: TERMS_VERSION,
      privacyVersion: PRIVACY_VERSION,
      ip,
      userAgent: c.req.header("user-agent") ?? null,
    });
  } catch (consentErr) {
    console.error("CONSENT LOG ERROR:", consentErr);
    return c.json({ error: { code: "UNKNOWN", message: "Gagal mencatat persetujuan." } }, 500);
  }

  return c.json({ logged: true });
});

// ---------------------------------------------------------------------------
// GET /api/auth/me
// ---------------------------------------------------------------------------
authRouter.get("/me", async (c) => {
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });

  if (!session) {
    return c.json({ user: null, store: null }, 401);
  }

  // Check if user has a store
  const db = createDb(c.env.DB);
  const storeRow = await db
    .select()
    .from(stores)
    .where(eq(stores.ownerId, session.user.id))
    .get();

  // Attach the plan view (tier, limits, pending change…) — the auth-context
  // store powers the dashboard banner, product limits and settings.
  const storeDomain = storeRow ? await new D1StoreRepository(db).findById(storeRow.id as EntityId) : null;
  const plan = storeDomain ? await new PlanService(new D1SubscriptionRepository(db)).viewOf(storeDomain) : null;

  const consentRow = await db
    .select({ c: count() })
    .from(consents)
    .where(eq(consents.userId, session.user.id))
    .get();

  return c.json({
    user: serializeUser(session.user),
    store: storeRow ? { ...serializeStoreRow(storeRow), plan } : null,
    hasConsent: (consentRow?.c ?? 0) > 0,
  });
});

export { authRouter };
