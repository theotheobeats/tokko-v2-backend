import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { createAuth } from "../../lib/auth";
import { createDb } from "../../infrastructure/db/drizzle";
import type { Env } from "../../types";
import { CreateProduct } from "../../application/product/create-product";
import { UpdateProduct } from "../../application/product/update-product";
import { ListProducts } from "../../application/product/list-products";
import { GetProduct, GetProductBySlug } from "../../application/product/get-product";
import { ListRelatedProducts } from "../../application/product/list-related-products";
import { isProductSortKey, type ProductSortKey } from "../../application/product/list-products";
import { DeleteProduct } from "../../application/product/delete-product";
import { D1ProductRepository } from "../../infrastructure/repos/d1-product-repo";
import { D1CategoryRepository } from "../../infrastructure/repos/d1-category-repo";
import { D1StoreRepository } from "../../infrastructure/repos/d1-store-repo";
import type { EntityId } from "../../domain/shared/types";

const productsRouter = new Hono<{ Bindings: Env }>();

async function requireAuth(c: any) {
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "Silakan login terlebih dahulu." } }, 401);
  }
  return session;
}

const createSchema = z.object({
  name: z.string().min(1),
  price: z.number().int().min(0),
  description: z.string().optional(),
  imageUrl: z.string().optional(),
  images: z.array(z.string()).optional(),
  salePrice: z.number().int().min(0).nullable().optional(),
  stock: z.number().int().min(0).nullable().optional(),
  slug: z.string().optional(),
  categoryId: z.string().optional(),
  type: z.enum(["product", "service", "booking"]).optional(),
  variants: z.array(z.object({
    name: z.string().min(1),
    price: z.number().int().min(0).nullable().optional(),
  })).optional(),
});

const updateSchema = z.object({
  name: z.string().optional(),
  price: z.number().int().min(0).optional(),
  description: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  images: z.array(z.string()).optional(),
  salePrice: z.number().int().min(0).nullable().optional(),
  stock: z.number().int().min(0).nullable().optional(),
  slug: z.string().nullable().optional(),
  categoryId: z.string().nullable().optional(),
  isAvailable: z.boolean().optional(),
  type: z.enum(["product", "service", "booking"]).optional(),
  variants: z.array(z.object({
    name: z.string().min(1),
    price: z.number().int().min(0).nullable().optional(),
  })).nullable().optional(),
});

// ---------------------------------------------------------------------------
// GET /api/stores/:storeId/products
// ---------------------------------------------------------------------------
// Optional query params (public when store is published):
//   ?category=<slug|id>  — filter to one category (404 when unknown)
//   ?sort=<default|price_asc|price_desc|newest|name_asc>
productsRouter.get("/:storeId/products", async (c) => {
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

  // Category filter — accepts slug or id (both URL-safe).
  let categoryId: EntityId | null | undefined;
  const categoryParam = c.req.query("category");
  if (categoryParam) {
    const categoryRepo = new D1CategoryRepository(db);
    const bySlug = await categoryRepo.findByStoreSlug(storeId, categoryParam);
    const category = bySlug ?? (await categoryRepo.findById(categoryParam as EntityId));
    if (!category || category.storeId !== storeId) {
      return c.json({ error: { code: "CATEGORY_NOT_FOUND", message: "Kategori tidak ditemukan." } }, 404);
    }
    categoryId = category.id;
  }

  const sortParam = c.req.query("sort");
  const sort: ProductSortKey = isProductSortKey(sortParam) ? sortParam : "default";

  const productRepo = new D1ProductRepository(db);
  const useCase = new ListProducts(productRepo);
  const result = await useCase.execute({ storeId, categoryId, sort });

  if (!result.ok) return c.json({ error: { code: "UNKNOWN" } }, 500);
  return c.json(result.value);
});

// ---------------------------------------------------------------------------
// GET /api/stores/:storeId/products/by-slug/:slug
// ---------------------------------------------------------------------------
// Single product by URL slug (public when store is published) — storefront
// product detail page. Falls back to nothing when the slug is unknown.
productsRouter.get("/:storeId/products/by-slug/:slug", async (c) => {
  const storeId = c.req.param("storeId") as EntityId;
  const slug = c.req.param("slug");
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

  const productRepo = new D1ProductRepository(db);
  const useCase = new GetProductBySlug(productRepo);
  const result = await useCase.execute({ storeId, slug });

  if (!result.ok) return c.json({ error: result.error }, 404);
  return c.json({ product: result.value });
});

// ---------------------------------------------------------------------------
// GET /api/stores/:storeId/products/:id/related
// ---------------------------------------------------------------------------
// Other available products in the same store (public when store is published).
productsRouter.get("/:storeId/products/:id/related", async (c) => {
  const storeId = c.req.param("storeId") as EntityId;
  const productId = c.req.param("id") as EntityId;
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

  const productRepo = new D1ProductRepository(db);
  const useCase = new ListRelatedProducts(productRepo);
  const result = await useCase.execute({ storeId, productId });

  if (!result.ok) return c.json({ error: { code: "UNKNOWN" } }, 500);
  return c.json({ products: result.value });
});

// ---------------------------------------------------------------------------
// GET /api/stores/:storeId/products/:id
// ---------------------------------------------------------------------------
// Single product (public when store is published) — storefront detail page.
productsRouter.get("/:storeId/products/:id", async (c) => {
  const storeId = c.req.param("storeId") as EntityId;
  const productId = c.req.param("id") as EntityId;
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

  const productRepo = new D1ProductRepository(db);
  const useCase = new GetProduct(productRepo);
  const result = await useCase.execute({ productId });

  if (!result.ok) return c.json({ error: result.error }, 404);
  return c.json({ product: result.value });
});

