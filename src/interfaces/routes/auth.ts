import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { createAuth } from "../../lib/auth";
import { createDb } from "../../infrastructure/db/drizzle";
import type { Env } from "../../types";
import { eq, count, and } from "drizzle-orm";
import { stores, consents, otpCodes, user, account, session } from "../../infrastructure/db/schema";
import { D1StoreRepository } from "../../infrastructure/repos/d1-store-repo";
import { D1SubscriptionRepository } from "../../infrastructure/repos/d1-subscription-repo";
import { PlanService } from "../../application/plan/plan-service";
import { createOtp, verifyOtp, OtpError, type OtpPurpose } from "../../application/auth/otp-service";
import { hashPassword } from "better-auth/crypto";
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
    payoutBankCode: row.payoutBankCode,
    payoutBankAccountNumber: row.payoutBankAccountNumber,
    payoutBankAccountName: row.payoutBankAccountName,
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
  emailVerified?: boolean;
  role?: string | null;
  banned?: boolean | null;
  image?: string | null;
}) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    emailVerified: u.emailVerified ?? false,
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

/** Login-style session payload (user + store + consent) — shared by login OTP verify. */
async function buildSessionPayload(
  db: ReturnType<typeof createDb>,
  session: { user: { id: string; name: string; email: string; emailVerified?: boolean; role?: string | null; banned?: boolean | null } },
) {
  const storeRow = await db.select().from(stores).where(eq(stores.ownerId, session.user.id)).get();
  const consentRow = await db.select({ c: count() }).from(consents).where(eq(consents.userId, session.user.id)).get();
  return {
    user: serializeUser(session.user),
    store: storeRow ? serializeStoreRow(storeRow) : null,
    hasConsent: (consentRow?.c ?? 0) > 0,
  };
}

/** Extract the better-auth session token from a cookie header (raw or Set-Cookie).
 * The cookie value is `{token}.{hmacSignature}` URL-encoded, and HTTPS
 * deployments prefix the name with `__Secure-` — mirror better-auth's own read. */
