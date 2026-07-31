import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { createAuth } from "../../lib/auth";
import { createDb } from "../../infrastructure/db/drizzle";
import type { Env } from "../../types";
import { GetPage } from "../../application/page/get-page";
import { UpdateSection } from "../../application/page/update-section";
import { AddSection } from "../../application/page/add-section";
import { RemoveSection } from "../../application/page/remove-section";
import { ReorderSections } from "../../application/page/reorder-sections";
import { D1PageRepository } from "../../infrastructure/repos/d1-page-repo";
import { D1StoreRepository } from "../../infrastructure/repos/d1-store-repo";
import type { EntityId } from "../../domain/shared/types";

const pagesRouter = new Hono<{ Bindings: Env }>();

async function requireAuth(c: any) {
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "Silakan login terlebih dahulu." } }, 401);
  }
  return session;
}

async function verifyOwner(c: any, storeId: EntityId) {
  const session = await requireAuth(c);
  if (session instanceof Response) return session;

  const db = createDb(c.env.DB);
  const storeRepo = new D1StoreRepository(db);
  const store = await storeRepo.findById(storeId);

  if (!store) return c.json({ error: { code: "NOT_FOUND", message: "Toko tidak ditemukan." } }, 404);
  if (store.ownerId !== session.user.id) {
    return c.json({ error: { code: "FORBIDDEN", message: "Hanya pemilik toko." } }, 403);
  }
  return store;
}

// ---------------------------------------------------------------------------
// GET /api/stores/:storeId/page
// ---------------------------------------------------------------------------
pagesRouter.get("/:storeId/page", async (c) => {
  const storeId = c.req.param("storeId") as EntityId;
  const db = createDb(c.env.DB);

  // Public if store is published, else auth
  const storeRepo = new D1StoreRepository(db);
  const store = await storeRepo.findById(storeId);
  if (!store) return c.json({ error: { code: "NOT_FOUND" } }, 404);

  if (!store.isPublished) {
    const session = await requireAuth(c);
    if (session instanceof Response) return session;
    if (store.ownerId !== session.user.id) {
      return c.json({ error: { code: "FORBIDDEN" } }, 403);
    }
  }

  const pageRepo = new D1PageRepository(db);
  const useCase = new GetPage(pageRepo);
  const result = await useCase.execute({ storeId });

  if (!result.ok) return c.json({ error: { code: "UNKNOWN" } }, 500);
  return c.json(result.value);
});

// ---------------------------------------------------------------------------
// PATCH /api/stores/:storeId/page/theme
// ---------------------------------------------------------------------------
pagesRouter.patch("/:storeId/page/theme", zValidator("json", z.object({
  theme: z.record(z.string(), z.string()).optional(),
})), async (c) => {
  const storeId = c.req.param("storeId") as EntityId;
  const ownerCheck = await verifyOwner(c, storeId);
  if (ownerCheck instanceof Response) return ownerCheck;

  const db = createDb(c.env.DB);
  const pageRepo = new D1PageRepository(db);
  const { theme } = c.req.valid("json");

  if (!theme || Object.keys(theme).length === 0) {
    return c.json({ error: { code: "VALIDATION", message: "Theme data diperlukan." } }, 400);
  }

  const pageData = await pageRepo.findByStoreIdWithTokens(storeId);
  if (!pageData) {
    return c.json({ error: { code: "NOT_FOUND", message: "Halaman tidak ditemukan." } }, 404);
  }

  // Merge new theme values on top of existing
  const merged = { ...(pageData.designTokens ?? {}), ...theme };
  await pageRepo.save(pageData.page, merged);

  return c.json({ theme: merged });
});

// ---------------------------------------------------------------------------
// PATCH /api/stores/:storeId/page/sections/:id
// ---------------------------------------------------------------------------
pagesRouter.patch("/:storeId/page/sections/:id", zValidator("json", z.object({
  content: z.record(z.string(), z.unknown()).optional(),
  variant: z.string().optional(),
})), async (c) => {
  const storeId = c.req.param("storeId") as EntityId;
  const sectionId = c.req.param("id") as EntityId;
  const ownerCheck = await verifyOwner(c, storeId);
  if (ownerCheck instanceof Response) return ownerCheck;

  const db = createDb(c.env.DB);
  const pageRepo = new D1PageRepository(db);
  const { content, variant } = c.req.valid("json");

  const useCase = new UpdateSection(pageRepo);
  const result = await useCase.execute({ storeId, sectionId, content, variant });

  if (!result.ok) {
    const status = result.error.code === "SECTION_NOT_FOUND" ? 404 : 404;
    return c.json({ error: result.error }, status);
  }

  return c.json(result.value);
});