// ---------------------------------------------------------------------------
// POST /api/stores/:storeId/products
// ---------------------------------------------------------------------------
productsRouter.post("/:storeId/products", zValidator("json", createSchema), async (c) => {
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

  const input = c.req.valid("json");
  const productRepo = new D1ProductRepository(db);
  const useCase = new CreateProduct(productRepo, new D1CategoryRepository(db));

  const result = await useCase.execute({
    storeId,
    name: input.name,
    price: input.price,
    description: input.description,
    imageUrl: input.imageUrl,
    images: input.images,
    salePrice: input.salePrice,
    stock: input.stock,
    slug: input.slug,
    categoryId: input.categoryId as EntityId | undefined,
    type: input.type,
    variants: input.variants,
  });

  if (!result.ok) {
    const status = result.error.code === "PRODUCT_LIMIT_REACHED" ? 400 : 400;
    return c.json({ error: result.error }, status);
  }

  return c.json({ product: result.value }, 201);
});

// ---------------------------------------------------------------------------
// PATCH /api/stores/:storeId/products/:id
// ---------------------------------------------------------------------------
productsRouter.patch("/:storeId/products/:id", zValidator("json", updateSchema), async (c) => {
  const session = await requireAuth(c);
  if (session instanceof Response) return session;

  const storeId = c.req.param("storeId") as EntityId;
  const productId = c.req.param("id") as EntityId;
  const db = createDb(c.env.DB);
  const storeRepo = new D1StoreRepository(db);

  const store = await storeRepo.findById(storeId);
  if (!store) return c.json({ error: { code: "NOT_FOUND" } }, 404);
  if (store.ownerId !== session.user.id) {
    return c.json({ error: { code: "FORBIDDEN" } }, 403);
  }

  const input = c.req.valid("json");
  const productRepo = new D1ProductRepository(db);
  const useCase = new UpdateProduct(productRepo, new D1CategoryRepository(db));

  const result = await useCase.execute({
    productId,
    name: input.name,
    price: input.price,
    description: input.description,
    imageUrl: input.imageUrl,
    images: input.images,
    salePrice: input.salePrice,
    stock: input.stock,
    slug: input.slug,
    categoryId: input.categoryId as EntityId | null | undefined,
    isAvailable: input.isAvailable,
    type: input.type,
    variants: input.variants,
  });

  if (!result.ok) {
    const status = result.error.code === "NOT_FOUND" ? 404 : 400;
    return c.json({ error: result.error }, status);
  }

  return c.json({ product: result.value });
});

// ---------------------------------------------------------------------------
// DELETE /api/stores/:storeId/products/:id
// ---------------------------------------------------------------------------
productsRouter.delete("/:storeId/products/:id", async (c) => {
  const session = await requireAuth(c);
  if (session instanceof Response) return session;

  const storeId = c.req.param("storeId") as EntityId;
  const productId = c.req.param("id") as EntityId;
  const db = createDb(c.env.DB);
  const storeRepo = new D1StoreRepository(db);

  const store = await storeRepo.findById(storeId);
  if (!store) return c.json({ error: { code: "NOT_FOUND" } }, 404);
  if (store.ownerId !== session.user.id) {
    return c.json({ error: { code: "FORBIDDEN" } }, 403);
  }

  const productRepo = new D1ProductRepository(db);
  const useCase = new DeleteProduct(productRepo);

  const result = await useCase.execute({ productId });

  if (!result.ok) {
    return c.json({ error: result.error }, 404);
  }

  return c.json({ success: true });
});

// ---------------------------------------------------------------------------
// POST /api/stores/:storeId/products/generate-description
// ---------------------------------------------------------------------------
productsRouter.post("/:storeId/products/generate-description", zValidator("json", z.object({
  name: z.string().min(1),
  category: z.string().min(1),
})), async (c) => {
  const session = await requireAuth(c);
  if (session instanceof Response) return session;

  const storeId = c.req.param("storeId") as EntityId;
  const db = createDb(c.env.DB);
  const storeRepo = new D1StoreRepository(db);

  const store = await storeRepo.findById(storeId);
  if (!store) return c.json({ error: { code: "NOT_FOUND" } }, 404);
  if (store.ownerId !== session.user.id) {
    return c.json({ error: { code: "FORBIDDEN" } }, 403);
  }

  const input = c.req.valid("json");
  const { GenerateProductDescription } = await import("../../application/product/generate-product-description");
  const { generateProductDesc } = await import("../../infrastructure/ai/deepseek-client");
  const { useRealAi } = await import("../../infrastructure/ai/ai-mode");

  // Use the real LLM whenever a valid key is configured (dev or prod).
  const useCase = new GenerateProductDescription(
    useRealAi(c.env)
      ? (input) => generateProductDesc({ apiKey: c.env.LLM_API_KEY, model: c.env.LLM_MODEL }, input)
      : async ({ name, category }) => `${name} adalah produk ${category} berkualitas premium, dibuat dengan bahan pilihan terbaik. Cocok untuk berbagai kebutuhan Anda.`
  );

  const result = await useCase.execute(input);

  if (!result.ok) {
    return c.json({ error: result.error }, 422);
  }

  return c.json(result.value);
});

export { productsRouter };