function sessionTokenFromCookie(cookieHeader: string): string | null {
  const m = cookieHeader.match(/(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=([^;\s]+)/);
  if (!m) return null;
  try {
    // URL-decode (%3D → =) then drop the signature suffix after the dot.
    return decodeURIComponent(m[1]).split(".")[0] ?? null;
  } catch {
    return null;
  }
}

/** Mark the session OTP-verified (Google/email login double-layer). */
async function markSessionVerified(db: ReturnType<typeof createDb>, cookieHeader: string | null): Promise<void> {
  const token = sessionTokenFromCookie(cookieHeader ?? "");
  if (!token) return;
  await db
    .update(session)
    .set({ otpVerifiedAt: new Date().toISOString() })
    .where(eq(session.token, token))
    .run();
}

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

    // Double-layer: WITHHOLD the session — it is released only after the
    // email OTP verifies. The session exists in the DB (server-side) so we
    // can still log consent now.
    const setCookie = headers?.get("set-cookie") ?? null;
    const session = setCookie
      ? await auth.api.getSession({ headers: new Headers({ cookie: setCookie }) })
      : null;

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
      }
    }

    const otp = await createOtp({
      db: createDb(c.env.DB),
      env: c.env,
      email,
      purpose: "register",
      sessionCookie: setCookie ?? undefined,
    });

    return c.json({
      otpRequired: true,
      attemptId: otp.attemptId,
      email,
      resendAfter: otp.sent ? undefined : 60,
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

    // Double-layer: WITHHOLD the session — released only after the email OTP
    // verifies. The session exists in the DB but the cookie never reaches the
    // client without the code.
    const setCookie = authHeaders?.get("set-cookie") ?? null;
    if (!setCookie) throw new Error("no session");

    const session = await auth.api.getSession({ headers: new Headers({ cookie: setCookie }) });
    if (!session) throw new Error("no session");

    const otp = await createOtp({
      db: createDb(c.env.DB),
      env: c.env,
      email,
      purpose: "login",
      sessionCookie: setCookie,
    });

    return c.json({
      otpRequired: true,
      attemptId: otp.attemptId,
      email,
      resendAfter: otp.sent ? undefined : 60,
    });
  } catch (error: any) {
    return c.json({
      error: { code: "INVALID_CREDENTIALS", message: "Email atau password salah." },
    }, 401);
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/otp/send  { email, purpose }  — double-layer OTP (email)
// ---------------------------------------------------------------------------
authRouter.post("/otp/send", zValidator("json", z.object({
  email: z.string().email(),
  purpose: z.enum(["register", "login", "password_reset", "email_change", "verify_email"]),
})), async (c) => {
  const { email, purpose } = c.req.valid("json");
  const db = createDb(c.env.DB);
  const auth = createAuth(c.env);

  if (purpose === "register" || purpose === "email_change") {
    const existing = await db.select({ id: user.id }).from(user).where(eq(user.email, email)).get();
    if (existing) {
      return c.json({ error: { code: "EMAIL_TAKEN", message: "Email sudah terdaftar." } }, 409);
    }
  }
  if (purpose === "login" || purpose === "password_reset") {
    const existing = await db.select({ id: user.id }).from(user).where(eq(user.email, email)).get();
    if (!existing) {
      return c.json({
        error: { code: "USER_NOT_FOUND", message: purpose === "login" ? "Email atau password salah." : "Akun tidak ditemukan." },
      }, 401);
    }
  }
  if (purpose === "email_change") {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) {
      return c.json({ error: { code: "UNAUTHORIZED", message: "Silakan login terlebih dahulu." } }, 401);
    }
  }
  // verify_email: re-send OTP to the SESSION user's email (account tab).
  if (purpose === "verify_email") {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) {
      return c.json({ error: { code: "UNAUTHORIZED", message: "Silakan login terlebih dahulu." } }, 401);
    }
    const otp = await createOtp({ db, env: c.env, email: session.user.email, purpose });
    return c.json({ attemptId: otp.attemptId, sent: otp.sent, resendAfter: otp.sent ? undefined : 60 });
  }

  const otp = await createOtp({ db, env: c.env, email, purpose });
  return c.json({ attemptId: otp.attemptId, sent: otp.sent, resendAfter: otp.sent ? undefined : 60 });
});

