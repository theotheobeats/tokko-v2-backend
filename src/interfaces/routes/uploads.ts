import { Hono } from "hono";
import type { Env } from "../../types";
import { createAuth } from "../../lib/auth";
import { createDb } from "../../infrastructure/db/drizzle";
import { D1StoreRepository } from "../../infrastructure/repos/d1-store-repo";
import { UploadImage } from "../../application/upload/upload-image";
import type { EntityId } from "../../domain/shared/types";

const uploadsRouter = new Hono<{ Bindings: Env }>();

async function requireOwner(c: any, storeId: EntityId) {
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "Silakan login terlebih dahulu." } }, 401);
  }

  const db = createDb(c.env.DB);
  const storeRepo = new D1StoreRepository(db);
  const store = await storeRepo.findById(storeId);

  if (!store) return c.json({ error: { code: "NOT_FOUND" } }, 404);
  if (store.ownerId !== session.user.id) {
    return c.json({ error: { code: "FORBIDDEN" } }, 403);
  }
  return { store, db };
}

// ---------------------------------------------------------------------------
// POST /api/stores/:storeId/upload
// (mounted under /api — path below becomes /api/stores/:storeId/upload)
// ---------------------------------------------------------------------------
uploadsRouter.post("/stores/:storeId/upload", async (c) => {
  const storeId = c.req.param("storeId") as EntityId;
  const owner = await requireOwner(c, storeId);
  if (owner instanceof Response) return owner;

  const formData = await c.req.formData();
  const file = formData.get("file") as File | null;
  const purpose = (formData.get("purpose") as string) ?? "product";

  if (!file) {
    return c.json({ error: { code: "VALIDATION", message: "File wajib diunggah." } }, 400);
  }

  if (purpose !== "product" && purpose !== "hero") {
    return c.json({ error: { code: "VALIDATION", message: "Purpose harus 'product' atau 'hero'." } }, 400);
  }

  // Use R2 storage adapter
  const storage = {
    put: async (key: string, body: ArrayBuffer | Uint8Array, opts?: { contentType?: string }) => {
      await c.env.IMAGES.put(key, body, { httpMetadata: { contentType: opts?.contentType } });
    },
    getUrl: (key: string) => `${new URL(c.req.url).origin}/api/images/${key}`,
  };

  const useCase = new UploadImage(storage);
  const result = await useCase.execute({ storeId, file, purpose });

  if (!result.ok) {
    const status = result.error.code === "FILE_TOO_LARGE" ? 400 : 400;
    return c.json({ error: result.error }, status);
  }

  return c.json(result.value, 201);
});

// ---------------------------------------------------------------------------
// GET /api/images/* — keys contain slashes (stores/<id>/<uuid>.png).
// NOTE: Hono's `*` catch-all matches the route but does NOT expose a param in
// this version, so the key is derived from the request path instead.
// ---------------------------------------------------------------------------
uploadsRouter.get("/images/*", async (c) => {
  const key = c.req.path.replace(/^\/api\/images\//, "");
  const object = await c.env.IMAGES.get(key);

  if (!object) {
    return c.json({ error: { code: "NOT_FOUND", message: "Gambar tidak ditemukan." } }, 404);
  }

  c.header("Content-Type", object.httpMetadata?.contentType ?? "application/octet-stream");
  c.header("Cache-Control", "public, max-age=31536000, immutable");
  return c.body(object.body);
});

export { uploadsRouter };
