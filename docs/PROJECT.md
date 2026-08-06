# 7okko — Project Definition (Current State)

> **Status: this document reflects the implemented system as of the current codebase.**
> Last verified against the source: see `API_CONTRACT.md` and `FRONTEND_RENDERING.md` for the
> precise, implementation-level contracts.

## Overview

**7okko** is an AI-powered e-commerce creator for Indonesian business owners. Users describe their
business, and AI generates a complete landing page / online store in seconds. No design skills
needed. Think ScaleV meets AI — instead of bringing your own AI-generated HTML, 7okko *is* the AI
generation layer.

**Target market:** Indonesian UMKM owners (warung, boutique, catering, home bakery, etc.) who want
to sell online but can't design or code. They currently operate via WhatsApp groups and Instagram
DMs.

**Core differentiator:** AI-first generation. You answer 5 questions, you get a live store. Nobody
in Indonesia does this yet.

**How generation actually works today:** the AI does **not** write HTML. It outputs **structured
JSON** — a 14-token visual theme plus 8 typed sections whose `content` payloads reference a
hand-designed **block catalog** (~89 components). The frontend maps each `(section type, blockId)`
to a designed component and renders it with the theme. A design guide (one of 21 real-world
references) is injected into the prompt as inspiration so every store gets a unique visual system.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16 (App Router) via `@opennextjs/cloudflare`, React 19 |
| Backend | Hono.js on Cloudflare Workers |
| Database | D1 (SQLite) + Drizzle ORM (`drizzle-orm/d1`) |
| Storage | R2 (Cloudflare object storage) |
| Auth | better-auth (email/password + Google OAuth, HttpOnly session cookies, Drizzle adapter) |
| Email | Resend (transactional: email verification) |
| Styling | Tailwind CSS 4 (landing + dashboard) · custom CSS + inline theme tokens (storefront blocks) |
| AI | OpenAI-compatible LLM client — DeepSeek by default, provider-swappable via `LLM_BASE_URL` |
| Deployment | Cloudflare Workers (`wrangler deploy`) — two workers, no containers |

No Docker, no Nginx, no Postgres. `wrangler deploy` and it's live at 300+ edge locations.

---

## Architecture

```
                          Cloudflare Edge
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│  7okko.com  +  *.7okko.com  ──►  tokko-v2-frontend (Next.js)     │
│   api.7okko.com            ──►  tokko-api (Hono)                 │
│        │                            │                            │
│        │  fetch() /api/*            │                            │
│        └──────────┬─────────────────┘                            │
│                   ▼                                               │
│        ┌────────────────────┐                                    │
│        │  Hono API Worker   │  auth · stores · products ·        │
│        │  (tokko-api)       │  pages · orders · uploads · regions│
│        └───┬───────────┬───┘                                     │
│            │           │                                         │
│      ┌─────▼────┐ ┌────▼────┐                                    │
│      │   D1     │ │   R2    │                                    │
│      │ (SQLite) │ │ (Images)│                                    │
│      └──────────┘ └─────────┘                                    │
└──────────────────────────────────────────────────────────────────┘
```

Two independent workers, deployed separately:

- **`tokko-api`** (`tokko-v2-backend/`) — Hono app. All `/api/*` routes: auth (better-auth),
  stores, products, pages, orders, uploads, regions.
- **`tokko-v2-frontend`** (`tokko-v2-frontend/`) — Next.js App Router compiled to a Worker by
  OpenNext. Landing page, auth screens, onboarding, dashboard, and the public storefront.

### Request flow (public store)

1. Browser hits `annas-bakery.7okko.com`
2. Next.js `middleware.ts` rewrites any non-reserved subdomain host to `/store/<subdomain>`
   (rewrite keeps the host in the URL bar; `app.`, `www.`, `api.` etc. are reserved and pass
   through)
3. The `/store/[subdomain]` page (client component) calls `GET /api/stores/by-subdomain`
4. Hono queries D1, returns `{ store, sections, products, theme }`
5. `StoreRenderer` renders the page: navbar (from `theme.navbarStyle`), animated sections, footer,
   cart FAB + drawer

### AI generation flow

1. User submits the onboarding quiz (`POST /api/stores/generate`)
2. Hono loads a **design guide** (random file from the aesthetic folder matching the user's choice:
   minimal → `minimalist/`, warm → `elegant/`, bold → `aesthetic/`; rich guides preferred)
3. Hono calls the LLM (DeepSeek by default) with a system prompt embedding the guide + the full
   block catalog + theme-token spec
4. LLM returns JSON: `{ theme, sections[8], sampleProducts[5] }`
5. Hono validates/normalizes sections against the content schemas (`section-content.ts`), creates
   Store + Page + Products in D1, returns the serialized page to the frontend
6. Regeneration passes `previousBlocks` + `previousTheme` to force a different take

---

## Monorepo Layout

Two independent npm packages (each with its own git repo and `package.json`):

