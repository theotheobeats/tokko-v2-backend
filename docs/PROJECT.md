# 7okko — Project Definition

## Overview

**7okko** is an AI-powered e-commerce creator for Indonesian business owners. Users describe their business, and AI generates a complete landing page / online store in seconds. No design skills needed. Think ScaleV meets AI — instead of bringing your own AI-generated HTML, 7okko *is* the AI generation layer.

**Target market:** Indonesian UMKM owners (warung, boutique, catering, home bakery, etc.) who want to sell online but can't design or code. They currently operate via WhatsApp groups and Instagram DMs.

**Core differentiator:** AI-first generation. You answer 5 questions, you get a live store. Nobody in Indonesia does this yet.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js (App Router) via `@opennextjs/cloudflare` |
| Backend | Hono.js on Cloudflare Workers |
| Database | D1 (SQLite) + Drizzle ORM (`drizzle-orm/sqlite`) |
| Storage | R2 (Cloudflare object storage) |
| Styling | Plain CSS (no Tailwind, no UI libraries) |
| AI | LLM API (OpenAI / Anthropic) for page generation |
| Deployment | Cloudflare Workers (`wrangler deploy`) |

No Docker, no Nginx, no Postgres. You `wrangler deploy` and it's live at 300+ edge locations. Same Hono + Next.js combo, just running on the edge instead of containers.

---

## Domain Model (DDD)

### Bounded Contexts

**MVP has 2 bounded contexts:**

### 1. Store Context (Core Domain)

The heart of the product. Everything about creating and managing a store.

#### Aggregates

**`Store`** (Aggregate Root)
- Identity: `id`, `subdomain` (e.g., "bakery-anna")
- State: `status` (draft | published), `name`, `description`, `businessType`, `ownerId`
- Behavior: `publish()`, `unpublish()`, `updateDetails()`
- Invariants:
  - Subdomain must be unique across system
  - Store must have at least 1 product to publish
  - Only owner can modify store

**`Product`** (Entity within Store aggregate)
- Identity: `id`
- State: `name`, `description`, `price`, `imageUrl`, `isAvailable`
- Behavior: `updatePrice()`, `toggleAvailability()`
- Invariants:
  - Price must be >= 0
  - Name is required

**`Page`** (Entity within Store aggregate)
- Identity: `id`
- State: `sections` (ordered list of Section values)
- Behavior: `reorderSections()`, `updateSection()`, `addSection()`, `removeSection()`
- This is the AI-generated landing page structure

**`Section`** (Value Object)
- Types: `hero`, `about`, `product-grid`, `testimonial`, `cta`, `contact`, `faq`
- Each type has its own data shape (hero has title/subtitle/bgImage, product-grid has productIds, etc.)
- Sections are the building blocks of the page — AI generates them, user can reorder/tweak

#### Domain Events

- `StoreCreated` — fired when a new store is generated
- `StorePublished` — fired when store goes live
- `ProductAdded` — fired when a product is added
- `PageGenerated` — fired when AI generates/refreshes the page

### 2. Order Context (Supporting Domain)

Handles customer orders. Lightweight for MVP — WhatsApp-based flow.

#### Aggregates

**`Order`** (Aggregate Root)
- Identity: `id`
- State: `storeId`, `customerName`, `customerPhone`, `items`, `totalAmount`, `status`, `notes`
- Behavior: `submit()`, `markContacted()`
- Invariants:
  - Must have at least 1 item
  - Customer phone is required (for WhatsApp follow-up)
  - Status flow: pending → contacted → completed

**`OrderItem`** (Value Object)
- `productId`, `productName`, `quantity`, `unitPrice`

### Cross-Context Communication

- Order Context reads Store and Product data but doesn't modify them
- No event-driven choreography for MVP — simple FK references are fine
- Store owner views orders filtered by their store

---

## MVP Feature List

### 1. Authentication
- Email + password (simplest to implement first)
- Google OAuth post-MVP
- Session via cookies (Hono cookie middleware + D1)

