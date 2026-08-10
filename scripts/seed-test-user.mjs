#!/usr/bin/env node
/**
 * Seed a test account (email + password) into the 7okko backend database.
 *
 * Uses better-auth's OWN password hashing (@better-auth/utils/password —
 * scrypt N=16384, r=16, p=1, dkLen=64, `salt:key` hex format) so the seeded
 * account logs in exactly like a normally-registered one. Writes the SQL to a
 * temp file and runs `wrangler d1 execute --file` (same pattern as the
 * existing seed-demo-stores.ts) so quoting is never an issue.
 *
 * Usage:
 *   node scripts/seed-test-user.mjs <email> <password> [--local|--remote] [--admin]
 *
 *   --local    target the local (wrangler dev) D1            [default]
 *   --remote   target the production D1 (tokko-db)
 *   --admin    also grant the admin role
 *
 * Example:
 *   node scripts/seed-test-user.mjs test@7okko.com 'Test123!' --remote
 *   node scripts/seed-test-user.mjs owner@7okko.com 'S3cret!' --remote --admin
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashPassword } from "@better-auth/utils/password";

const args = process.argv.slice(2);
const email = args.find((a) => !a.startsWith("--"));
const password = args.slice(args.indexOf(email) + 1).find((a) => !a.startsWith("--"));
const mode = args.includes("--remote") ? "remote" : "local";
const admin = args.includes("--admin");

if (!email || !password) {
  console.error("Usage: node scripts/seed-test-user.mjs <email> <password> [--local|--remote] [--admin]");
  process.exit(1);
}
if (password.length < 8) {
  console.error("[seed-test-user] password must be at least 8 characters");
  process.exit(1);
}

const dbName = "tokko-db";
const now = Date.now();

async function main() {
  // Hash exactly like better-auth does at sign-up.
  const hash = await hashPassword(password);

  const userId = `seed-${randomUUID()}`;
  const accountId = `seed-${randomUUID()}`;
  const esc = (s) => s.replace(/'/g, "''");
  const role = admin ? "admin" : "user";

  const sql = `
-- idempotent: drop any existing rows for this email first
DELETE FROM account WHERE user_id IN (SELECT id FROM user WHERE email = '${esc(email)}');
DELETE FROM user WHERE email = '${esc(email)}';

INSERT INTO user (id, name, email, email_verified, image, role, banned, ban_reason, ban_expires, created_at, updated_at)
VALUES ('${userId}', '${esc(email.split("@")[0])}', '${esc(email)}', 1, NULL, '${role}', 0, NULL, NULL, ${now}, ${now});

INSERT INTO account (id, account_id, provider_id, user_id, access_token, refresh_token, id_token, access_token_expires_at, refresh_token_expires_at, scope, password, created_at, updated_at)
VALUES ('${accountId}', '${userId}', 'credential', '${userId}', NULL, NULL, NULL, NULL, NULL, NULL, '${esc(hash)}', ${now}, ${now});
`.trim();

  const sqlFile = join(tmpdir(), `seed-test-user-${Date.now()}.sql`);
  writeFileSync(sqlFile, sql + "\n");

  console.log(`[seed-test-user] ${email} → role=${role} (${mode})`);
  try {
    execSync(`npx wrangler d1 execute ${dbName} --${mode} --file "${sqlFile}"`, {
      stdio: "inherit",
      env: { ...process.env, NO_COLOR: "1" },
    });
    console.log(`\n[seed-test-user] done. Login with:\n  email:    ${email}\n  password: ${password}`);
  } catch (err) {
    console.error("[seed-test-user] failed — check wrangler auth (npx wrangler whoami)");
    process.exitCode = 1;
  } finally {
    unlinkSync(sqlFile);
  }
}

main();
