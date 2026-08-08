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
// PATCH /api/stores/:storeId/shipping
// ---------------------------------------------------------------------------
const originSchema = z.object({
  originAddress: z.string().optional(),
  originPostalCode: z.string().optional(),
  originContactName: z.string().optional(),
  originContactPhone: z.string().optional(),
  originLatitude: z.number().nullable().optional(),
  originLongitude: z.number().nullable().optional(),
});

shippingRouter.patch("/:storeId/shipping", zValidator("json", originSchema), async (c) => {
  const session = await requireAuth(c);
  if (session instanceof Response) return session;

  const storeId = c.req.param("storeId") as EntityId;
  const db = createDb(c.env.DB);
  const storeRepo = new D1StoreRepository(db);
  const store = await storeRepo.findById(storeId);

  if (!store) return c.json({ error: { code: "NOT_FOUND", message: "Toko tidak ditemukan." } }, 404);
  if (store.ownerId !== session.user.id) {
    return c.json({ error: { code: "FORBIDDEN", message: "Hanya pemilik toko." } }, 403);
  }

  const body = c.req.valid("json");
  store.updateShippingOrigin({
    originAddress: body.originAddress,
    originPostalCode: body.originPostalCode,
    originContactName: body.originContactName,
    originContactPhone: body.originContactPhone,
    originLatitude: body.originLatitude,
    originLongitude: body.originLongitude,
  });

  await storeRepo.save(store);

  return c.json({
    store: {
      id: store.id,
      originAddress: store.originAddress,
      originPostalCode: store.originPostalCode,
      originContactName: store.originContactName,
      originContactPhone: store.originContactPhone,
      originLatitude: store.originLatitude,
      originLongitude: store.originLongitude,
    },
  });
});

export { shippingRouter };