// ---------------------------------------------------------------------------
// POST /api/auth/otp/verify  { attemptId, code, newPassword? }
//   register: mark email verified + release withheld session
//   login:    release withheld session (payload = user/store/consent)
//   password_reset: set new password (newPassword required)
//   email_change:   update user email (session required)
// ---------------------------------------------------------------------------
authRouter.post("/otp/verify", zValidator("json", z.object({
  attemptId: z.string().min(8),
  code: z.string().regex(/^\d{6}$/, "Kode harus 6 digit"),
  newPassword: z.string().min(8).optional(),
})), async (c) => {
  const { attemptId, code, newPassword } = c.req.valid("json");
  const db = createDb(c.env.DB);
  const auth = createAuth(c.env);

  const row = await db.select().from(otpCodes).where(eq(otpCodes.attemptId, attemptId)).get();
  if (!row) return c.json({ error: { code: "OTP_INVALID", message: "Kode tidak valid." } }, 400);

  let verified;
  try {
    verified = await verifyOtp({ db, email: row.email, purpose: row.purpose as OtpPurpose, attemptId, code });
  } catch (e) {
    if (e instanceof OtpError) {
      const status = e.code === "OTP_EXPIRED" || e.code === "OTP_LOCKED" ? 410 : 400;
      return c.json({ error: { code: e.code, message: e.message } }, status);
    }
    return c.json({ error: { code: "UNKNOWN", message: "Verifikasi gagal." } }, 400);
  }

  switch (row.purpose) {
    case "register": {
      await db.update(user).set({ emailVerified: true }).where(eq(user.email, row.email)).run();
      const u = await db.select().from(user).where(eq(user.email, row.email)).get();
      await markSessionVerified(db, verified.sessionCookie);
      const res = c.json({
        verified: true,
        user: u
          ? serializeUser({ id: u.id, name: u.name, email: u.email, emailVerified: u.emailVerified, role: u.role, banned: u.banned })
          : null,
      });
      if (verified.sessionCookie) res.headers.set("set-cookie", verified.sessionCookie);
      return res;
    }
    case "login": {
      // Mark the session OTP-verified: either the withheld one (email/password
      // flow) or the CURRENT session (Google OAuth flow — no withheld cookie).
      await markSessionVerified(db, verified.sessionCookie ?? c.req.raw.headers.get("cookie"));
      const session = verified.sessionCookie
        ? await auth.api.getSession({ headers: new Headers({ cookie: verified.sessionCookie }) })
        : await auth.api.getSession({ headers: c.req.raw.headers });
      const res = c.json(session ? await buildSessionPayload(db, session) : { verified: true });
      if (verified.sessionCookie) res.headers.set("set-cookie", verified.sessionCookie);
      return res;
    }
    case "verify_email": {
      const session = await auth.api.getSession({ headers: c.req.raw.headers });
      if (!session) return c.json({ error: { code: "UNAUTHORIZED" } }, 401);
      await db.update(user).set({ emailVerified: true }).where(eq(user.id, session.user.id)).run();
      return c.json({ verified: true, message: "Email berhasil diverifikasi." });
    }
    case "password_reset": {
      if (!newPassword) {
        return c.json({ error: { code: "VALIDATION", message: "Kata sandi baru diperlukan." } }, 400);
      }
      const target = await db.select({ id: user.id }).from(user).where(eq(user.email, row.email)).get();
      if (!target) return c.json({ error: { code: "USER_NOT_FOUND" } }, 404);
      const hashed = await hashPassword(newPassword);
      const updated = await db
        .update(account)
        .set({ password: hashed })
        .where(and(eq(account.userId, target.id), eq(account.providerId, "credential")))
        .run();
      if (updated.meta.changes === 0) {
        return c.json({ error: { code: "NO_PASSWORD", message: "Akun ini tidak memiliki kata sandi (login Google)." } }, 400);
      }
      return c.json({ verified: true, message: "Kata sandi berhasil diubah. Silakan masuk." });
    }
    case "email_change": {
      const session = await auth.api.getSession({ headers: c.req.raw.headers });
      if (!session) return c.json({ error: { code: "UNAUTHORIZED" } }, 401);
      const updateUser = auth.api.updateUser as unknown as (p: {
        body: Record<string, unknown>;
        headers: Headers;
      }) => Promise<{
        user: { id: string; name: string; email: string; emailVerified?: boolean; role?: string | null; banned?: boolean | null };
      }>;
      const updated = await updateUser({ body: { email: row.email }, headers: c.req.raw.headers });
      return c.json({ verified: true, user: serializeUser(updated.user) });
    }
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
  const authSession = await auth.api.getSession({ headers: c.req.raw.headers });

  if (!authSession) {
    return c.json({ user: null, store: null }, 401);
  }

  // Check if user has a store
  const db = createDb(c.env.DB);
  const storeRow = await db
    .select()
    .from(stores)
    .where(eq(stores.ownerId, authSession.user.id))
    .get();

  // Attach the plan view (tier, limits, pending change…) — the auth-context
  // store powers the dashboard banner, product limits and settings.
  const storeDomain = storeRow ? await new D1StoreRepository(db).findById(storeRow.id as EntityId) : null;
  const plan = storeDomain ? await new PlanService(new D1SubscriptionRepository(db)).viewOf(storeDomain) : null;

  const consentRow = await db
    .select({ c: count() })
    .from(consents)
    .where(eq(consents.userId, authSession.user.id))
    .get();

  // OTP double-layer gate: Google OAuth (and pre-feature sessions) have no
  // otp_verified_at marker — the app must require the OTP once per session.
  const token = sessionTokenFromCookie(c.req.raw.headers.get("cookie") ?? "");
  const otpRow = token
    ? await db.select({ otpVerifiedAt: session.otpVerifiedAt }).from(session).where(eq(session.token, token)).get()
    : null;

  return c.json({
    user: serializeUser(authSession.user),
    store: storeRow ? { ...serializeStoreRow(storeRow), plan } : null,
    hasConsent: (consentRow?.c ?? 0) > 0,
    otpPending: !otpRow?.otpVerifiedAt,
  });
});

export { authRouter };
