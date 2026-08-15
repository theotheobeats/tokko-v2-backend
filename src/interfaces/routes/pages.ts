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
import {
  AddPage,
  UpdatePage,
  DeletePage,
  PageSlugInvalidError,
  PageSlugTakenError,
  PageNotFoundError,
  LastPageError,
  PageLimitReachedError,
} from "../../application/page/page-management";
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

/** Helper: parse the ?page= slug param (default beranda). */
function pageParam(c: any): string {
  return c.req.query("page") ?? "beranda";
}

// ---------------------------------------------------------------------------
// GET /api/stores/:storeId/page?page=<slug>
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
  const result = await useCase.execute({ storeId, slug: pageParam(c) });

  if (!result.ok) return c.json({ error: { code: "UNKNOWN" } }, 500);
  return c.json(result.value);
});

// ---------------------------------------------------------------------------
// PATCH /api/stores/:storeId/page/theme — site-wide theme (lives on the store)
// ---------------------------------------------------------------------------
pagesRouter.patch("/:storeId/page/theme", zValidator("json", z.object({
  theme: z.record(z.string(), z.string()).optional(),
})), async (c) => {
  const storeId = c.req.param("storeId") as EntityId;
  const ownerCheck = await verifyOwner(c, storeId);
  if (ownerCheck instanceof Response) return ownerCheck;

  const db = createDb(c.env.DB);
  const storeRepo = new D1StoreRepository(db);
  const { theme } = c.req.valid("json");

  if (!theme || Object.keys(theme).length === 0) {
    return c.json({ error: { code: "VALIDATION", message: "Theme data diperlukan." } }, 400);
  }

  const store = await storeRepo.findById(storeId);
  if (!store) {
    return c.json({ error: { code: "NOT_FOUND", message: "Toko tidak ditemukan." } }, 404);
  }

  // Merge new theme values on top of existing.
  const merged = { ...(store.designTokens ?? {}), ...theme };
  store.setDesignTokens(merged);
  await storeRepo.save(store);

  return c.json({ theme: merged });
});

// ---------------------------------------------------------------------------
// Section routes — all accept ?page=<slug> (default beranda)
// ---------------------------------------------------------------------------

// PATCH /api/stores/:storeId/page/sections/:id
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
  const result = await useCase.execute({ storeId, slug: pageParam(c), sectionId, content, variant });

  if (!result.ok) {
    const status = result.error.code === "SECTION_NOT_FOUND" ? 404 : 404;
    return c.json({ error: result.error }, status);
  }

  return c.json(result.value);
});

// POST /api/stores/:storeId/page/sections
pagesRouter.post("/:storeId/page/sections", zValidator("json", z.object({
  type: z.enum(["hero", "about", "product-grid", "category-grid", "testimonial", "cta", "contact", "faq", "footer"]),
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
    slug: pageParam(c),
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

// DELETE /api/stores/:storeId/page/sections/:id
pagesRouter.delete("/:storeId/page/sections/:id", async (c) => {
  const storeId = c.req.param("storeId") as EntityId;
  const sectionId = c.req.param("id") as EntityId;
  const ownerCheck = await verifyOwner(c, storeId);
  if (ownerCheck instanceof Response) return ownerCheck;

  const db = createDb(c.env.DB);
  const pageRepo = new D1PageRepository(db);

  const useCase = new RemoveSection(pageRepo);
  const result = await useCase.execute({ storeId, slug: pageParam(c), sectionId });

  if (!result.ok) {
    return c.json({ error: result.error }, 404);
  }

  return c.json(result.value);
});

// PATCH /api/stores/:storeId/page/reorder
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
    slug: pageParam(c),
    sectionIds: sectionIds as EntityId[],
  });

  if (!result.ok) {
    return c.json({ error: result.error }, 404);
  }

  return c.json(result.value);
});

