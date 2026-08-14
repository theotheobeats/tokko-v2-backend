import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { createOtp, verifyOtp, OtpError } from "../../../src/application/auth/otp-service";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { otpCodes } from "../../../src/infrastructure/db/schema";
import type { Env } from "../../../src/types";

function makeDb() {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE otp_codes (
      id TEXT PRIMARY KEY NOT NULL,
      email TEXT NOT NULL,
      purpose TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      attempt_id TEXT NOT NULL UNIQUE,
      session_cookie TEXT,
      expires_at TEXT NOT NULL,
      attempts INTEGER DEFAULT 0 NOT NULL,
      consumed_at TEXT,
      created_at TEXT DEFAULT (datetime('now')) NOT NULL
    );
  `);
  return drizzle(sqlite);
}

const env = {} as Env; // no RESEND_API_KEY → email send skipped, code still stored

function utcFuture(minutes: number): string {
  const d = new Date(Date.now() + minutes * 60_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

/** Insert a row with a known code so verify can succeed deterministically. */
function seedKnownCode(db: ReturnType<typeof makeDb>, code = "123456", purpose = "login") {
  const codeHash = createHash("sha256").update(`a@b.com:${purpose}:${code}`).digest("hex");
  db.run(sql`INSERT INTO otp_codes (id, email, purpose, code_hash, attempt_id, expires_at, attempts)
    VALUES ('x', 'a@b.com', ${purpose}, ${codeHash}, 'known-attempt', ${utcFuture(10)}, 0)`);
  return { attemptId: "known-attempt", code };
}

describe("OTP service", () => {
  let db: ReturnType<typeof makeDb>;

  beforeEach(() => {
    db = makeDb();
  });

  it("stores a hashed code — the raw code never touches the DB", async () => {
    const created = await createOtp({ db, env, email: "a@b.com", purpose: "login" });
    expect(created.attemptId).toBeTruthy();

    const rows = db.select().from(otpCodes).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].codeHash).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
    expect(created.sent).toBe(false); // no RESEND_API_KEY → skipped, code still active
  });

  it("rejects a wrong code and counts attempts", async () => {
    const { attemptId } = await createOtp({ db, env, email: "a@b.com", purpose: "login" });
    await expect(verifyOtp({ db, email: "a@b.com", purpose: "login", attemptId, code: "000000" })).rejects.toBeInstanceOf(OtpError);

    const row = db.select().from(otpCodes).all()[0];
    expect(row.attempts).toBe(1);
  });

  it("locks after max attempts", async () => {
    const { attemptId } = await createOtp({ db, env, email: "a@b.com", purpose: "login" });
    for (let i = 0; i < 5; i++) {
      await verifyOtp({ db, email: "a@b.com", purpose: "login", attemptId, code: "000000" }).catch(() => {});
    }
    await expect(verifyOtp({ db, email: "a@b.com", purpose: "login", attemptId, code: "000000" })).rejects.toMatchObject({ code: "OTP_LOCKED" });
  });

  it("rejects expired codes", async () => {
    const { attemptId } = await createOtp({ db, env, email: "a@b.com", purpose: "register" });
    db.run(sql`UPDATE otp_codes SET expires_at = '2000-01-01 00:00:00' WHERE attempt_id = ${attemptId}`);
    await expect(verifyOtp({ db, email: "a@b.com", purpose: "register", attemptId, code: "123456" })).rejects.toMatchObject({ code: "OTP_EXPIRED" });
  });

  it("enforces the resend window (one active code per email+purpose)", async () => {
    const first = await createOtp({ db, env, email: "a@b.com", purpose: "login" });
    const second = await createOtp({ db, env, email: "a@b.com", purpose: "login" });
    expect(second.attemptId).toBe(first.attemptId); // resend-window hit → same attempt
    expect(second.sent).toBe(false);
  });

  it("consumes the code after a successful verify — replays are rejected", async () => {
    const { attemptId, code } = seedKnownCode(db);
    await verifyOtp({ db, email: "a@b.com", purpose: "login", attemptId, code });
    const row = db.select().from(otpCodes).all()[0];
    expect(row.consumedAt).toBeTruthy();
    await expect(verifyOtp({ db, email: "a@b.com", purpose: "login", attemptId, code })).rejects.toMatchObject({ code: "OTP_EXPIRED" });
  });

  it("hashPassword/verifyPassword roundtrip works for OTP-gated resets", async () => {
    const hashed = await hashPassword("NewPass123!");
    expect(await verifyPassword({ hash: hashed, password: "NewPass123!" })).toBe(true);
    expect(await verifyPassword({ hash: hashed, password: "WrongPass!" })).toBe(false);
  });
});
