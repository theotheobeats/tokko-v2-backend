import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { createAuth } from "../../lib/auth";
import { createDb } from "../../infrastructure/db/drizzle";
import type { Env } from "../../types";
import { GenerateStore, AIGenerationFailedError } from "../../application/store/generate-store";
import { serializePage } from "../../application/page/render-section";
import { D1StoreRepository } from "../../infrastructure/repos/d1-store-repo";
import { D1ProductRepository } from "../../infrastructure/repos/d1-product-repo";
import { D1PageRepository } from "../../infrastructure/repos/d1-page-repo";
import { SubdomainAlreadyTakenError, generateSubdomain } from "../../domain/store/rules";
import { eq } from "drizzle-orm";
import { stores } from "../../infrastructure/db/schema";
import { BusinessType, Aesthetic } from "../../domain/store/types";
import type { EntityId } from "../../domain/shared/types";
import { mockAIGenerate, generateStore } from "../../infrastructure/ai/deepseek-client";
import { useRealAi } from "../../infrastructure/ai/ai-mode";

const storesRouter = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Require authenticated user — returns 401 if not logged in */
async function requireAuth(c: any) {
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "Silakan login terlebih dahulu." } }, 401);
  }
  return session;
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const generateSchema = z.object({
  businessName: z.string().min(1, "Nama bisnis wajib diisi"),
  businessType: z.enum(["food", "fashion", "gift", "beauty", "craft", "gadget", "home", "service"]),
  productCategory: z.string().min(1, "Kategori produk wajib diisi"),
  aesthetic: z.enum(["minimal", "warm", "bold"]),
  whatsappNumber: z.string().min(10, "Nomor WhatsApp wajib diisi"),
});

// ---------------------------------------------------------------------------
// GET /api/stores/check-subdomain?name=...
// ---------------------------------------------------------------------------
storesRouter.get("/check-subdomain", async (c) => {
  const name = c.req.query("name");
  if (!name) {
    return c.json({ error: { code: "VALIDATION", message: "Parameter 'name' diperlukan." } }, 400);
  }

  const subdomain = generateSubdomain(name);
  const db = createDb(c.env.DB);
  const storeRepo = new D1StoreRepository(db);
  const existing = await storeRepo.findBySubdomain(subdomain);

  return c.json({ subdomain, available: !existing });
});

// ---------------------------------------------------------------------------
// POST /api/stores/generate
// ---------------------------------------------------------------------------
storesRouter.post("/generate", zValidator("json", generateSchema), async (c) => {
  const session = await requireAuth(c);
  if (session instanceof Response) return session;

  const input = c.req.valid("json");
  const db = createDb(c.env.DB);

  // One user, one store — prevent duplicate
  const checkRepo = new D1StoreRepository(db);
  const existing = await checkRepo.findByOwnerId(session.user.id as EntityId);
  if (existing) {
    return c.json({ error: { code: "ALREADY_ONBOARDED", message: "Anda sudah memiliki toko." } }, 409);
  }

  // Use the real LLM whenever a valid key is configured (dev or prod); only
  // fall back to the deterministic mock when no key is set or LLM_FORCE_MOCK=1.
  const aiGenerate = useRealAi(c.env)
    ? (input: Parameters<typeof generateStore>[1]) => {
        console.log(`[LLM] generating with ${c.env.LLM_MODEL || "deepseek-chat"} @ ${c.env.LLM_BASE_URL || "https://api.deepseek.com/v1"}`);
        return generateStore({
          apiKey: c.env.LLM_API_KEY,
          model: c.env.LLM_MODEL,
          baseUrl: c.env.LLM_BASE_URL,
        }, input);
      }
    : mockAIGenerate;

  const useCase = new GenerateStore(
    new D1StoreRepository(db),
    new D1ProductRepository(db),
    new D1PageRepository(db),
    aiGenerate,
  );

  const result = await useCase.execute({
    ownerId: session.user.id as EntityId,
    businessName: input.businessName,
    businessType: input.businessType as typeof BusinessType[keyof typeof BusinessType],
    productCategory: input.productCategory,
    aesthetic: input.aesthetic as typeof Aesthetic[keyof typeof Aesthetic],
    whatsappNumber: input.whatsappNumber,
  });

  if (!result.ok) {
    if (result.error instanceof SubdomainAlreadyTakenError) {
      return c.json({
        error: { code: "SUBDOMAIN_TAKEN", message: "Subdomain sudah dipakai. Coba nama lain." },
      }, 409);
    }
    if (result.error instanceof AIGenerationFailedError) {
      console.error("AI_GENERATION_FAILED:", result.error.message);
      return c.json({
        error: { code: "AI_GENERATION_FAILED", message: result.error.message },
      }, 422);
    }
    return c.json({ error: { code: "UNKNOWN", message: "Terjadi kesalahan." } }, 500);
  }

  return c.json(result.value, 201);
});

// ---------------------------------------------------------------------------
// GET /api/stores/me
// ---------------------------------------------------------------------------
storesRouter.get("/me", async (c) => {
  const session = await requireAuth(c);
  if (session instanceof Response) return session;

  const db = createDb(c.env.DB);
  const storeRepo = new D1StoreRepository(db);
  const store = await storeRepo.findByOwnerId(session.user.id as EntityId);

  if (!store) {
    return c.json({ store: null });
  }

  return c.json({
    store: {
      id: store.id,
      name: store.name,
      subdomain: store.subdomain,
      description: store.description,
      businessType: store.businessType,
      aestheticPreference: store.aestheticPreference,
      whatsappNumber: store.whatsappNumber,
      status: store.status,
      heroImageUrl: store.heroImageUrl,
    },
  });
});

