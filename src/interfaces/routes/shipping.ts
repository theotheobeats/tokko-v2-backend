import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { createAuth } from "../../lib/auth";
import { createDb } from "../../infrastructure/db/drizzle";
import type { Env } from "../../types";
import { D1StoreRepository } from "../../infrastructure/repos/d1-store-repo";
import { D1ProductRepository } from "../../infrastructure/repos/d1-product-repo";
import { GetShippingRates } from "../../application/shipping/get-shipping-rates";
import { createShippingProvider } from "../../infrastructure/shipping/biteship-client";
import type { EntityId } from "../../domain/shared/types";

/**
 * Shipping routes (mounted under /api/stores):
 *   POST  /:storeId/shipping/rates  — Biteship courier options (public if published)
 *   PATCH /:storeId/shipping        — store shipping origin settings (owner)
 */

const shippingRouter = new Hono<{ Bindings: Env }>();

async function requireAuth(c: any) {
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "Silakan login terlebih dahulu." } }, 401);
  }
  return session;
}

const ratesSchema = z.object({
  destinationPostalCode: z.string().min(3),
  items: z.array(z.object({
    productId: z.string().min(1),
    quantity: z.number().int().min(1),
  })).min(1),
});

// ---------------------------------------------------------------------------
// POST /api/stores/:storeId/shipping/rates
// ---------------------------------------------------------------------------
shippingRouter.post("/:storeId/shipping/rates", zValidator("json", ratesSchema), async (c) => {
  const storeId = c.req.param("storeId") as EntityId;
  const db = createDb(c.env.DB);
  const storeRepo = new D1StoreRepository(db);

  // Public if store is published, else require auth
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

  const body = c.req.valid("json");
  const useCase = new GetShippingRates(
    storeRepo,
    new D1ProductRepository(db),
    createShippingProvider(c.env as Env),
  );
  const result = await useCase.execute({
    storeId,
    destinationPostalCode: body.destinationPostalCode,
    items: body.items.map((i) => ({ productId: i.productId as EntityId, quantity: i.quantity })),
  });

  if (!result.ok) {
    const status = result.error.code === "NOT_FOUND" ? 404 : result.error.code === "PROVIDER_UNAVAILABLE" ? 503 : 400;
    return c.json({ error: result.error }, status);
  }
  return c.json({ options: result.value });
});

// ---------------------------------------------------------------------------
// NOTE: the store shipping-origin PATCH lives in stores.ts
// (PATCH /api/stores/:id/shipping — full field set incl. RT/RW/kelurahan/
// kecamatan/city/province). It was previously duplicated here with a partial
// schema and silently shadowed — removed to avoid confusion.

export { shippingRouter };
