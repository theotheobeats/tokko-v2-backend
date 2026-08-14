/**
 * OTP service — the auth double-layer.
 *
 * One code per (email, purpose): register | login | password_reset |
 * email_change. Codes are 6 digits, hashed (sha256 of `email:purpose:code`),
 * expire after OTP_TTL_MIN, max OTP_MAX_ATTEMPTS tries, resend gated by
 * OTP_RESEND_SECONDS. `attemptId` is the public handle for the verify step —
 * the raw code never leaves the email.
 *
 * For register/login, the caller WITHHOLDS the better-auth session cookie
 * (created at step 1) in `session_cookie`; it is released to the response only
 * after verifyOtp succeeds — no session reaches the client before OTP.
 */

import type { Env } from "../../types";
import type { DbClient } from "../../infrastructure/db/drizzle";
import { ResendEmailer } from "../../infrastructure/email/resend";
import { otpCodes } from "../../infrastructure/db/schema";
import { eq, and, isNull } from "drizzle-orm";

export type OtpPurpose = "register" | "login" | "password_reset" | "email_change" | "verify_email";

export class OtpError extends Error {
  constructor(
    public code: "OTP_RATE_LIMITED" | "OTP_EXPIRED" | "OTP_INVALID" | "OTP_LOCKED",
    message: string,
  ) {
    super(message);
  }
}

const OTP_TTL_MIN = 10;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_SECONDS = 60;

const PURPOSE_LABEL: Record<OtpPurpose, string> = {
  register: "verifikasi pendaftaran",
  login: "verifikasi masuk",
  password_reset: "reset kata sandi",
  email_change: "perubahan email",
  verify_email: "verifikasi email",
};

/** "YYYY-MM-DD HH:MM:SS" UTC — matches SQLite datetime('now'). */
function utcStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

async function sha256Hex(data: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function generateCode(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const n = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  return String(100000 + (n % 900000)); // 6 digits
}

function otpHtml(email: string, code: string, purposeLabel: string): string {
  return `
    <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <h2 style="color:#1c1917;margin:0 0 12px">Kode ${purposeLabel} kamu</h2>
      <p style="color:#57534b;font-size:15px;line-height:1.6;margin:0 0 20px">
        Gunakan kode di bawah untuk ${purposeLabel} akun 7okko kamu. Kode berlaku <strong>10 menit</strong>.
      </p>
      <div style="text-align:center;background:#faf9f7;border:1px solid #eee;border-radius:12px;padding:20px;font-size:32px;font-weight:800;letter-spacing:8px;color:#1c1917">
        ${code}
      </div>
      <p style="color:#a8a29a;font-size:12px;margin:20px 0 0">
        Jika kamu tidak meminta kode ini, abaikan email ini. Dikirim ke ${email}.
      </p>
    </div>`;
}

export interface CreateOtpResult {
  attemptId: string;
  /** True when a new code was sent; false when rate-limited by resend window. */
  sent: boolean;
}

/** Create + email an OTP for (email, purpose). Returns the public attemptId. */
export async function createOtp(params: {
  db: DbClient;
  env: Env;
  email: string;
  purpose: OtpPurpose;
  /** Withheld better-auth Set-Cookie (register/login step 1). */
  sessionCookie?: string;
}): Promise<CreateOtpResult> {
  const { db, env, email, purpose } = params;
  const now = utcStamp(new Date());

  // Resend window: an active (unconsumed, unexpired) code from < 60s ago.
  const existing = await db
    .select()
    .from(otpCodes)
    .where(and(eq(otpCodes.email, email), eq(otpCodes.purpose, purpose), isNull(otpCodes.consumedAt)))
    .orderBy(otpCodes.createdAt)
    .get();

  if (existing && existing.expiresAt > now) {
    const ageMs = Date.now() - new Date(existing.createdAt.replace(" ", "T") + "Z").getTime();
    if (ageMs < OTP_RESEND_SECONDS * 1000) {
      return { attemptId: existing.attemptId, sent: false }; // still fresh — client can resubmit
    }
  }

  const code = generateCode();
  const attemptId = crypto.randomUUID();
  await db.insert(otpCodes).values({
    id: crypto.randomUUID(),
    email,
    purpose,
    codeHash: await sha256Hex(`${email}:${purpose}:${code}`),
    attemptId,
    sessionCookie: params.sessionCookie ?? null,
    expiresAt: utcStamp(new Date(Date.now() + OTP_TTL_MIN * 60 * 1000)),
    attempts: 0,
  });

  const sent = await new ResendEmailer(env).send({
    to: email,
    subject: `Kode ${PURPOSE_LABEL[purpose]} — 7okko`,
    html: otpHtml(email, code, PURPOSE_LABEL[purpose]),
    text: `Kode ${PURPOSE_LABEL[purpose]} 7okko: ${code} (berlaku 10 menit)`,
  });

  return { attemptId, sent };
}

/** Verify an OTP; on success returns the row (with the withheld session cookie when present). */
export async function verifyOtp(params: {
  db: DbClient;
  email: string;
  purpose: OtpPurpose;
  attemptId: string;
  code: string;
}): Promise<typeof otpCodes.$inferSelect> {
  const { db, email, purpose, attemptId, code } = params;

  const row = await db
    .select()
    .from(otpCodes)
    .where(and(eq(otpCodes.attemptId, attemptId), eq(otpCodes.email, email), eq(otpCodes.purpose, purpose)))
    .get();

  const now = utcStamp(new Date());
  if (!row || row.expiresAt < now || row.consumedAt) {
    throw new OtpError("OTP_EXPIRED", "Kode sudah kedaluwarsa. Minta kode baru.");
  }
  if (row.attempts >= OTP_MAX_ATTEMPTS) {
    throw new OtpError("OTP_LOCKED", "Terlalu banyak percobaan. Minta kode baru.");
  }

  const hash = await sha256Hex(`${email}:${purpose}:${code}`);
  if (hash !== row.codeHash) {
    await db
      .update(otpCodes)
      .set({ attempts: row.attempts + 1 })
      .where(eq(otpCodes.id, row.id))
      .run();
    const left = OTP_MAX_ATTEMPTS - (row.attempts + 1);
    throw new OtpError("OTP_INVALID", left > 0 ? `Kode salah. ${left} percobaan tersisa.` : "Kode salah. Minta kode baru.");
  }

  await db
    .update(otpCodes)
    .set({ consumedAt: now })
    .where(eq(otpCodes.id, row.id))
    .run();

  return { ...row, consumedAt: now };
}