// POST /api/stores/:storeId/page/regenerate
pagesRouter.post("/:storeId/page/regenerate", async (c) => {
  const storeId = c.req.param("storeId") as EntityId;
  const store = await verifyOwner(c, storeId);
  if (store instanceof Response) return store;

  const db = createDb(c.env.DB);
  const pageRepo = new D1PageRepository(db);
  const { RegeneratePage } = await import("../../application/page/regenerate-page");
  const { generateStore } = await import("../../infrastructure/ai/deepseek-client");
  const { useRealAi } = await import("../../infrastructure/ai/ai-mode");

  // Load current page + theme so regenerate can pick DIFFERENT blocks (anti-repeat).
  const slug = pageParam(c);
  const existingPage = await pageRepo.findByStoreIdAndSlug(storeId, slug);
  const previousTokens = await pageRepo.getDesignTokens(storeId);
  const previousBlocks = existingPage
    ? existingPage.sections.map((s) => ({ type: s.type as string, blockId: (s.content?.blockId as string) ?? "" }))
    : undefined;

  // Use the real LLM whenever a valid key is configured (dev or prod).
  const genInput = {
    businessName: store.name,
    businessType: store.businessType,
    productCategory: "umum",
    aesthetic: store.aestheticPreference,
  };
  const aiFn = useRealAi(c.env)
    ? async () => {
        const result = await generateStore({
          apiKey: c.env.LLM_API_KEY,
          model: c.env.LLM_MODEL,
          baseUrl: c.env.LLM_BASE_URL,
        }, { ...genInput, previousBlocks, previousTheme: previousTokens ?? undefined });
        return { sections: result.sections, designTokens: result.designTokens };
      }
    : async () => {
        const { mockAIGenerate } = await import("../../infrastructure/ai/llm-client");
        const result = await mockAIGenerate(genInput);
        return { sections: result.sections, designTokens: result.designTokens };
      };

  const useCase = new RegeneratePage(pageRepo, aiFn);
  const result = await useCase.execute({ storeId, slug });

  if (!result.ok) {
    const status = result.error.code === "PAGE_NOT_FOUND" ? 404 : 422;
    return c.json({ error: result.error }, status);
  }

  return c.json(result.value);
});

// ---------------------------------------------------------------------------
// Page management (free-form multi-page) — /api/stores/:storeId/pages
// ---------------------------------------------------------------------------

const addPageSchema = z.object({
  slug: z.string().min(2).max(40),
  title: z.string().max(100).optional(),
  template: z.enum(["about", "products", "contact", "faq", "empty"]).optional(),
});

// POST /api/stores/:storeId/pages
pagesRouter.post("/:storeId/pages", zValidator("json", addPageSchema), async (c) => {
  const storeId = c.req.param("storeId") as EntityId;
  const ownerCheck = await verifyOwner(c, storeId);
  if (ownerCheck instanceof Response) return ownerCheck;

  const db = createDb(c.env.DB);
  const input = c.req.valid("json");
  const useCase = new AddPage(new D1PageRepository(db));
  const result = await useCase.execute({
    storeId,
    slug: input.slug,
    title: input.title,
    template: input.template,
  });

  if (!result.ok) {
    if (result.error instanceof PageSlugTakenError || result.error instanceof PageLimitReachedError) {
      return c.json({ error: result.error }, 409);
    }
    return c.json({ error: result.error }, 400);
  }
  return c.json(result.value, 201);
});

const updatePageSchema = z.object({
  slug: z.string().min(2).max(40).optional(),
  title: z.string().max(100).nullable().optional(),
});

// PATCH /api/stores/:storeId/pages/:slug
pagesRouter.patch("/:storeId/pages/:slug", zValidator("json", updatePageSchema), async (c) => {
  const storeId = c.req.param("storeId") as EntityId;
  const ownerCheck = await verifyOwner(c, storeId);
  if (ownerCheck instanceof Response) return ownerCheck;

  const db = createDb(c.env.DB);
  const input = c.req.valid("json");
  const useCase = new UpdatePage(new D1PageRepository(db));
  const result = await useCase.execute({
    storeId,
    slug: c.req.param("slug"),
    newSlug: input.slug,
    title: input.title,
  });

  if (!result.ok) {
    if (result.error instanceof PageNotFoundError) return c.json({ error: result.error }, 404);
    if (result.error instanceof PageSlugTakenError) return c.json({ error: result.error }, 409);
    return c.json({ error: result.error }, 400);
  }
  return c.json(result.value);
});

// DELETE /api/stores/:storeId/pages/:slug
pagesRouter.delete("/:storeId/pages/:slug", async (c) => {
  const storeId = c.req.param("storeId") as EntityId;
  const ownerCheck = await verifyOwner(c, storeId);
  if (ownerCheck instanceof Response) return ownerCheck;

  const db = createDb(c.env.DB);
  const useCase = new DeletePage(new D1PageRepository(db));
  const result = await useCase.execute({ storeId, slug: c.req.param("slug") });

  if (!result.ok) {
    if (result.error instanceof PageNotFoundError) return c.json({ error: result.error }, 404);
    return c.json({ error: result.error }, 400);
  }
  return c.json(result.value);
});

export { pagesRouter };