```
tokko-project-v2/
├── tokko-v2-backend/               # Hono API Worker ("tokko-api")
│   ├── wrangler.jsonc              # D1 + R2 bindings, vars, dev port 8787
│   ├── drizzle.config.ts           # Drizzle Kit (D1/SQLite)
│   ├── design/                     # 21 design-guide .md files (minimalist/elegant/aesthetic)
│   ├── docs/                       # PROJECT.md · API_CONTRACT.md · API.md · FRONTEND_RENDERING.md
│   ├── scripts/seed-regions.mjs    # seeds Kepmendagri 2025 regions into D1
│   ├── tests/                      # Vitest: domain / application / interfaces / smoke
│   └── src/
│       ├── index.ts                # Hono app entry (CORS, auth middleware, route mounting)
│       ├── lib/auth.ts             # better-auth factory (Google, email verification, cookies)
│       ├── types.ts                # Env bindings (single source of truth)
│       ├── domain/                 # DDD domain (zero infra deps)
│       │   ├── store/              # store.ts, product.ts, page.ts, section.ts,
│       │   │                       # section-content.ts, types.ts, rules.ts, events.ts
│       │   ├── order/              # order.ts, order-item.ts, types.ts, rules.ts, events.ts
│       │   └── shared/             # types.ts (EntityId, Result)
│       ├── application/            # use cases
│       │   ├── auth/               # login.ts, register.ts
│       │   ├── store/              # generate-store, get-store, publish/unpublish, update-store, store-repo
│       │   ├── product/            # create/update/delete/list, generate-product-description
│       │   ├── page/               # add/remove/update/reorder-section, regenerate-page,
│       │   │                       # get-page, render-section (serializer)
│       │   ├── order/              # submit-order, list-orders, update-order-status,
│       │   │                       # update-order-fulfillment
│       │   └── upload/             # upload-image
│       ├── infrastructure/
│       │   ├── db/                 # drizzle.ts, schema/ (user, session, account, verification,
│       │   │                       # stores, products, pages, sections, orders, regions, consents)
│       │   ├── repos/              # d1-store/product/page/order-repo.ts
│       │   ├── ai/                 # deepseek-client.ts, llm-client.ts (mock), ai-mode.ts,
│       │   │                       # design-loader.ts, prompts/ (store-generator, product-description)
│       │   ├── email/resend.ts     # transactional email (verification)
│       │   └── storage/            # file-storage.ts (R2 adapter used by upload route)
│       └── interfaces/
│           ├── routes/             # auth, stores, products, orders, pages, uploads, regions
│           └── dto/                # store-dto, product-dto, order-dto
│
└── tokko-v2-frontend/              # Next.js Worker ("tokko-v2-frontend", via OpenNext)
    ├── wrangler.jsonc              # OpenNext worker + WORKER_SELF_REFERENCE service binding
    ├── open-next.config.ts · next.config.ts · playwright.config.ts · vitest.config.ts
    ├── e2e/full-journey.spec.ts    # Playwright: register → quiz → generate → publish → store → order
    ├── docs/                       # PROJECT.md · API_CONTRACT.md · API.md
    └── src/
        ├── middleware.ts           # hostname-based subdomain routing
        ├── app/                    # pages: /, /login, /register, /onboarding, /onboarding/generating,
        │   │                       # /kontak, /legal/*, /dashboard/*, /store/[subdomain]
        │   ├── dashboard/          # overview, editor/, products/, orders/, settings/
        │   └── store/[subdomain]/  # public storefront
        ├── components/
        │   ├── landing/            # hero, features, how-it-works, business-types, comparison,
        │   │                       # pricing, epayment, editor-showcase, cta, footer
        │   ├── auth/               # auth-shell, google-button
        │   ├── ui/                 # image-upload, skeleton, toast
        │   ├── legal/              # consent-banner, consent-gated-scripts, legal-doc-page
        │   └── store/
        │       ├── blocks/         # THE BLOCK CATALOG (89 blocks + 6 navbars) + blocks.css
        │       ├── cart/           # cart-context, cart-drawer, cart-fab, address-form,
        │       │                   # region-select, use-regions
        │       ├── store-renderer.tsx · sections.tsx · navbar-picker.tsx · font-loader.tsx
        ├── domain/                 # order + store entities (frontend mirror)
        ├── application/            # submit-order.usecase, upload-image.usecase
        ├── infrastructure/         # api/client.ts (REST), auth/ (context, guard), repos/
        └── lib/                    # constants, utils, pricing, payments, consent, legal/

└── tokko-v2-admin/                 # Admin panel Worker ("tokko-v2-admin", via OpenNext)
    ├── wrangler.jsonc              # OpenNext worker + WORKER_SELF_REFERENCE binding
    ├── e2e/admin-journey.spec.ts   # Playwright: login → dashboard → sections (env-driven)
    └── src/
        ├── app/                    # /login, /dashboard, /dashboard/{users,stores,orders,
        │                           #   tickets,moderation,consents,logs}, /dashboard/stores/[id],
        │                           #   /dashboard/tickets/[id]
        ├── components/admin/       # sidebar, stat-card, StatusBadge
        ├── components/ui/          # toast, skeleton
        ├── infrastructure/         # api/client.ts (admin REST), auth/ (context, role guard)
        └── lib/                    # constants, utils, use-admin-data hook
```

---

## Domain Model (DDD)

Two bounded contexts: **Store** (core) and **Order** (supporting), plus two infrastructure-owned
tables with domain meaning: **Regions** (checkout address cascade) and **Consents** (UU PDP logs).

### 1. Store Context (Core Domain)

**`Store`** (Aggregate Root)
- Identity: `id`, `subdomain` (unique)
- State: `ownerId`, `name`, `description`, `businessType` (8 types), `aestheticPreference`
  (`minimal` | `warm` | `bold`), `whatsappNumber`, `status` (`draft` | `published`), `heroImageUrl`
- Behavior: `publish()`, `unpublish()`, `updateDetails()`, `setHeroImage()`
- Invariants:
  - Subdomain must be unique across the system (auto-generated from business name)
  - Store must have ≥ 1 product to publish
  - Only owner can modify store
  - One store per user

**`Product`** (Entity within Store aggregate)
- Identity: `id`
- State: `name`, `description`, `price` (integer Rupiah), `imageUrl` (R2 key), `isAvailable`,
  `type` (`product` | `service` | `booking`)