### 2. Onboarding Quiz
- 5 questions max: business name, business type (dropdown), product category, aesthetic preference (minimal/warm/bold), WhatsApp number
- No multi-step wizard — single page, simple form
- This is the input for AI generation

### 3. AI Store Generation
- LLM receives quiz answers + a system prompt with 7okko's design language
- AI generates: store name, description, hero section copy, about section, suggested sections layout, and sample product descriptions (based on business type)
- Output is structured JSON matching the `Page` section schema
- User sees a live preview immediately after generation
- User can "Regenerate" to get a different take

### 4. Store Editor
- Block-based editor: each AI-generated section is an editable block
- Edit text inline (click to edit)
- Reorder sections via drag (or up/down arrows for mobile)
- Delete sections
- Add new sections from a section picker
- Live preview updates as you edit
- NO full drag-and-drop canvas builder — that's v2

### 5. Product Catalog
- CRUD products: name, price, description, image, availability toggle
- AI auto-generates product descriptions based on name + category
- Products render in the "product-grid" section of the page
- Max 20 products for MVP

### 6. Image Upload
- Product images: 1 per product, JPG/PNG, max 2MB
- Hero image: 1 per store
- Stored on **R2** (Cloudflare object storage)
- No image compression pipeline — that killed Nikayu v2
- No local disk — Workers filesystem is ephemeral

### 7. Public Store Page
- Live at `{subdomain}.7okko.com`
- Renders the AI-generated page with real products
- Mobile-first responsive
- No auth required to view
- Product cards link to order form

### 8. Order Form (WhatsApp Flow)
- Customer clicks "Order" on a product
- Form: name, phone, quantity, notes
- On submit: order saved to DB + notification to store owner via WhatsApp (`wa.me` deep link with order summary)
- No payment gateway for MVP

### 9. Order Dashboard
- Table of incoming orders
- Columns: customer name, phone, items, total, status, time
- Status toggle: pending → contacted → completed
- Export to CSV

### 10. Subdomain Management
- Auto-assigned during onboarding from business name (e.g., "Anna's Bakery" → `annas-bakery`)
- Availability check during onboarding
- First-come, first-served
- Slug editing deferred to post-MVP

---

## NOT in MVP (Explicitly Deferred)

- Payment gateway (Midtrans/Xendit)
- Custom domains
- Meta Pixel / CAPI integration
- Analytics dashboard
- Drag-and-drop page builder
- Multi-store per account
- Email notifications
- Image gallery / compression pipeline
- SEO auto-optimization
- Ad copy generation
- Inventory management
- Shipping integration
- Discount / coupon codes
- Multi-language

---

## Design Direction

