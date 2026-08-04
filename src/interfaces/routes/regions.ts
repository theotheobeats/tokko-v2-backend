import { Hono, type Context } from "hono";
import type { Env } from "../../types";

/**
 * Public Indonesian region lookup — powers the checkout address cascade.
 *
 *   GET /api/regions/provinces
 *   GET /api/regions/regencies/:provinceCode
 *   GET /api/regions/districts/:regencyCode
 *   GET /api/regions/villages/:districtCode   (includes kodepos)
 *
 * Data: Kepmendagri No 300.2.2-2430 (2025), seeded into D1 `regions` table.
 * Results are ordered by official code (geographical adjacency) and are safe
 * to cache — the dataset changes roughly yearly.
 */

const regionsRouter = new Hono<{ Bindings: Env }>();

const CACHE = "public, max-age=86400, s-maxage=86400";

interface RegionRow {
  code: string;
  name: string;
  kodepos: string | null;
}

async function listByParent(c: Context<{ Bindings: Env }>, parentCode: string, level: number): Promise<Response> {
  const { results } = await c.env.DB.prepare(
    "SELECT code, name, kodepos FROM regions WHERE parent_code = ? AND level = ? ORDER BY code",
  )
    .bind(parentCode, level)
    .all<RegionRow>();
  c.header("Cache-Control", CACHE);
  return c.json(results.map((r) => ({ code: r.code, name: r.name, ...(r.kodepos ? { kodepos: r.kodepos } : {}) })));
}

regionsRouter.get("/provinces", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT code, name, kodepos FROM regions WHERE level = 1 ORDER BY code",
  ).all<RegionRow>();
  c.header("Cache-Control", CACHE);
  return c.json(results.map((r) => ({ code: r.code, name: r.name })));
});

regionsRouter.get("/regencies/:provinceCode", (c) =>
  listByParent(c, c.req.param("provinceCode"), 2));

regionsRouter.get("/districts/:regencyCode", (c) =>
  listByParent(c, c.req.param("regencyCode"), 3));

regionsRouter.get("/villages/:districtCode", (c) =>
  listByParent(c, c.req.param("districtCode"), 4));

export { regionsRouter };
