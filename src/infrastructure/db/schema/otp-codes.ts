import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/**
 * OTP codes — the auth double-layer (register/login/password-reset/email-change).
 *
 * Codes are stored HASHED (sha256 of `email:purpose:code`) and expire after
 * OTP_TTL (10 min). `attempt_id` is the public handle returned to the client
 * — the raw code is never returned. For register/login, the better-auth
 * session created at step 1 is WITHHELD in `session_cookie` and only released
 * to the response once the code verifies (no session reaches the client
 * before OTP). One active code per (email, purpose); resend gated by
 * OTP_RESEND_WINDOW.
 */
export const otpCodes = sqliteTable("otp_codes", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  /** register | login | password_reset | email_change */
  purpose: text("purpose").notNull(),
  codeHash: text("code_hash").notNull(),
  /** Public handle for the verify step — unique, short-lived. */
  attemptId: text("attempt_id").notNull().unique(),
  /** Withheld better-auth Set-Cookie (register/login) — released on verify. */
  sessionCookie: text("session_cookie"),
  expiresAt: text("expires_at").notNull(),
  attempts: integer("attempts").notNull().default(0),
  consumedAt: text("consumed_at"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});