- **Glassmorphism style**: white backgrounds, soft drop shadows, blue accent (#3b82f6), rounded corners (12-16px), pastel gradients
- **Mobile-first**: business owners manage from phone, customers browse from phone
- **Clean, not cluttered**: UMKM owners are not tech-savvy — UI must be obvious
- **Plain CSS**: no Tailwind, no component libraries — custom CSS only
- **Indonesian context**: Bahasa Indonesia default, WhatsApp-first communication, Rupiah currency

---

## Architecture

### System Diagram

```
                          Cloudflare Edge (300+ locations)
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│  *.7okko.com ──────►  Cloudflare DNS + Routing                   │
│                           │                                      │
│               ┌───────────┴───────────┐                          │
│               │                       │                          │
│     7okko.com /api/*           {subdomain}.7okko.com             │
│               │                       │                          │
│        ┌──────▼──────┐        ┌──────▼──────┐                    │
│        │  Next.js    │        │  Next.js    │                    │
│        │  Worker     │        │  Worker     │                    │
│        │  (Dashboard,│        │  (Public    │                    │
│        │   Auth,     │        │   Store     │                    │
│        │   Editor)   │        │   Page)     │                    │
│        └──────┬──────┘        └──────┬──────┘                    │
│               │                      │                           │
│               └──────────┬───────────┘                           │
│                          │  fetch() /api/*                        │
│                   ┌──────▼──────┐                                │
│                   │  Hono API   │  ← same Worker, routes         │
│                   │  Worker     │     /api/auth, /api/stores...   │
│                   └──┬──────┬──┘                                 │
│                      │      │                                    │
│              ┌───────▼─┐ ┌──▼────────┐                          │
│              │   D1    │ │    R2     │                          │
│              │ (SQLite)│ │ (Images)  │                          │
│              └─────────┘ └───────────┘                          │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

**Same Worker, multiple routes.** The Hono API and Next.js can be deployed as separate Workers or in a single Worker via route matching. Simplest for MVP: deploy as **two Workers** (one Next.js via OpenNext, one Hono API) — clean separation, independent deploys.

### Request Flow (Public Store)

1. Browser hits `annas-bakery.7okko.com`
2. Cloudflare routes based on `Host` header to the Next.js Worker
3. Next.js middleware extracts subdomain from hostname
4. Server-side fetch: `GET /api/stores/by-subdomain?subdomain=annas-bakery`
5. Hono API Worker queries D1, returns store + page + products
6. Next.js renders the store page with data

### AI Generation Flow

1. User submits onboarding quiz
2. `POST /api/stores/generate` — Hono Worker constructs prompt from quiz answers
3. Hono calls LLM API (fetch from Workers runtime)
4. LLM returns structured JSON (sections, copy, layout)
5. Hono validates response shape, creates Store + Page + sample Products in D1 transaction
6. Returns store to frontend, user sees live preview

---

## Project Structure (DDD-Influenced)

```
7okko/
├── apps/
│   ├── web/                          # Next.js frontend (Cloudflare Workers)
│   │   ├── open-next.config.ts       # OpenNext Cloudflare adapter config
│   │   ├── wrangler.jsonc            # Workers config (D1 binding for API calls)
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── (auth)/           # Auth pages (login, register)
│   │   │   │   ├── (dashboard)/      # Auth'd store owner pages
│   │   │   │   │   ├── onboarding/   # Quiz + generation
│   │   │   │   │   ├── dashboard/    # Store management hub
│   │   │   │   │   │   ├── products/ # Product CRUD
│   │   │   │   │   │   ├── orders/   # Order management
│   │   │   │   │   │   └── editor/   # Page editor
│   │   │   │   │   └── layout.tsx
│   │   │   │   └── layout.tsx
│   │   │   ├── components/
│   │   │   │   ├── ui/              # Primitives (button, input, card, modal)
│   │   │   │   ├── store/           # Store-specific components
│   │   │   │   │   ├── section-hero.tsx
│   │   │   │   │   ├── section-about.tsx
│   │   │   │   │   ├── section-product-grid.tsx
│   │   │   │   │   ├── section-cta.tsx
│   │   │   │   │   ├── section-contact.tsx
│   │   │   │   │   └── section-faq.tsx
│   │   │   │   ├── editor/          # Editor components
│   │   │   │   └── quiz/            # Onboarding quiz
│   │   │   └── lib/
│   │   │       ├── api.ts           # Fetch wrapper (targets Hono API URL)
│   │   │       └── utils.ts
│   │   └── package.json
│   │
│   └── server/                       # Hono backend (Cloudflare Worker)
│       ├── wrangler.jsonc            # Workers config (D1 + R2 bindings, routes)
│       ├── src/
│       │   ├── domain/               # DDD domain layer
│       │   │   ├── store/            # Store aggregate
│       │   │   │   ├── store.ts      # Aggregate root + entity classes
│       │   │   │   ├── product.ts    # Product entity
│       │   │   │   ├── page.ts      # Page entity + Section value objects
│       │   │   │   ├── types.ts      # Value objects, enums, branded types
│       │   │   │   ├── events.ts     # Domain events
│       │   │   │   └── rules.ts      # Business rules / invariants
│       │   │   ├── order/            # Order aggregate
│       │   │   │   ├── order.ts      # Aggregate root
│       │   │   │   ├── order-item.ts # Value object
│       │   │   │   ├── types.ts
│       │   │   │   ├── events.ts
│       │   │   │   └── rules.ts
│       │   │   └── shared/           # Shared domain primitives
│       │   │       ├── types.ts      # EntityId, AggregateRoot base, etc.
│       │   │       └── result.ts     # Result<T, E> type for domain operations
│       │   │
│       │   ├── application/          # Application layer (use cases)
│       │   │   ├── store/
│       │   │   │   ├── generate-store.ts   # AI generation use case
│       │   │   │   ├── publish-store.ts    # Publish use case
│       │   │   │   ├── update-store.ts     # Update details
│       │   │   │   └── get-store.ts        # Query use case
│       │   │   ├── product/
│       │   │   │   ├── create-product.ts
│       │   │   │   ├── update-product.ts
│       │   │   │   └── list-products.ts
│       │   │   ├── page/
│       │   │   │   ├── update-section.ts
│       │   │   │   └── reorder-sections.ts
│       │   │   ├── order/
│       │   │   │   ├── submit-order.ts
│       │   │   │   ├── list-orders.ts
│       │   │   │   └── update-order-status.ts
│       │   │   └── auth/
│       │   │       ├── register.ts
│       │   │       └── login.ts
│       │   │
│       │   ├── infrastructure/       # Infrastructure layer
│       │   │   ├── db/
│       │   │   │   ├── schema/       # Drizzle schema (SQLite, mirors domain)
│       │   │   │   │   ├── users.ts
│       │   │   │   │   ├── stores.ts
│       │   │   │   │   ├── products.ts
│       │   │   │   │   ├── pages.ts
│       │   │   │   │   ├── sections.ts
│       │   │   │   │   └── orders.ts
│       │   │   │   ├── migrations/
│       │   │   │   └── drizzle.ts    # Drizzle client init with D1 binding
│       │   │   ├── repos/            # Repository implementations
│       │   │   │   ├── d1-store-repo.ts
│       │   │   │   ├── d1-product-repo.ts
│       │   │   │   ├── d1-order-repo.ts
│       │   │   │   └── d1-page-repo.ts
│       │   │   ├── ai/
│       │   │   │   ├── llm-client.ts       # LLM API wrapper (fetch-based)
│       │   │   │   ├── prompts/            # System prompts
│       │   │   │   │   ├── store-generator.ts
│       │   │   │   │   └── product-description.ts
│       │   │   │   └── schema-validator.ts # Validate LLM JSON output
│       │   │   └── storage/
│       │   │       └── r2-file-storage.ts  # Image upload (R2 bucket)
│       │   │
│       │   ├── interfaces/           # Interface layer (HTTP)
│       │   │   ├── routes/
│       │   │   │   ├── auth.ts
│       │   │   │   ├── stores.ts
│       │   │   │   ├── products.ts
│       │   │   │   ├── pages.ts
│       │   │   │   └── orders.ts
│       │   │   ├── middleware/
│       │   │   │   ├── auth.ts
│       │   │   │   └── subdomain-resolver.ts
│       │   │   └── dto/
│       │   │       ├── store-dto.ts    # Request/response shapes
│       │   │       ├── product-dto.ts
│       │   │       └── order-dto.ts
│       │   │
│       │   └── index.ts              # Hono app entry (export default { fetch })
│       │
│       └── tests/                     # TDD tests
│           ├── domain/                # Domain unit tests (pure logic, no DB)
│           │   ├── store/
│           │   │   ├── store.test.ts
│           │   │   ├── product.test.ts
│           │   │   └── page.test.ts
│           │   └── order/
│           │       └── order.test.ts
│           ├── application/           # Application integration tests
│           │   ├── store/
│           │   │   ├── generate-store.test.ts
│           │   │   └── publish-store.test.ts
│           │   └── order/
│           │       └── submit-order.test.ts
│           └── interfaces/            # API e2e tests (Hono test client)
│               ├── stores.test.ts
│               ├── products.test.ts
│               └── orders.test.ts
│
├── packages/
│   └── db/                            # Shared D1 schema package
│       ├── src/
│       │   ├── schema/                # Drizzle SQLite schemas
│       │   └── index.ts              # Re-exports, drizzle config helpers
│       ├── drizzle.config.ts         # Drizzle Kit config (SQLite/D1)
│       └── package.json
│
├── package.json                        # Workspace root (pnpm workspaces)
├── vitest.config.ts                    # Shared test config (miniflare for D1)
├── .github/
│   └── workflows/                     # CI/CD (wrangler deploy on push)
│       ├── deploy-web.yml
│       └── deploy-server.yml
└── README.md
```

---

## TDD Strategy

### Test Layers (Testing Pyramid)

| Layer | What | Speed | Scope |
|-------|------|-------|-------|
| **Domain Unit** | Aggregate logic, invariants, business rules | Fast (< 5ms) | Pure TS, no DB, no I/O |
| **Application Integration** | Use cases with real D1 via miniflare | Medium (~200ms) | Real D1, real repos, mocked AI |
| **API E2E** | HTTP routes end-to-end via Hono test client | Medium (~150ms) | Full stack (D1 mocked or miniflare) |

### TDD Workflow

**Red → Green → Refactor** for every feature.

1. **Write domain tests first** — define the behavior you want from aggregates
2. **Make them pass** — implement domain logic (pure functions, no DB)
3. **Write application tests** — define use case success/failure paths
4. **Make them pass** — implement use cases with repo interfaces
5. **Write API tests** — define HTTP request/response contracts
6. **Make them pass** — wire routes to use cases
7. **Frontend** — build UI last, test with Playwright (post-MVP, not blocking ship)

### Domain Test Examples

```typescript
// tests/domain/store/store.test.ts
describe("Store aggregate", () => {
  it("should not publish a store with zero products", () => {
    const store = Store.create({ name: "Test", subdomain: "test", ownerId: userId });
    const result = store.publish();
    expect(result.isErr()).toBe(true);
    expect(result.error).toBeInstanceOf(StoreMustHaveProductsError);
  });

  it("should auto-generate subdomain from business name", () => {
    const subdomain = Store.generateSubdomain("Anna's Bakery");
    expect(subdomain).toBe("annas-bakery");
  });

  it("should reject duplicate subdomain via domain rule", () => {
    // Domain rule checks against repo — but the invariant belongs to the aggregate
    const store = Store.create({ name: "Test", subdomain: "taken-name", ownerId: userId });
    // Repo throws on save → application layer handles
  });
});

// tests/domain/store/page.test.ts
describe("Page entity", () => {
  it("should reorder sections by moving a section up", () => {
    const page = Page.create([
      Section.hero({ title: "A" }),
      Section.about({ text: "B" }),
      Section.productGrid({ productIds: [] }),
    ]);
    page.moveSection(2, 0); // move product-grid to top
    expect(page.sections[0].type).toBe("product-grid");
  });
});
```

### Application Test Examples

```typescript
// tests/application/store/generate-store.test.ts
describe("GenerateStore use case", () => {
  it("should create store + page + sample products from quiz answers", async () => {
    const mockAI = { generate: vi.fn().resolves(aiGeneratedPage) };
    const useCase = new GenerateStore(storeRepo, productRepo, pageRepo, mockAI);

    const result = await useCase.execute({
      ownerId: userId,
      businessName: "Anna's Bakery",
      businessType: "food",
      productCategory: "cakes",
      aestheticPreference: "warm",
      whatsappNumber: "+628123456",
    });

    expect(result.isOk()).toBe(true);
    expect(result.value.store.subdomain).toBe("annas-bakery");
    expect(result.value.products).toHaveLength.greaterThan(0);
    expect(result.value.page.sections.length).toBeGreaterThan(0);
  });

  it("should reject if subdomain is already taken", async () => {
    // Pre-seed existing store with same subdomain
    const result = await useCase.execute(quizData);
    expect(result.isErr()).toBe(true);
  });
});
```

---

## Database Schema (D1 / SQLite)

D1 is SQLite under the hood. No JSONB, no UUID type, no `ON DELETE CASCADE` in the schema. IDs are `TEXT` (UUIDs stored as strings), JSON blob columns are `TEXT` with `JSON.parse()`/`JSON.stringify()` in application code. Foreign key enforcement is handled by application layer (D1 respects PRAGMA foreign_keys but we keep FK logic in repos).

### `users`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | TEXT | PK | UUID v4 as text |
| email | TEXT | UNIQUE, NOT NULL | |
| passwordHash | TEXT | NOT NULL | bcrypt |
| name | TEXT | NOT NULL | |
| createdAt | TEXT | DEFAULT (datetime('now')) | ISO 8601 |
| updatedAt | TEXT | DEFAULT (datetime('now')) | ISO 8601 |

### `stores`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | TEXT | PK | UUID v4 as text |
| ownerId | TEXT | NOT NULL, FK → users.id (app-level) | |
| name | TEXT | NOT NULL | Business display name |
| subdomain | TEXT | UNIQUE, NOT NULL | URL identifier |
| description | TEXT | NULL | Store tagline/description |
| businessType | TEXT | NOT NULL | "food", "fashion", "service", etc. |
| aestheticPreference | TEXT | NOT NULL | "minimal", "warm", "bold" |
| whatsappNumber | TEXT | NOT NULL | For order notifications |
| status | TEXT | NOT NULL DEFAULT 'draft' | "draft" | "published" |
| heroImageUrl | TEXT | NULL | R2 object key |
| createdAt | TEXT | DEFAULT (datetime('now')) | |
| updatedAt | TEXT | DEFAULT (datetime('now')) | |

### `products`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | TEXT | PK | UUID v4 as text |
| storeId | TEXT | NOT NULL, FK → stores.id (app-level) | |
| name | TEXT | NOT NULL | |
| description | TEXT | NULL | AI-generated or manual |
| price | INTEGER | NOT NULL | Stored in Rupiah cents (e.g., 50000 = Rp 50.000) |
| imageUrl | TEXT | NULL | R2 object key |
| isAvailable | INTEGER | NOT NULL DEFAULT 1 | SQLite boolean (0/1) |
| createdAt | TEXT | DEFAULT (datetime('now')) | |
| updatedAt | TEXT | DEFAULT (datetime('now')) | |

### `pages`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | TEXT | PK | UUID v4 as text |
| storeId | TEXT | NOT NULL, FK → stores.id (app-level), UNIQUE | One page per store |
| createdAt | TEXT | DEFAULT (datetime('now')) | |
| updatedAt | TEXT | DEFAULT (datetime('now')) | |

### `sections`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | TEXT | PK | UUID v4 as text |
| pageId | TEXT | NOT NULL, FK → pages.id (app-level) | |
| type | TEXT | NOT NULL | "hero", "about", "product-grid", etc. |
| data | TEXT | NOT NULL | JSON string — parsed at app level |
| sortOrder | INTEGER | NOT NULL DEFAULT 0 | Display order |

### `orders`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | TEXT | PK | UUID v4 as text |
| storeId | TEXT | NOT NULL, FK → stores.id (app-level) | |
| customerName | TEXT | NOT NULL | |
| customerPhone | TEXT | NOT NULL | |
| items | TEXT | NOT NULL | JSON string array of OrderItem[] |
| totalAmount | INTEGER | NOT NULL | Rupiah cents |
| status | TEXT | NOT NULL DEFAULT 'pending' | "pending" | "contacted" | "completed" |
| notes | TEXT | NULL | Customer notes |
| createdAt | TEXT | DEFAULT (datetime('now')) | |
| updatedAt | TEXT | DEFAULT (datetime('now')) | |

---

## API Routes (Hono Backend)

### Auth
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register` | Email + password registration |
| POST | `/api/auth/login` | Email + password login |
| POST | `/api/auth/logout` | Clear session |

### Stores
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/stores/generate` | AI-generate store from quiz (auth required) |
| GET | `/api/stores/me` | Get current user's store (auth required) |
| PATCH | `/api/stores/:id` | Update store details (auth, owner only) |
| POST | `/api/stores/:id/publish` | Publish store (auth, owner only) |
| POST | `/api/stores/:id/unpublish` | Unpublish store (auth, owner only) |
| GET | `/api/stores/by-subdomain?subdomain=xxx` | Public: get store by subdomain (no auth) |

### Products
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/stores/:storeId/products` | Create product (auth, owner only) |
| GET | `/api/stores/:storeId/products` | List products (public for published stores) |
| PATCH | `/api/stores/:storeId/products/:id` | Update product (auth, owner only) |
| DELETE | `/api/stores/:storeId/products/:id` | Delete product (auth, owner only) |
| POST | `/api/stores/:storeId/products/generate-description` | AI-generate product description (auth, owner only) |

### Pages (Sections)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/stores/:storeId/page` | Get page with sections (auth for draft, public for published) |
| PATCH | `/api/stores/:storeId/page/sections/:id` | Update section data (auth, owner only) |
| POST | `/api/stores/:storeId/page/sections` | Add section (auth, owner only) |
| DELETE | `/api/stores/:storeId/page/sections/:id` | Remove section (auth, owner only) |
| PATCH | `/api/stores/:storeId/page/reorder` | Reorder sections (auth, owner only) |
| POST | `/api/stores/:storeId/page/regenerate` | AI-regenerate page (auth, owner only) |

### Orders
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/stores/:storeId/orders` | Submit order (public, no auth) |
| GET | `/api/stores/:storeId/orders` | List orders (auth, owner only) |
| PATCH | `/api/stores/:storeId/orders/:id` | Update order status (auth, owner only) |
| GET | `/api/stores/:storeId/orders/export` | Export CSV (auth, owner only) |

### Uploads
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/stores/:storeId/upload` | Upload image to R2 (auth, owner only) |
| GET | `/api/images/:key` | Serve image from R2 (public) |

---

## AI Prompt Strategy

### Store Generation Prompt (System)

```
You are 7okko, an AI e-commerce page generator for Indonesian UMKM businesses.
Given a business profile, generate a complete landing page structure.

RULES:
- Output must be valid JSON matching the 7okko Section Schema
- All text must be in Bahasa Indonesia unless business name is English
- Prices are in Indonesian Rupiah
- Tone: friendly, approachable, not corporate
- Always include: hero, about, product-grid, contact sections
- Optionally include: testimonial, FAQ, CTA based on business type
- Product descriptions should be realistic and enticing
- Hero copy should have a clear value proposition

SECTION SCHEMA:
{type: "hero", data: {title, subtitle, ctaText}}
{type: "about", data: {heading, text}}
{type: "product-grid", data: {heading, sampleProducts: [{name, description, price}]}}
{type: "contact", data: {heading, whatsappNumber, email, address}}
{type: "testimonial", data: {heading, items: [{name, text, rating}]}}
{type: "cta", data: {heading, buttonText, description}}
{type: "faq", data: {heading, items: [{question, answer}]}}
```

### Product Description Prompt (System)

```
You are a product description writer for an Indonesian online store.
Given a product name and category, write a compelling 2-3 sentence description in Bahasa Indonesia.
Tone: warm, inviting, highlights benefits not just features.
Keep it under 100 words.
```

---

## Deployment (Cloudflare Workers)

No Docker, no Nginx, no Postgres. Two Workers, one `wrangler deploy` each.

### Hono API Worker (`apps/server/wrangler.jsonc`)

```jsonc
{
  "name": "7okko-api",
  "main": "src/index.ts",
  "compatibility_date": "2026-07-07",
  "compatibility_flags": ["nodejs_compat"],
  "routes": [
    { "pattern": "api.7okko.com/*", "custom_domain": true }
  ],
  "d1_databases": [
    { "binding": "DB", "database_name": "7okko-db", "database_id": "<db-id>" }
  ],
  "r2_buckets": [
    { "binding": "IMAGES", "bucket_name": "7okko-images" }
  ],
  "vars": {
    "LLM_MODEL": "gpt-4o-mini"
  },
  "observability": { "enabled": true }
}
```

### Next.js Worker (`apps/web/wrangler.jsonc`)

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "main": ".open-next/worker.js",
  "name": "7okko-web",
  "compatibility_date": "2026-07-07",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "directory": ".open-next/assets",
    "binding": "ASSETS"
  },
  "routes": [
    { "pattern": "7okko.com/*" },
    { "pattern": "*.7okko.com/*" }
  ],
  "vars": {
    "API_URL": "https://api.7okko.com"
  }
}
```

### Subdomain Routing

Cloudflare handles wildcard `*.7okko.com` DNS — no Nginx needed. Next.js middleware reads the `Host` header to extract the subdomain for store resolution.

### Image Upload Flow

1. User uploads image via `POST /api/stores/:storeId/upload`
2. Hono Worker receives `multipart/form-data`
3. Writes to R2 bucket via `env.IMAGES.put(key, file)`
4. Returns the R2 public URL (or signed URL)
5. Image served directly from `api.7okko.com/images/:key` or via R2 public bucket

### Secrets & Environment

```bash
# Set once per Worker
npx wrangler secret put LLM_API_KEY --name 7okko-api
npx wrangler secret put SESSION_SECRET --name 7okko-api