// ---------------------------------------------------------------------------
// GET /api/stores/by-subdomain?subdomain=xxx (public)
// ---------------------------------------------------------------------------
storesRouter.get("/by-subdomain", async (c) => {
  const subdomain = c.req.query("subdomain");
  if (!subdomain) {
    return c.json({ error: { code: "VALIDATION", message: "Parameter 'subdomain' diperlukan." } }, 400);
  }

  const db = createDb(c.env.DB);
  const storeRepo = new D1StoreRepository(db);
  const store = await storeRepo.findBySubdomain(subdomain);

  if (!store) {
    return c.json({ error: { code: "STORE_NOT_FOUND", message: "Toko tidak ditemukan." } }, 404);
  }

  if (!store.isPublished) {
    return c.json({ error: { code: "STORE_NOT_PUBLISHED", message: "Toko belum dipublikasikan." } }, 404);
  }

  // Suspended by moderation → hidden from the public storefront.
  if (store.isSuspended) {
    return c.json({ error: { code: "STORE_SUSPENDED", message: "Toko sedang ditinjau." } }, 404);
  }

  // Get products and page
  const productRepo = new D1ProductRepository(db);
  const pageRepo = new D1PageRepository(db);
  const products = await productRepo.findByStoreId(store.id);
  const pageData = await pageRepo.findByStoreIdWithTokens(store.id);

  return c.json({
    store: {
      id: store.id,
      name: store.name,
      subdomain: store.subdomain,
      description: store.description,
      businessType: store.businessType,
      aestheticPreference: store.aestheticPreference,
      whatsappNumber: store.whatsappNumber,
      status: store.status,
      heroImageUrl: store.heroImageUrl,
    },
    sections: pageData
      ? serializePage(pageData.page, pageData.designTokens).sections
      : [],
    products: products.map((p) => ({
      id: p.id,
      storeId: p.storeId,
      name: p.name,
      description: p.description,
      price: p.price,
      imageUrl: p.imageUrl,
      isAvailable: p.isAvailable,
    })),
    theme: pageData?.designTokens ?? undefined,
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/stores/:id
// ---------------------------------------------------------------------------
storesRouter.patch("/:id", zValidator("json", z.object({
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  whatsappNumber: z.string().optional(),
  heroImageUrl: z.string().nullable().optional(),
})), async (c) => {
  const session = await requireAuth(c);
  if (session instanceof Response) return session;

  const storeId = c.req.param("id");
  const db = createDb(c.env.DB);
  const storeRepo = new D1StoreRepository(db);
  const store = await storeRepo.findById(storeId as EntityId);

  if (!store) {
    return c.json({ error: { code: "NOT_FOUND", message: "Toko tidak ditemukan." } }, 404);
  }

  if (store.ownerId !== session.user.id) {
    return c.json({ error: { code: "FORBIDDEN", message: "Hanya pemilik toko yang dapat mengubah." } }, 403);
  }

  const body = c.req.valid("json");
  store.updateDetails({
    name: body.name,
    description: body.description,
    whatsappNumber: body.whatsappNumber,
  });

  if (body.heroImageUrl !== undefined) {
    store.setHeroImage(body.heroImageUrl);
  }

  await storeRepo.save(store);

  return c.json({
    store: {
      id: store.id,
      name: store.name,
      subdomain: store.subdomain,
      description: store.description,
      businessType: store.businessType,
      aestheticPreference: store.aestheticPreference,
      whatsappNumber: store.whatsappNumber,
      status: store.status,
      heroImageUrl: store.heroImageUrl,
    },
  });
});

// ---------------------------------------------------------------------------
// POST /api/stores/:id/publish
// ---------------------------------------------------------------------------
storesRouter.post("/:id/publish", async (c) => {
  const session = await requireAuth(c);
  if (session instanceof Response) return session;

  const storeId = c.req.param("id") as EntityId;
  const db = createDb(c.env.DB);
  const storeRepo = new D1StoreRepository(db);

  const store = await storeRepo.findById(storeId);
  if (!store) return c.json({ error: { code: "NOT_FOUND", message: "Toko tidak ditemukan." } }, 404);
  if (store.ownerId !== session.user.id) {
    return c.json({ error: { code: "FORBIDDEN" } }, 403);
  }

  const { PublishStore } = await import("../../application/store/publish-store");
  const useCase = new PublishStore(storeRepo);
  const result = await useCase.execute({ storeId });

  if (!result.ok) {
    const status = result.error.code === "STORE_HAS_NO_PRODUCTS" ? 400 : 404;
    return c.json({ error: result.error }, status);
  }

  return c.json({
    store: {
      id: result.value.id,
      name: result.value.name,
      subdomain: result.value.subdomain,
      status: result.value.status,
    },
  });
});

// ---------------------------------------------------------------------------
// POST /api/stores/:id/unpublish
// ---------------------------------------------------------------------------
storesRouter.post("/:id/unpublish", async (c) => {
  const session = await requireAuth(c);
  if (session instanceof Response) return session;

  const storeId = c.req.param("id") as EntityId;
  const db = createDb(c.env.DB);
  const storeRepo = new D1StoreRepository(db);

  const store = await storeRepo.findById(storeId);
  if (!store) return c.json({ error: { code: "NOT_FOUND" } }, 404);
  if (store.ownerId !== session.user.id) {
    return c.json({ error: { code: "FORBIDDEN" } }, 403);
  }

  const { UnpublishStore } = await import("../../application/store/unpublish-store");
  const useCase = new UnpublishStore(storeRepo);
  const result = await useCase.execute({ storeId });

  if (!result.ok) {
    return c.json({ error: result.error }, 404);
  }

  return c.json({
    store: {
      id: result.value.id,
      name: result.value.name,
      subdomain: result.value.subdomain,
      status: result.value.status,
    },
  });
});

export { storesRouter };