- Behavior: `updatePrice()`, `toggleAvailability()`
- Invariants: price ≥ 0; name required

**`Page`** (Entity within Store aggregate)
- Identity: `id`, `slug` (URL segment; `beranda` = home), `title`
- State: `sections` (ordered list of Section values); a store has **multiple** pages
  (free-form — any page is any ordered set of the existing section blocks)
- Behavior: `reorderSections()`, `updateSection()`, `addSection()`, `removeSection()`, `rename()`
- The **visual theme is site-wide**: it lives on the Store (`designTokens`), shared by all pages

**`Section`** (Value Object)
- Types (8, fixed order in generation): `hero`, `about`, `product-grid`, `testimonial`, `cta`,
  `faq`, `contact`, `footer`
- Data shape: `data` JSON = `{ variant, content }`; `content` carries a `blockId` that selects the
  exact designed component from the catalog
- The AI only writes content; it never writes markup. See `section-content.ts` for the typed
  content schemas and `FRONTEND_RENDERING.md` for the renderer contract.

**Theme / design tokens** — a 14-token JSON blob stored on the **Store** (`stores.design_tokens`),
shared by every page of the store:
- 8 color tokens: `accent`, `bg`, `cardBg`, `text`, `textSecondary`, `ctaText`, `borderRadius`,
  `buttonRadius`
- 1 typography token: `fontStyle` (10 options: modern-sans … handwritten-casual)
- 1 rhythm token: `spacing` (`compact` | `comfortable` | `spacious`)
- 1 depth token: `elevation` (`flat` | `subtle-shadow` | `soft-glow`)
- 1 decoration token: `decorDensity` (`minimal` | `moderate` | `rich`)
- 1 master switch: `layoutStyle` (`editorial` | `startup` | `boutique`) — cascades into the others
- plus optional `navbarStyle` (6 navbar variants)

**Block catalog** (frontend `components/store/blocks/`): the single source of truth for what the
AI may emit and what the editor can edit:
- hero 11 · about 8 · product-grid 13 · testimonial 12 · cta 13 · contact 12 · faq 13 · footer 7
  (= 89 blocks) + 6 navbar variants
- Each block definition declares its `fields` (used by both the AI prompt and the editor's field
  editor); aliases map removed blocks to their nearest kept block so old pages still render.

#### Domain events
- `StoreCreated`, `StorePublished`, `ProductAdded`, `PageGenerated`

### 2. Order Context (Supporting Domain)

**`Order`** (Aggregate Root)
- Identity: `id`, `orderCode` (human-friendly ref, e.g. `TK-8F3K2`)
- State: `storeId`, `customerName`, `customerPhone`, `items` (OrderItem[]), `totalAmount`, `status`,
  `notes`, `shippingAddress`, plus fulfillment fields: `trackingNumber`, `courier`,
  `paymentConfirmed`, `paymentNote`, `queueNumber`
- Behavior: `submit()`, `markContacted()`, `attachFulfillment()` (type-aware)
- Invariants: ≥ 1 item; customer phone required; status flow `pending → contacted → completed`
- Fulfillment is type-aware: `product` orders → resi (trackingNumber + courier); `service` →
  payment confirmation; `booking` → queue number. Owner actions return a `wa.me` deep link to
  notify the customer.

**`OrderItem`** (Value Object) — `productId`, `productName`, `quantity`, `unitPrice`, `productType`

### 3. Regions (infrastructure-owned lookup)

Indonesian administrative regions (Kepmendagri No 300.2.2-2430, 2025) in a single `regions` table:
`code` length implies level (2 = provinsi, 5 = kabupaten/kota, 8 = kecamatan, 13 = kelurahan/desa);
`parentCode` for hierarchy; `kodepos` only on level-4 rows. Seeded via `scripts/seed-regions.mjs`
(idempotent, `INSERT OR IGNORE`). Powers the checkout address cascade.

### 4. Consents (UU PDP compliance)

`consents` table logs proof of consent to the Terms & Privacy policy on registration (UU PDP
Pasal 22 & 24): userId, consent type, document versions, IP, user-agent, timestamp. Registration
is rejected without explicit consent.

### 5. Support Context (admin + customer support)

**`Ticket`** (Aggregate Root) — text-only support thread between a store owner and 7okko admin:
- Identity: `id`, `ticketCode` (e.g. `SUP-8F3K2`)
- State: `userId`, `storeId?`, `subject`, `category` (general/technical/billing/abuse/feature),
  `priority` (low/normal/high/urgent), `status`
  (`open → in_progress → resolved`, `→ closed` terminal; reopen allowed)
- Messages: `TicketMessage[]` VOs (`authorRole`: user | admin)
- Invariants: subject + first message required; closed tickets cannot receive replies

**`Report`** (Aggregate Root) — content-moderation report against a store/product/section/user:
- State: `reporterId?` (null for anonymous), `storeId`, `targetType`, `targetId`, `reason`
  (spam/inappropriate/fraud/copyright/other), `details`, `status`
  (`open → reviewing → resolved | dismissed`), `resolution` (suspended/warned/dismissed),
  `resolvedBy`, `resolvedAt`
- Invariants: reason required; self-reports rejected; resolving with `suspended` also suspends
  the store (takedown-only moderation — no pre-approval gate)

**Admin audit trail** — `admin_logs` table records every admin mutation (who, what action, which
entity, when) so moderation is accountable.

### Cross-context communication
- Order reads Store + Product data; never modifies them
- No event choreography — simple FK references (application-layer enforced)

