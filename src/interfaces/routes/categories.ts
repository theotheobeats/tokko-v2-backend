import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { createAuth } from "../../lib/auth";
import { createDb } from "../../infrastructure/db/drizzle";
import type { Env } from "../../types";
import { D1CategoryRepository } from "../../infrastructure/repos/d1-category-repo";
import { D1StoreRepository } from "../../infrastructure/repos/d1-store-repo";
import {
  ListCategories,
  CreateCategory,
  UpdateCategory,
  DeleteCategory,
} from "../../application/product/category-use-cases";
import type { EntityId } from "../../domain/shared/types";

/**
 * Product category routes (mounted under /api/stores):
 *   GET    /:storeId/categories        — public if store published
 *   POST   /:storeId/categories        — store owner
 *   PATCH  /:storeId/categories/:id    — store owner
 *   DELETE /:storeId/categories/:id    — store owner
 */

const categoriesRouter = new Hono<{ Bindings: Env }>();

async function requireAuth(c: any) {
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "Silakan login terlebih dahulu." } }, 401);
  }
  return session;
}

const categorySchema = z.object({ name: z.string().min(1) });

// ---------------------------------------------------------------------------
// GET /api/stores/:storeId/categories
// ---------------------------------------------------------------------------
categoriesRouter.get("/:storeId/categories", async (c) => {
  const storeId = c.req.param("storeId") as EntityId;
  const db = createDb(c.env.DB);
  const storeRepo = new D1StoreRepository(db);

  const store = await storeRepo.findById(storeId);
  if (!store) {
    return c.json({ error: { code: "NOT_FOUND", message: "Toko tidak ditemukan." } }, 404);
  }

  if (!store.isPublished) {
    const session = await requireAuth(c);
    if (session instanceof Response) return session;
    if (store.ownerId !== session.user.id) {
      return c.json({ error: { code: "FORBIDDEN", message: "Akses ditolak." } }, 403);
    }
  }

  const useCase = new ListCategories(new D1CategoryRepository(db));
  const result = await useCase.execute({ storeId });

  if (!result.ok) return c.json({ error: { code: "UNKNOWN" } }, 500);
  return c.json({ categories: result.value });
});

// ---------------------------------------------------------------------------
// POST /api/stores/:storeId/categories
// ---------------------------------------------------------------------------
categoriesRouter.post("/:storeId/categories", zValidator("json", categorySchema), async (c) => {
  const session = await requireAuth(c);
  if (session instanceof Response) return session;

  const storeId = c.req.param("storeId") as EntityId;
  const db = createDb(c.env.DB);
  const storeRepo = new D1StoreRepository(db);

  const store = await storeRepo.findById(storeId);
  if (!store) return c.json({ error: { code: "NOT_FOUND" } }, 404);
  if (store.ownerId !== session.user.id) {
    return c.json({ error: { code: "FORBIDDEN", message: "Hanya pemilik toko." } }, 403);
  }

  const input = c.req.valid("json");
  const useCase = new CreateCategory(new D1CategoryRepository(db));
  const result = await useCase.execute({ storeId, name: input.name });

  if (!result.ok) {
    return c.json({ error: result.error }, 400);
  }
  return c.json({ category: result.value }, 201);
});

// ---------------------------------------------------------------------------
// PATCH /api/stores/:storeId/categories/:id
// ---------------------------------------------------------------------------
categoriesRouter.patch("/:storeId/categories/:id", zValidator("json", categorySchema), async (c) => {
  const session = await requireAuth(c);
  if (session instanceof Response) return session;

  const storeId = c.req.param("storeId") as EntityId;
  const categoryId = c.req.param("id") as EntityId;
  const db = createDb(c.env.DB);
  const storeRepo = new D1StoreRepository(db);

  const store = await storeRepo.findById(storeId);
  if (!store) return c.json({ error: { code: "NOT_FOUND" } }, 404);
  if (store.ownerId !== session.user.id) {
    return c.json({ error: { code: "FORBIDDEN", message: "Hanya pemilik toko." } }, 403);
  }

  const input = c.req.valid("json");
  const useCase = new UpdateCategory(new D1CategoryRepository(db));
  const result = await useCase.execute({ categoryId, name: input.name });

  if (!result.ok) {
    return c.json({ error: result.error }, result.error.code === "NOT_FOUND" ? 404 : 400);
  }
  return c.json({ category: result.value });
});

// ---------------------------------------------------------------------------
// DELETE /api/stores/:storeId/categories/:id
// ---------------------------------------------------------------------------
categoriesRouter.delete("/:storeId/categories/:id", async (c) => {
  const session = await requireAuth(c);
  if (session instanceof Response) return session;

  const storeId = c.req.param("storeId") as EntityId;
  const categoryId = c.req.param("id") as EntityId;
  const db = createDb(c.env.DB);
  const storeRepo = new D1StoreRepository(db);

  const store = await storeRepo.findById(storeId);
  if (!store) return c.json({ error: { code: "NOT_FOUND" } }, 404);
  if (store.ownerId !== session.user.id) {
    return c.json({ error: { code: "FORBIDDEN", message: "Hanya pemilik toko." } }, 403);
  }

  const useCase = new DeleteCategory(new D1CategoryRepository(db));
  const result = await useCase.execute({ categoryId });

  if (!result.ok) {
    return c.json({ error: result.error }, 404);
  }
  return c.json({ success: true });
});

export { categoriesRouter };