// ---------------------------------------------------------------------------
// POST /api/stores/:storeId/page/sections
// ---------------------------------------------------------------------------
pagesRouter.post("/:storeId/page/sections", zValidator("json", z.object({
  type: z.enum(["hero", "about", "product-grid", "testimonial", "cta", "contact", "faq"]),
  variant: z.string(),
  content: z.record(z.string(), z.unknown()),
  sortOrder: z.number().int().min(0).optional(),
})), async (c) => {
  const storeId = c.req.param("storeId") as EntityId;
  const ownerCheck = await verifyOwner(c, storeId);
  if (ownerCheck instanceof Response) return ownerCheck;

  const db = createDb(c.env.DB);
  const pageRepo = new D1PageRepository(db);
  const input = c.req.valid("json");

  const useCase = new AddSection(pageRepo);
  const result = await useCase.execute({
    storeId,
    type: input.type,
    variant: input.variant,
    content: input.content,
    sortOrder: input.sortOrder,
  });

  if (!result.ok) {
    return c.json({ error: result.error }, 404);
  }

  return c.json(result.value, 201);
});

// ---------------------------------------------------------------------------
// DELETE /api/stores/:storeId/page/sections/:id
// ---------------------------------------------------------------------------
pagesRouter.delete("/:storeId/page/sections/:id", async (c) => {
  const storeId = c.req.param("storeId") as EntityId;
  const sectionId = c.req.param("id") as EntityId;
  const ownerCheck = await verifyOwner(c, storeId);
  if (ownerCheck instanceof Response) return ownerCheck;

  const db = createDb(c.env.DB);
  const pageRepo = new D1PageRepository(db);

  const useCase = new RemoveSection(pageRepo);
  const result = await useCase.execute({ storeId, sectionId });

  if (!result.ok) {
    return c.json({ error: result.error }, 404);
  }

  return c.json(result.value);
});

// ---------------------------------------------------------------------------
// PATCH /api/stores/:storeId/page/reorder
// ---------------------------------------------------------------------------
pagesRouter.patch("/:storeId/page/reorder", zValidator("json", z.object({
  sectionIds: z.array(z.string()),
})), async (c) => {
  const storeId = c.req.param("storeId") as EntityId;
  const ownerCheck = await verifyOwner(c, storeId);
  if (ownerCheck instanceof Response) return ownerCheck;

  const db = createDb(c.env.DB);
  const pageRepo = new D1PageRepository(db);
  const { sectionIds } = c.req.valid("json");

  const useCase = new ReorderSections(pageRepo);
  const result = await useCase.execute({
    storeId,
    sectionIds: sectionIds as EntityId[],
  });

  if (!result.ok) {
    return c.json({ error: result.error }, 404);
  }

  return c.json(result.value);
});

// ---------------------------------------------------------------------------
// POST /api/stores/:storeId/page/regenerate
// ---------------------------------------------------------------------------
pagesRouter.post("/:storeId/page/regenerate", async (c) => {
  const storeId = c.req.param("storeId") as EntityId;
  const store = await verifyOwner(c, storeId);
  if (store instanceof Response) return store;

  const db = createDb(c.env.DB);
  const pageRepo = new D1PageRepository(db);
  const { RegeneratePage } = await import("../../application/page/regenerate-page");
  const { generateStore } = await import("../../infrastructure/ai/deepseek-client");

  // Use LLM provider ONLY in production; dev/local falls back to mock (no API cost)
  const isProd = c.env.NODE_ENV === "production";
  const hasApiKey = isProd && c.env.LLM_API_KEY && c.env.LLM_API_KEY !== "sk-mock-key";
  const aiFn = hasApiKey
    ? async () => {
        const result = await generateStore({
          apiKey: c.env.LLM_API_KEY,
          model: c.env.LLM_MODEL,
          baseUrl: c.env.LLM_BASE_URL,
        }, {
          businessName: store.name,
          businessType: store.businessType,
          productCategory: "umum",
          aesthetic: store.aestheticPreference,
        });
        return { sections: result.sections, designTokens: result.designTokens };
      }
    : async () => {
        const { mockAIGenerate } = await import("../../infrastructure/ai/llm-client");
        const result = await mockAIGenerate({
          businessName: store.name,
          businessType: store.businessType,
          productCategory: "umum",
          aesthetic: store.aestheticPreference,
        });
        return { sections: result.sections, designTokens: result.designTokens };
      };

  const useCase = new RegeneratePage(pageRepo, aiFn);
  const result = await useCase.execute({ storeId });

  if (!result.ok) {
    const status = result.error.code === "PAGE_NOT_FOUND" ? 404 : 422;
    return c.json({ error: result.error }, status);
  }

  return c.json(result.value);
});

export { pagesRouter };