---

## Feature List (Implemented)

### 1. Authentication (`/login`, `/register`)
- Email + password via better-auth; HttpOnly session cookies (SameSite handling for same-root vs
  cross-site deployments)
- Google OAuth (auto-enabled when `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are set)
- Email verification on signup via Resend (skipped when no `RESEND_API_KEY`)
- Registration requires consent checkbox → logged to `consents`
- `POST /api/auth/me` returns `{ user, store }` for session restore

### 2. Onboarding Quiz (`/onboarding`)
- 5 questions: business name (with **live subdomain availability check**, debounced), business
  type (8 emoji options), product category, aesthetic preference (3 options with visual previews),
  WhatsApp number
- Progress bar; single page; `answered x/5` counter
- `/onboarding/generating` — animated generation screen while `POST /api/stores/generate` runs

### 3. AI Store Generation
- DeepSeek (or any OpenAI-compatible provider) receives quiz answers + a design guide +
  block catalog + theme spec
- Output: 8 sections, 5 sample products, 14-token theme — validated against Zod schemas
- Live preview immediately after generation; **Regenerate** passes `previousBlocks` +
  `previousTheme` so the second take is visibly different
- `LLM_FORCE_MOCK=1` (or no API key) → deterministic mock generator for dev/tests

### 4. Store Editor (`/dashboard/editor`)
- Block-based editor: every section is an editable block with a **field editor** (text inputs,
  array item editors for stats/FAQ/testimonials/links), **image upload**, and block switching
- **Multi-page**: page tabs (switch/add/delete), add-page modal with templates
  (Tentang / Produk / Kontak / FAQ / kosong); section editing + regenerate target the
  active page via `?page=`
- **Theme editor** (`/dashboard/settings`): per-token controls (colors, radius, spacing,
  elevation, decoration, layout style, navbar style) — site-wide
- Reorder sections, add new sections from the catalog, delete sections, regenerate the page
- Every mutation replaces client state with the server-returned Page (never patch locally)

### 5. Product Catalog (`/dashboard/products`)
- CRUD: name, price (Rupiah, formatted input), description, image, availability toggle
- **Product type**: `product` | `service` | `booking` (drives order fulfillment in the dashboard)
- AI auto-generates product descriptions (`POST .../generate-description`)

### 6. Image Upload
- `POST /api/stores/:storeId/upload` (multipart, `purpose: product | hero`), stored on R2
- Served at `GET /api/images/*` with `Cache-Control: public, max-age=31536000, immutable`
- Validation: file required, purpose whitelist; size cap in the use case

### 7. Public Store Page (`{subdomain}.7okko.com`)
- Hostname-based routing in `middleware.ts` (reserved subdomains: app, www, admin, api, …)
- **Multi-page**: `{sub}.7okko.com` = home, `{sub}.7okko.com/{slug}` = inner pages
  (middleware preserves the path); the navbar shows links to all pages when there is
  more than one; unknown page → "Halaman tidak ditemukan"
- Client-side fetch of `{ store, sections, products, theme, pages }`, rendered by `StoreRenderer`
- Navbar (6 variants via `theme.navbarStyle`), scroll-triggered section animations, font loader
  (per `fontStyle`), footer always rendered from the footer block catalog
- Not found / not published / suspended → friendly Indonesian error page

### 8. Cart + WhatsApp Checkout
- Cart drawer + floating button (themed), quantities persisted per store in localStorage
  (`tokko.cart.<storeId>`), re-hydrated against fresh product data on load
- Checkout form: name, phone, **region cascade address** (provinsi → kabupaten → kecamatan →
  kelurahan with kodepos, from `/api/regions/*`), notes
- Submit → `POST /api/stores/:storeId/orders` → order saved, response includes a `wa.me` deep
  link carrying the order summary for the store owner
- No payment gateway yet (Xendit planned — see Deferred)

### 9. Order Dashboard (`/dashboard/orders`)
- Table + status filter (`all | pending | contacted | completed`) with counts
- Type-aware fulfillment: resi (courier + tracking number) for products, payment confirmation for
  services, queue number for bookings — each returns a `wa.me` deep link to notify the customer
- Status transitions `pending → contacted → completed`
- CSV export

### 10. Subdomain Management
- Auto-generated from business name (`generateSubdomain`), checked live during onboarding
- First-come, first-served; uniqueness enforced in the generate use case
- Reserved hosts list in `constants.ts`

### 11. Legal & Consent (UU PDP)
- Landing + legal pages: `/legal/kebijakan-privasi`, `/kebijakan-cookie`, `/kebijakan-refund`,
  `/syarat-ketentuan`; contact page `/kontak`
- Consent banner with **consent-gated scripts** (no third-party scripts until consent)
- Consent logged server-side at registration

### 12. Marketing Landing Page
- hero, features, how-it-works, business-types, comparison, pricing (with payment methods:
  QRIS/OVO/GoPay/DANA/ShopeePay/VAs via Xendit — "segera hadir"), e-payment, editor showcase,
  CTA, footer

### 13. Admin Panel (`admin.7okko.com` — separate worker, same backend)
- **Role model:** better-auth admin plugin → `user.role` (`user` | `admin`) + `user.banned`;
  `requireAdmin` middleware guards every `/api/admin/*` route; ban overrides role
- **Dashboard:** live aggregates — users (total/admins/banned/new 7d/30d), stores
  (total/published/draft/suspended), orders + GMV (7d/30d), open tickets, pending reports
- **User management:** search/list, detail (store + order counts), ban with reason / unban / role
  change (self ban/demote blocked; bans revoke sessions via better-auth)
- **Store moderation:** list with filters (draft/published/suspended), full detail (owner,
  products, page sections, orders), **suspend with reason** (hides store from the public
  storefront), unsuspend, delete (cascades products/page/orders)
- **Orders:** all-stores table with status filters + fulfillment detail
- **Tickets:** inbox (status tabs, search), thread view, admin replies, status/priority controls
- **Moderation queue:** reports with reason/details, review → resolve
  (suspend the store / warn / dismiss)
- **UU PDP audit:** consent log per user · **Audit log:** admin action trail
- Every admin mutation is written to `admin_logs`
- Admin accounts are bootstrapped with `scripts/promote-admin.mjs <email> [--remote]`

---

## NOT in Scope (Deferred)

- Payment gateway (Xendit planned; landing page already lists methods as "segera hadir")
- Custom domains (CORS already supports `ALLOWED_ORIGINS`)
- Analytics dashboard
- Drag-and-drop canvas builder (block editor + field editor instead)
- Multi-store per account
- Inventory management · shipping integration · discount/coupons · multi-language
- Image compression pipeline (deliberately forbidden — killed Nikayu v2)
- SEO auto-optimization · ad copy generation

---

## Database Schema (D1 / SQLite)

D1 is SQLite: no JSONB, no UUID type, no `ON DELETE CASCADE`. IDs are `TEXT` UUIDs; JSON blobs
are `TEXT`; booleans are `INTEGER` 0/1; FKs enforced in application code. Migrations live in
`src/infrastructure/db/migrations/` (6 applied).

### Auth tables (managed by better-auth, Drizzle adapter)
- `user` — id, name, email (unique), emailVerified, image, **role (default 'user')**, **banned**,
  banReason, banExpires, createdAt, updatedAt
- `session` — id, expiresAt, token (unique), ipAddress, userAgent, userId
- `account` — id, accountId, providerId, userId, tokens, password, scope, …
- `verification` — id, identifier, value, expiresAt

### `stores`
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| ownerId | TEXT NOT NULL → user.id | one store per owner |
| name | TEXT NOT NULL | display name |
| subdomain | TEXT NOT NULL UNIQUE | URL identifier |
| description | TEXT NULL | |
| businessType | TEXT NOT NULL | food/fashion/gift/beauty/craft/gadget/home/service |
| aestheticPreference | TEXT NOT NULL | minimal/warm/bold |
| whatsappNumber | TEXT NOT NULL | owner WhatsApp |
| status | TEXT NOT NULL DEFAULT 'draft' | draft/published |
| heroImageUrl | TEXT NULL | R2 key |
| **suspendedAt** | TEXT NULL | moderation takedown timestamp |
| **suspendedReason** | TEXT NULL | why it was suspended |
| **designTokens** | TEXT NULL | **site-wide theme (14 tokens), shared by all pages** |
| createdAt / updatedAt | TEXT | ISO 8601 |

### `products`
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | |
| storeId | TEXT NOT NULL → stores.id | |
| name | TEXT NOT NULL | |
| description | TEXT NULL | AI-generated or manual |
| price | INTEGER NOT NULL | integer Rupiah (85000 = Rp 85.000) |
| imageUrl | TEXT NULL | R2 key |
| isAvailable | INTEGER NOT NULL DEFAULT 1 | 0/1 |
| type | TEXT NOT NULL DEFAULT 'product' | product/service/booking |
| createdAt / updatedAt | TEXT | |

### `pages`
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | |
| storeId | TEXT NOT NULL → stores.id | **UNIQUE(store_id, slug)** — multiple pages per store |
| slug | TEXT NOT NULL DEFAULT 'beranda' | URL segment; home = beranda |
| title | TEXT NULL | display title for the navbar |
| designTokens | TEXT NULL | legacy/unused — theme lives on stores |
| createdAt / updatedAt | TEXT | |

### `sections`
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | |
| pageId | TEXT NOT NULL → pages.id | |
| type | TEXT NOT NULL | hero/about/product-grid/testimonial/cta/contact/faq/footer |
| data | TEXT NOT NULL | JSON `{ variant, content }`; content.blockId selects catalog block |
| sortOrder | INTEGER NOT NULL DEFAULT 0 | display order |

### `orders`
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | |
| storeId | TEXT NOT NULL → stores.id | |
| orderCode | TEXT NULL | e.g. TK-8F3K2 |
| customerName | TEXT NOT NULL | |
| customerPhone | TEXT NOT NULL | |
| items | TEXT NOT NULL | JSON OrderItem[] |
| totalAmount | INTEGER NOT NULL | Rupiah |
| status | TEXT NOT NULL DEFAULT 'pending' | pending/contacted/completed |
| notes | TEXT NULL | |
| shippingAddress | TEXT NULL | required for physical orders |
| trackingNumber | TEXT NULL | nomor resi |
| courier | TEXT NULL | jasa kirim |
| paymentConfirmed | INTEGER NOT NULL DEFAULT 0 | 0/1 |
| paymentNote | TEXT NULL | |
| queueNumber | TEXT NULL | booking orders |
| createdAt / updatedAt | TEXT | |

### `regions`
| Column | Type | Notes |
|--------|------|-------|
| code | TEXT PK | official dotted code; length implies level |
| name | TEXT NOT NULL | |
| level | INTEGER NOT NULL | 1..4 |
| parentCode | TEXT NULL | containing region (NULL for provinces) |
| kodepos | TEXT NULL | level-4 only |

### `consents`
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | |
| userId | TEXT NOT NULL | |
| type | TEXT NOT NULL | e.g. terms_privacy |
| termsVersion / privacyVersion | TEXT NOT NULL | currently "1.0" |
| ip | TEXT NULL | cf-connecting-ip |
| userAgent | TEXT NULL | |
| createdAt | INTEGER (timestamp_ms) | |

### `tickets` + `ticket_messages`
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | |
| userId | TEXT NOT NULL → user.id | owner |
| storeId | TEXT NULL | optional related store |
| ticketCode | TEXT NOT NULL | SUP-XXXXX |
| subject / category / priority / status | TEXT NOT NULL | status default 'open' |
| createdAt / updatedAt | TEXT | |

`ticket_messages`: id, ticketId → tickets.id, authorId, authorRole (user/admin), body, createdAt

### `reports`
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | |
| reporterId | TEXT NULL → user.id | anonymous allowed |
| storeId | TEXT NOT NULL → stores.id | |
| targetType / targetId | TEXT NOT NULL | store/product/section/user + id |
| reason / details | TEXT | spam/inappropriate/fraud/copyright/other |
| status | TEXT DEFAULT 'open' | open/reviewing/resolved/dismissed |
| resolution / resolvedBy / resolvedAt | TEXT NULL | set on resolution |
| createdAt | TEXT | |

### `admin_logs`
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | |
| adminId | TEXT NOT NULL | who acted |
| action | TEXT NOT NULL | e.g. user.ban, store.suspend, report.resolve |
| targetType / targetId | TEXT NOT NULL | entity acted on |
| detail | TEXT NULL | JSON context (reason, before/after) |
| createdAt | INTEGER (timestamp_ms) | |

---

## API Routes (Hono, mounted in `src/index.ts`)

All responses use `{ error: { code, message } }` on failure; auth via HttpOnly session cookie
(credentials: include). CORS allows 7okko.com origins + store subdomains.

### Auth (`/api/auth` + better-auth catch-all `/api/auth/*`)
| Method | Path | Auth | Notes |
|--------|------|------|-------|
| POST | `/api/auth/register` | — | name, email, password ≥ 8, consent=true → user + session cookie + consent log |
| POST | `/api/auth/login` | — | returns `{ user, store }` + session cookie |
| POST | `/api/auth/logout` | ✓ | clears session |
| GET | `/api/auth/me` | ✓ | `{ user, store \| null }` |
| * | `/api/auth/*` | — | better-auth built-ins: `sign-in/social` (Google authorize URL), `callback/google`, `verify-email`, … |

### Stores (`/api/stores`)
| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/check-subdomain?name=` | — | previews generated subdomain + availability |
| POST | `/generate` | ✓ | quiz → { store, page, products }; 409 if onboarded/subdomain taken; 422 AI failure |
| GET | `/me` | ✓ | current user's store or null |
| GET | `/by-subdomain?subdomain=` | — | public: { store, sections, products, theme }; 404 if unpublished |
| PATCH | `/:id` | owner | name, description, whatsappNumber, heroImageUrl |
| POST | `/:id/publish` | owner | invariant: ≥ 1 product |
| POST | `/:id/unpublish` | owner | |

### Products (`/api/stores`)
| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/:storeId/products` | —* | list (public for published stores) |
| POST | `/:storeId/products` | owner | name, price, description?, imageUrl?, type? |
| PATCH | `/:storeId/products/:id` | owner | |
| DELETE | `/:storeId/products/:id` | owner | |
| POST | `/:storeId/products/generate-description` | owner | { name, category } → AI description |

### Page / Sections (`/api/stores`)
| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/:storeId/page` | public if published | serialized page (sections + theme) |
| PATCH | `/:storeId/page/theme` | owner | merges partial theme tokens |
| PATCH | `/:storeId/page/sections/:id` | owner | content and/or variant |
| POST | `/:storeId/page/sections` | owner | { type, variant, content, sortOrder? } |
| DELETE | `/:storeId/page/sections/:id` | owner | |
| PATCH | `/:storeId/page/reorder` | owner | { sectionIds } |
| POST | `/:storeId/page/regenerate` | owner | anti-repeat: picks different blocks + theme |

### Orders (`/api/stores`)
| Method | Path | Auth | Notes |
|--------|------|------|-------|
| POST | `/:storeId/orders` | — | public; validates published store + available products; returns `{ order, waDeepLink }` |
| GET | `/:storeId/orders` | owner | ?status= · ?limit= · ?offset=; returns { orders, counts } |
| PATCH | `/:storeId/orders/:id` | owner | { status } with transition rules |
| PUT | `/:storeId/orders/:id/fulfillment` | owner | resi/payment/queue fields → `{ order, waDeepLink }` to customer |
| GET | `/:storeId/orders/export` | owner | CSV download |

### Uploads (`/api`)
| Method | Path | Auth | Notes |
|--------|------|------|-------|
| POST | `/stores/:storeId/upload` | owner | multipart `file` + `purpose` (product\|hero) → R2 |
| GET | `/images/*` | — | public, immutable cache |

### Regions (`/api/regions`) — public, cached 1 day
| Method | Path |
|--------|------|
| GET | `/provinces` |
| GET | `/regencies/:provinceCode` |
| GET | `/districts/:regencyCode` |
| GET | `/villages/:districtCode` (includes kodepos) |

### Support (user-facing) — `src/interfaces/routes/support.ts`
| Method | Path | Auth | Notes |
|--------|------|------|-------|
| POST | `/api/tickets` | ✓ | open ticket: subject, category, priority?, storeId?, message |
| GET | `/api/tickets/mine` | ✓ | my tickets, paginated |
| GET | `/api/tickets/:id` | owner/admin | full thread |
| POST | `/api/tickets/:id/reply` | owner/admin | append message (admin → authorRole admin) |
| PATCH | `/api/tickets/:id/status` | owner/admin | validated transitions |
| POST | `/api/stores/:storeId/report` | — | public moderation report (self-report blocked) |

### Admin (`/api/admin`) — `src/interfaces/routes/admin.ts`, every route requires admin role
| Method | Path | Notes |
|--------|------|-------|
| GET | `/stats` | dashboard aggregates |
| GET | `/users` · `/users/:id` | list/search · detail (store + orders) |
| PATCH | `/users/:id` | ban / unban / setRole (self-action blocked) |
| GET | `/stores` · `/stores/:id` | list w/ filters · full detail |
| POST | `/stores/:id/suspend` · `/unsuspend` | moderation takedown + restore |
| DELETE | `/stores/:id` | cascade delete |
| GET | `/orders` | all stores, enriched with storeName |
| GET | `/tickets` · `/tickets/:id` | inbox · thread (userEmail enriched) |
| POST | `/tickets/:id/reply` · PATCH `/tickets/:id` | reply · status/priority |
| GET | `/reports` · `/reports/:id` | queue · detail |
| POST | `/reports/:id/review` · `/resolve` | review · resolve (suspended → suspends store) |
| GET | `/consents?userId=` | UU PDP audit |
| GET | `/logs` | admin audit trail |

---

## AI Prompt Strategy

### Store generation (system prompt in `prompts/store-generator.ts`)
- Role: "AI penulis konten untuk halaman toko online UMKM Indonesia" — the model writes **data,
  never HTML/CSS**
- **Design guide injection**: the guide for the user's aesthetic is embedded under a
  `## REFERENSI DESAIN` block with the instruction to derive *concrete* hex values from it and
  match its personality — not invent a generic blue/grey palette
- **Theme spec**: full 14-token spec with allowed values and the `layoutStyle` master-switch
  rules (font/spacing/elevation/decor must be consistent with the chosen layout style)
- **Block catalog**: every section type lists its blocks with a short usage description and the
  fields each block expects (`getBlockCatalogDescription()` keeps prompt and editor in sync)
- **Anti-fabrication**: numeric/metric fields (stats, ratings, years, sold counts) must be left
  empty unless the user provided real numbers
- **Anti-repeat on regenerate**: `blokSebelumnya` + `temaSebelumnya` are passed in; the model must
  choose different blockIds and a different palette
- **Strict output rules**: exactly 8 sections in order (hero → about → product-grid → testimonial →
  cta → faq → contact → footer); 5 sample products; prices in integer Rupiah; Bahasa Indonesia;
  JSON only, no markdown fences, no external image URLs

### Design guides (`design/`)
- 21 references from styles.refero.design in 3 families: minimalist (6), elegant (8), aesthetic (7)
- `design-loader.ts` picks a random **rich** guide (≥ 1500 chars, ≥ 4 hex codes) from the folder
  mapped to the user's aesthetic; warns when only thin guides exist

### Product descriptions
- Short prompt: 2–3 sentence description in Bahasa Indonesia, benefit-led, < 100 words

### Provider-agnostic client (`deepseek-client.ts`)
- OpenAI-compatible `chat/completions` via plain `fetch`; JSON-mode + schema validation
- Default `https://api.deepseek.com/v1` / `deepseek-chat`; overridable via `LLM_BASE_URL` /
  `LLM_MODEL` (prod uses `deepseek-v4-flash`)
- `ai-mode.ts`: real AI whenever a non-mock `LLM_API_KEY` is set; `LLM_FORCE_MOCK=1` forces mock

---

## Deployment & Environment

Two workers, one `wrangler deploy` each. Custom domains (`api.7okko.com`, `7okko.com`,
`*.7okko.com`) are attached in the Cloudflare dashboard; there are no `routes` in wrangler.jsonc.

### Hono API Worker (`tokko-v2-backend/wrangler.jsonc`)
```jsonc
{
  "name": "tokko-api",
  "main": "src/index.ts",
  "compatibility_date": "2026-07-29",
  "compatibility_flags": ["nodejs_compat"],
  "d1_databases": [{ "binding": "DB", "database_name": "tokko-db", "database_id": "<db-id>" }],
  "r2_buckets":  [{ "binding": "IMAGES", "bucket_name": "tokko-images" }],
  "vars": {
    "LLM_MODEL": "deepseek-v4-flash",
    "BETTER_AUTH_URL": "https://api.7okko.com",
    "FRONTEND_URL": "https://7okko.com",
    "RESEND_FROM": "no-reply@7okko.com",
    "NODE_ENV": "production"
  },
  "observability": { "enabled": true },
  "dev": { "port": 8787 }
}
```

### Next.js Worker (`tokko-v2-frontend/wrangler.jsonc`)
```jsonc
{
  "name": "tokko-v2-frontend",
  "main": ".open-next/worker.js",
  "compatibility_date": "2026-07-29",
  "compatibility_flags": ["nodejs_compat", "global_fetch_strictly_public"],
  "assets": { "directory": ".open-next/assets", "binding": "ASSETS" },
  "services": [{
    "binding": "WORKER_SELF_REFERENCE",
    "service": "tokko-v2-frontend"
  }],
  "observability": { "enabled": true }
}
```

### Admin Worker (`tokko-v2-admin/wrangler.jsonc`)
Same shape as the frontend worker but named `tokko-v2-admin` (custom domain
`admin.7okko.com` in the Cloudflare dashboard). The admin app reads
`NEXT_PUBLIC_API_URL` (default `http://localhost:8787`). Backend CORS +
better-auth `trustedOrigins` include `https://admin.7okko.com` and
`http://localhost:3001` (admin dev server).

### Environment variables (`src/types.ts` — Env)
| Var | Required | Purpose |
|-----|----------|---------|
| `DB` | ✓ binding | D1 |
| `IMAGES` | ✓ binding | R2 |
| `BETTER_AUTH_SECRET` | ✓ secret | session signing |
| `BETTER_AUTH_URL` | ✓ var | API origin (cookie/callback base) |
| `LLM_API_KEY` | secret | AI; `sk-mock-key` or missing → mock mode |
| `LLM_MODEL` | var | e.g. `deepseek-v4-flash` |
| `LLM_BASE_URL` | var opt | OpenAI-compatible base; defaults to DeepSeek |
| `LLM_FORCE_MOCK` | var opt | `1` forces mock even with a key |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | secret opt | enables Google OAuth |
| `RESEND_API_KEY` | secret opt | enables email verification |
| `RESEND_FROM` | var opt | default `no-reply@7okko.com` |
| `FRONTEND_URL` | var opt | CORS + trusted origins |
| `ALLOWED_ORIGINS` | var opt | extra comma-separated CORS origins |
| `NODE_ENV` | var opt | |

Secrets: `npx wrangler secret put BETTER_AUTH_SECRET --name tokko-api` (same for LLM_API_KEY,
GOOGLE_*, RESEND_API_KEY). Local dev: `npx wrangler dev` (port 8787) with a `.dev.vars` file.

### Session cookies
better-auth sets an HttpOnly session cookie. `createAuth` computes whether API and frontend share a
registrable root domain (7okko.com) — same-root → `SameSite=Lax`; different roots (workers.dev) →
`SameSite=None; Secure`. Google redirect URI must match
`${BETTER_AUTH_URL}/api/auth/callback/google` exactly.

---

## Testing Strategy

| Layer | Where | What |
|-------|-------|------|
| Domain unit | `backend/tests/domain/` | aggregates, invariants, rules — pure TS, no I/O |
| Application | `backend/tests/application/` | use cases against real D1 (miniflare pool) with mocked AI |
| API e2e | `backend/tests/interfaces/` | Hono test client: auth, stores, products, orders, uploads |
| Smoke | `backend/tests/smoke/` | AI generation smoke test |
| Frontend unit | `frontend/src/**/__tests__/` | Vitest + Testing Library + happy-dom: editor field editor, cart, toasts, consent banner, blocks, money/order/store entities |
| E2E | `frontend/e2e/full-journey.spec.ts` | Playwright: register → quiz → generate → dashboard → publish → store → order |
| Admin FE unit | `admin/src/**/__tests__/` | Vitest + Testing Library: utils, StatusBadge, auth context |
| Admin E2E | `admin/e2e/admin-journey.spec.ts` | Playwright: login → dashboard → sections (env-driven, skips without credentials) |

Scripts: backend `npm test` / `test:coverage` / `typecheck`; frontend `npm test` / `test:ui` /
`test:e2e` / `lint` / `build` (opennextjs-cloudflare + wrangler deploy).

---

## Success Criteria (MVP — all met)

1. Sign up with email + password (plus Google OAuth + email verification)
2. 5-question quiz → AI generates a complete store in < 30 seconds
3. Live preview immediately after generation
4. Edit section content, blocks, theme, navbar; reorder/add/delete sections
5. Add/edit/delete products (typed product/service/booking) with price, image, AI description
6. Store goes live at `{subdomain}.7okko.com` (hostname routing)
7. Customer browses the store, adds to cart, submits an order with address (region cascade);
   owner gets a WhatsApp deep link
8. Owner sees incoming orders, filters by status, attaches fulfillment (resi/payment/queue),
   notifies the customer via WhatsApp, exports CSV
9. Consent + legal pages compliant with UU PDP
10. All domain logic unit-tested; use cases integration-tested; routes API-tested; full journey e2e-tested

---

## Context for Builder

**Anti-scope-creep rules (still in force):**
- If a feature isn't in the lists above, it doesn't exist
- Image compression pipeline is FORBIDDEN (it killed Nikayu v2)
- tRPC is FORBIDDEN (it killed Nikayu v2)
- Docker/Postgres/Nginx are FORBIDDEN — this is Cloudflare Workers, not containers
- Ship the simplest thing that works, then iterate

**Cloudflare Workers caveats:**
- No persistent filesystem — `fs` writes are lost. R2 for files, D1 for data
- `nodejs_compat` is required for the OpenNext adapter
- D1 is SQLite — no JSONB, no `ON DELETE CASCADE`; JSON handled in application code
- D1 has a free-tier row limit — the 83k-row `regions` seed is the largest dataset; keep it in one
  table, code-length-encoded, and cached aggressively

**DDD discipline (as implemented):**
- `domain/` has ZERO infrastructure imports (no Drizzle, no D1) — verified by test
- `application/` depends on domain + repo interfaces; use cases return `Result<T, E>`
- `infrastructure/` implements repos, AI client, email, storage
- `interfaces/routes` are thin: parse → validate (zod) → call use case → serialize
- The **block catalog + theme tokens** are the contract between AI and frontend — new blocks must
  be added to the catalog AND the prompt together

**TDD discipline:**
- Domain tests are pure; use cases cover happy path + validation + not-found
- Every UI mutation path has a component test where practical; the full journey is covered by
  Playwright

**Indonesian context:** Bahasa Indonesia default, Rupiah currency, WhatsApp-first, mobile-first.
If you build for a Western audience, you've built the wrong product.
