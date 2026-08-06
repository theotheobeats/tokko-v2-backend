#!/usr/bin/env node
/**
 * Promote (or demote) a user to admin role on the 7okko backend.
 *
 * Wraps `wrangler d1 execute` so no extra credentials are needed — the same
 * Cloudflare auth as `wrangler deploy` is used.
 *
 * Usage:
 *   node scripts/promote-admin.mjs <email> [--local|--remote] [--demote]
 *
 *   --local    target the local (wrangler dev) D1            [default]
 *   --remote   target the production D1 (tokko-db)
 *   --demote   set role back to "user"
 *
 * Example:
 *   node scripts/promote-admin.mjs owner@7okko.com --remote
 */
import { execSync } from "node:child_process";

const args = process.argv.slice(2);
const email = args.find((a) => !a.startsWith("--"));
const mode = args.includes("--remote") ? "remote" : "local";
const demote = args.includes("--demote");

if (!email) {
  console.error("Usage: node scripts/promote-admin.mjs <email> [--local|--remote] [--demote]");
  process.exit(1);
}

const dbName = "tokko-db";
const escaped = email.replace(/'/g, "''");
const role = demote ? "user" : "admin";
const sql = `UPDATE user SET role = '${role}' WHERE email = '${escaped}';`;

console.log(`[promote-admin] ${demote ? "demote" : "promote"} ${email} → role=${role} (${mode})`);
try {
  execSync(`npx wrangler d1 execute ${dbName} --${mode} --command "${sql}"`, {
    stdio: "inherit",
  });
} catch (err) {
  console.error("[promote-admin] failed — is the user registered and wrangler authenticated?");
  process.exit(1);
}