# Local dev
npx wrangler dev --remote  # uses real D1 + R2
```

### CI/CD (GitHub Actions)

```yaml
# .github/workflows/deploy-server.yml
on:
  push:
    branches: [main]
    paths: ['apps/server/**']
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pnpm install
      - run: npx wrangler deploy --config apps/server/wrangler.jsonc
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CF_API_TOKEN }}
```

---

## Success Criteria for MVP

1. User can sign up with email + password
2. User completes 5-question quiz, AI generates a complete store in < 30 seconds
3. User sees a live preview of their AI-generated page immediately
4. User can edit section text inline and reorder sections
5. User can add/edit/delete products with name, price, image, description
6. Store goes live at `{subdomain}.7okko.com`
7. Customer can view the store and submit an order (WhatsApp flow)
8. Store owner sees incoming orders and can update status
9. Store owner can export orders to CSV
10. All domain logic has unit tests; all use cases have integration tests; all routes have API tests

---

## Context for Builder

This is a **greenfield project**. No legacy code, no migration. Build from zero.

**Anti-scope-creep rules:**
- If a feature isn't in the MVP list above, it doesn't exist
- If you're unsure whether to add something, the answer is no
- Image compression pipeline is FORBIDDEN (it killed Nikayu v2)
- tRPC is FORBIDDEN (it killed Nikayu v2)
- Monorepo overhead beyond this structure is FORBIDDEN
- Docker/Postgres/Nginx are FORBIDDEN — this is Cloudflare Workers, not containers
- Ship the simplest thing that works, then iterate

**Cloudflare Workers caveats:**
- No persistent filesystem — `fs` writes are lost. Use R2 for files, D1 for data.
- `nodejs_compat` flag is required for Next.js OpenNext adapter
- 30s CPU timeout per request on Workers Paid — fine for MVP (LLM calls are I/O-wait, not CPU)
- D1 is SQLite — no JSONB operators, no `ON DELETE CASCADE`, no `RETURNING` in older versions. Handle JSON in application code (JSON.stringify/JSON.parse)

**DDD discipline:**
- Domain layer has ZERO dependencies on infrastructure (no Drizzle imports, no D1 calls)
- Application layer depends on domain + repo interfaces
- Infrastructure implements repo interfaces
- Routes are thin — they parse request, call use case, format response
- If you catch domain logic leaking into routes or repos, STOP and refactor

**TDD discipline:**
- Write the test BEFORE the implementation
- Domain tests are pure — no mocks of DB, no I/O
- If a domain test needs a mock, the domain boundary is wrong
- Every use case has at least: happy path test, validation failure test, not-found/error test

**Indonesian context:** Bahasa Indonesia default, Rupiah currency, WhatsApp-first, mobile-first. If you build for a Western audience, you've built the wrong product.
