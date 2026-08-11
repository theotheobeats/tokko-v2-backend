#!/usr/bin/env node
/**
 * Seed Indonesian administrative regions (Kepmendagri 2025) into D1.
 *
 * Sources:
 *   - wilayah.sql  (cahyadsn/wilayah)  — region codes + names
 *   - wilayah_kodepos.json (cahyadsn/wilayah_kodepos) — kelurahan → kodepos
 *
 * Usage: node scripts/seed-regions.mjs [--local|--remote] [--fresh]
 *   --local   seed the local (wrangler dev) D1   [default]
 *   --remote  seed the production D1
 *   --fresh   DROP the regions table first
 *
 * Idempotent: uses INSERT OR IGNORE, so re-runs are safe. Level-4 (villages,
 * ~83k rows) is chunked per province to keep each file small for D1.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const target = process.argv.includes("--remote") ? "--remote" : "--local";
const fresh = process.argv.includes("--fresh");

const WILAYAH_SQL = "https://raw.githubusercontent.com/cahyadsn/wilayah/master/db/wilayah.sql";
const KODEPOS_JSON = "https://raw.githubusercontent.com/cahyadsn/wilayah_kodepos/master/json/wilayah_kodepos.json";

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed ${url}: ${res.status}`);
  return res.text();
}

function parseWilayah(sql) {
  const rows = [];
  const re = /\('([^']+)','([^']+)'\)/g;
  let m;
  while ((m = re.exec(sql)) !== null) rows.push([m[1], m[2]]);
  return rows;
}

const levelOf = (code) => (code.length === 2 ? 1 : code.length === 5 ? 2 : code.length === 8 ? 3 : code.length === 13 ? 4 : 0);
const parentOf = (code, level) => (level <= 1 ? null : code.slice(0, code.lastIndexOf(".")));
const esc = (s) => (s ?? "").replace(/'/g, "''");

function toTuples(rows, kodepos) {
  return rows.map(([code, name]) => {
    const level = levelOf(code);
    return [code, name, level, parentOf(code, level), level === 4 ? kodepos[code] ?? null : null];
  });
}

/** INSERT OR IGNORE statements of ≤ batchSize tuples. */
function insertStatements(tuples, batchSize = 500) {
  const stmts = [];
  for (let i = 0; i < tuples.length; i += batchSize) {
    const chunk = tuples.slice(i, i + batchSize);
    const values = chunk
      .map(([code, name, level, parent, kodepos]) =>
        `('${esc(code)}','${esc(name)}',${level},${parent ? `'${esc(parent)}'` : "NULL"},${kodepos ? `'${esc(kodepos)}'` : "NULL"})`)
      .join(",");
    stmts.push(`INSERT OR IGNORE INTO regions (code, name, level, parent_code, kodepos) VALUES ${values};`);
  }
  return stmts;
}

const tmp = mkdtempSync(join(tmpdir(), "tokko-regions-"));
try {
  console.log(`\n⬇️  Downloading wilayah data (2025)…`);
  const [sql, kodeposRaw] = await Promise.all([download(WILAYAH_SQL), download(KODEPOS_JSON)]);
  const kodepos = JSON.parse(kodeposRaw);
  const all = toTuples(parseWilayah(sql), kodepos);
  console.log(`   parsed ${all.length} region rows`);

  const files = [];
  const emit = (name, tuples) => {
    const stmts = insertStatements(tuples);
    const file = join(tmp, name);
    writeFileSync(file, stmts.join("\n"));
    files.push([name, file, tuples.length]);
  };

  emit("seed-l1-provinsi.sql", all.filter((r) => r[2] === 1));
  emit("seed-l2-kabkota.sql", all.filter((r) => r[2] === 2));
  emit("seed-l3-kecamatan.sql", all.filter((r) => r[2] === 3));
  // Villages chunked per province (first 2 chars of the code) — keeps each
  // file small enough for D1's statement limits.
  const byProvince = new Map();
  for (const r of all) {
    if (r[2] !== 4) continue;
    const key = r[0].slice(0, 2);
    if (!byProvince.has(key)) byProvince.set(key, []);
    byProvince.get(key).push(r);
  }
  for (const [prov, rows] of [...byProvince.entries()].sort()) {
    emit(`seed-l4-villages-${prov}.sql`, rows);
  }

  const dbName = process.env.D1_DB ?? "tokko-db";
  const run = (file, label) => {
    process.stdout.write(`   ${label} … `);
    try {
      execFileSync("npx", ["wrangler", "d1", "execute", dbName, target, "--file", file], { stdio: "inherit", cwd: process.cwd() });
      console.log("ok");
    } catch {
      console.log(`\n   ✘ FAILED on ${label} — aborting.`);
      process.exit(1);
    }
  };

  if (fresh) {
    console.log("\n🧹 Dropping existing regions table…");
    runCommand(`DROP TABLE IF EXISTS regions;`, "drop");
  }

  console.log(`\n🚀 Seeding ${target.replace("--", "")} D1…`);
  for (const [name, file] of files) run(file, name);
  for (const [name, , n] of files) console.log(`   ${name}: ${n} rows`);

  runCommand("SELECT level, COUNT(*) AS n FROM regions GROUP BY level ORDER BY level;", "verify");
  console.log("\n✅ Seed complete.");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

function runCommand(command, label) {
  process.stdout.write(`   ${label} … `);
  try {
    execFileSync("npx", ["wrangler", "d1", "execute", "tokko-db", target, "--command", command], { stdio: "inherit", cwd: process.cwd() });
    console.log("ok");
  } catch {
    console.log(`\n   ✘ FAILED on ${label}`);
    process.exit(1);
  }
}
