# Tokko — Backend API Contract

Derived from the frontend screens. Every endpoint here has a corresponding mock-data swap point in the UI.

**Base URL:** `https://api.tokko.com` (dev: `http://localhost:8787`)
**Auth:** Session cookie (`tokko_session`, HttpOnly, SameSite=Lax) — set on login/register, sent automatically.
**Content type:** `application/json` everywhere except `POST /upload` (`multipart/form-data`).

## Conventions

### Error shape (all endpoints)
```json
{
  "error": {
    "code": "SUBDOMAIN_TAKEN",
    "message": "Subdomain sudah dipakai. Coba nama lain.",
    "field": "businessName"
  }
}
```
- `400` validation · `401` unauthenticated · `403` not owner · `404` not found · `409` conflict · `422` AI output invalid · `429` rate limited
- `field` present on validation errors → UI highlights that input

### Shared types (mirror `app/lib/mock-data.ts`)
```ts
type StoreStatus = "draft" | "published";
type OrderStatus = "pending" | "contacted" | "completed";
type Aesthetic   = "minimal" | "warm" | "bold";
type SectionType = "hero" | "about" | "product-grid" | "testimonial" | "cta" | "contact" | "faq";
// Money = integer Rupiah (no cents — e.g. 85000 = Rp 85.000)
// IDs = UUID v4 strings. Timestamps = ISO 8601.
```

---

## 1. Auth — used by `/login`, `/register`, dashboard layout

| Method | Path | Auth | Screen |
|--------|------|------|--------|
| POST | `/api/auth/register` | — | `/register` |
| POST | `/api/auth/login` | — | `/login` |
| POST | `/api/auth/logout` | ✓ | dashboard sidebar |
| GET | `/api/auth/me` | ✓ | dashboard layout (guard) |

### `POST /api/auth/register`
```json
// → { "name": "Anna Wijaya", "email": "anna@mail.com", "password": "min8chars" }
// ← 201 { "user": { "id", "name", "email" } }  + Set-Cookie
```
Errors: `409 EMAIL_TAKEN`, `400 VALIDATION`

### `POST /api/auth/login`
```json
// → { "email": "...", "password": "..." }
// ← 200 { "user": {...}, "store": Store | null }   // store=null → frontend redirects to /onboarding
```
Errors: `401 INVALID_CREDENTIALS`

### `GET /api/auth/me`
```json
// ← 200 { "user": {...}, "store": Store | null }
```

---

## 2. Stores — onboarding quiz, generation, settings

| Method | Path | Auth | Screen |
|--------|------|------|--------|
| GET | `/api/stores/check-subdomain?name=...` | ✓ | onboarding (live availability badge) |
| POST | `/api/stores/generate` | ✓ | onboarding → generating |
| GET | `/api/stores/me` | ✓ | dashboard layout + all dashboard pages |
| PATCH | `/api/stores/:id` | ✓ owner | settings |
| POST | `/api/stores/:id/publish` | ✓ owner | settings / sidebar toggle |
| POST | `/api/stores/:id/unpublish` | ✓ owner | settings / sidebar toggle |
| GET | `/api/stores/by-subdomain?subdomain=xxx` | public | `/store/[subdomain]` |

### `GET /api/stores/check-subdomain?name=Anna's Bakery`
```json
// ← 200 { "subdomain": "annas-bakery", "available": true }
```
Frontend slugifies the same way (`generateSubdomain` in mock-data.ts); backend must match: lowercase, strip non `[a-z0-9\s-]`, spaces→`-`, collapse `-`, max 30 chars.

### `POST /api/stores/generate` — the core endpoint
```json
// → {
//   "businessName": "Anna's Bakery",
//   "businessType": "food",            // food|fashion|gift|beauty|craft|gadget|home|service
//   "productCategory": "kue ulang tahun custom",
//   "aesthetic": "warm",
//   "whatsappNumber": "+6281234567890"
// }

// ← 201 {
//   "store": Store,                    // status: "draft"
//   "page": { "id": "...", "sections": Section[] },
//   "products": Product[]              // 5-6 AI-generated samples
// }
```
Backend flow: build prompt → LLM → validate JSON against section schema → create Store + Page + Sections + Products in one transaction.
Errors: `409 SUBDOMAIN_TAKEN` · `422 AI_GENERATION_FAILED` (frontend offers Regenerate = retry same POST)

`Section` shape:
```json
{ "id": "sec_...", "type": "hero", "sortOrder": 0, "data": { "title": "...", "subtitle": "...", "ctaText": "..." } }
```
Section `data` schemas per type (must match `store-renderer.tsx`):
- `hero`: `{ title, subtitle, ctaText }`
- `about`: `{ heading, text }`
- `product-grid`: `{ heading }` (products resolved separately)
- `testimonial`: `{ heading, items: [{ name, text, rating }] }`
- `cta`: `{ heading, description, buttonText }`
- `faq`: `{ heading, items: [{ question, answer }] }`
- `contact`: `{ heading, whatsappNumber, address, hours }`

### `PATCH /api/stores/:id`
```json
// → { "name"?, "description"?, "whatsappNumber"?, "heroImageUrl"? }
// ← 200 { "store": Store }
```

### `POST /api/stores/:id/publish`
Invariant (from spec): **must have ≥1 product** → else `400 STORE_HAS_NO_PRODUCTS`.
```json
// ← 200 { "store": Store }  // status: "published"
```

### `GET /api/stores/by-subdomain?subdomain=annas-bakery` — public
```json
// ← 200 { "store": Store, "sections": Section[], "products": Product[] }
// ← 404 { "error": { "code": "STORE_NOT_FOUND" } }
// ← 404 { "error": { "code": "STORE_NOT_PUBLISHED" } }   // drafts not publicly visible
```
This is the hot path — cache aggressively at the edge.

---

## 3. Products — `/dashboard/products`

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/stores/:storeId/products` | ✓ owner (public stores: public read OK) |
| POST | `/api/stores/:storeId/products` | ✓ owner |
| PATCH | `/api/stores/:storeId/products/:id` | ✓ owner |
| DELETE | `/api/stores/:storeId/products/:id` | ✓ owner |
| POST | `/api/stores/:storeId/products/generate-description` | ✓ owner |

### `POST .../products`
```json
// → { "name": "Rainbow Cake", "price": 85000, "description": "...", "imageUrl": null }
// ← 201 { "product": Product }
```
Errors: `400 PRODUCT_LIMIT_REACHED` (max 20) · `400 VALIDATION` (name required, price ≥ 0)

### `PATCH .../products/:id`
Partial update — the availability toggle sends just:
```json
// → { "isAvailable": false }
// ← 200 { "product": Product }
```

### `POST .../products/generate-description`
```json
// → { "name": "Rainbow Cake", "category": "kue" }
// ← 200 { "description": "Kue bolu pelangi lembut dengan..." }
```
Errors: `422 AI_GENERATION_FAILED`

`Product`:
```ts
{ id, storeId, name, description: string | null, price: number,
  imageUrl: string | null, isAvailable: boolean, createdAt, updatedAt }
```

---

## 4. Pages / Sections — `/dashboard/editor`

| Method | Path | Auth | Used by |
|--------|------|------|---------|
| GET | `/api/stores/:storeId/page` | ✓ owner | editor load |
| PATCH | `/api/stores/:storeId/page/sections/:id` | ✓ owner | inline text edit (debounced save) |
| POST | `/api/stores/:storeId/page/sections` | ✓ owner | add-section menu |
| DELETE | `/api/stores/:storeId/page/sections/:id` | ✓ owner | ✕ button |
| PATCH | `/api/stores/:storeId/page/reorder` | ✓ owner | ↑↓ arrows |
| POST | `/api/stores/:storeId/page/regenerate` | ✓ owner | ↻ regenerate button |

### `PATCH .../page/sections/:id` — inline edit
```json
// → { "data": { "title": "Kue Homemade Premium..." } }   // full data object for that section
// ← 200 { "section": Section }
```

### `POST .../page/sections`
```json
// → { "type": "faq", "data": { "heading": "FAQ", "items": [...] }, "sortOrder": 6 }
// ← 201 { "section": Section }
```

### `PATCH .../page/reorder`
```json
// → { "sectionIds": ["sec_003", "sec_001", "sec_002"] }   // new order, full list
// ← 200 { "sections": Section[] }
```

### `POST .../page/regenerate`
Re-runs AI on existing store profile, **replaces all sections**. Products untouched.
```json
// ← 200 { "page": { "id", "sections": Section[] } }
```

---

## 5. Orders — `/dashboard/orders` + store order sheet

| Method | Path | Auth | Screen |
|--------|------|------|--------|
| POST | `/api/stores/:storeId/orders` | **public** | store order bottom sheet |
| GET | `/api/stores/:storeId/orders` | ✓ owner | orders page (+ dashboard recent) |
| PATCH | `/api/stores/:storeId/orders/:id` | ✓ owner | status advance button |
| GET | `/api/stores/:storeId/orders/export` | ✓ owner | CSV export button |

### `POST .../orders` — public, rate-limit this one
```json
// → {
//   "customerName": "Rina Susanti",
//   "customerPhone": "+628111222333",
//   "items": [{ "productId": "prod_001", "quantity": 1 }],
//   "notes": "untuk ulang tahun, tulis nama Naya"
// }

// ← 201 {
//   "order": Order,          // totalAmount computed server-side from DB prices — never trust client
//   "waDeepLink": "https://wa.me/6281234567890?text=Halo%20..."
// }
```
`waDeepLink` built server-side (store's WhatsApp number + order summary text) so the frontend success state just renders it.
Errors: `400 VALIDATION` (name/phone/items required) · `400 PRODUCT_UNAVAILABLE` · `429 RATE_LIMITED`

### `GET .../orders?status=pending&limit=50&offset=0`
```json
// ← 200 { "orders": Order[], "counts": { "all": 5, "pending": 2, "contacted": 1, "completed": 2 } }
```
The `counts` object powers the filter tabs — one round-trip.

### `PATCH .../orders/:id` — status flow
```json
// → { "status": "contacted" }   // pending→contacted→completed only; no skipping back
// ← 200 { "order": Order }
```
Errors: `400 INVALID_STATUS_TRANSITION`

### `GET .../orders/export`
```http
← 200 text/csv
  Content-Disposition: attachment; filename="tokko-orders-{storeId}.csv"
```
Columns: `customer,phone,items,total,status,date` (matches current frontend export format).

`Order`:
```ts
{ id, storeId, customerName, customerPhone,
  items: [{ productId, productName, quantity, unitPrice }],  // snapshot — survives product edits
  totalAmount, status, notes: string | null, createdAt, updatedAt }
```

---

## 6. Uploads — product images + hero image

| Method | Path | Auth |
|--------|------|------|
| POST | `/api/stores/:storeId/upload` | ✓ owner |
| GET | `/api/images/:key` | public |

### `POST .../upload` — `multipart/form-data`
```
field "file": JPG/PNG, max 2MB, magic-byte validated
field "purpose": "product" | "hero"
```
```json
// ← 201 { "key": "stores/store_001/abc123.jpg", "url": "https://api.tokko.com/api/images/stores/store_001/abc123.jpg" }
```
Errors: `400 FILE_TOO_LARGE` · `400 INVALID_FILE_TYPE`

### `GET /api/images/:key`
Streams from R2. `Cache-Control: public, max-age=31536000, immutable` (keys are unique per upload).

---

## Summary — build priority

| Phase | Endpoints | Unblocks |
|-------|-----------|----------|
| **P0** | auth (4) + `generate` + `stores/me` + `by-subdomain` | Full journey: register → quiz → generate → live store |
| **P1** | products CRUD + orders (submit/list/patch) | Selling works end-to-end |
| **P2** | page sections + publish/unpublish + check-subdomain | Editor + go-live control |
| **P3** | upload + images + export + regenerate + AI description | Polish |

**23 endpoints total.** All response shapes already match the frontend's TypeScript interfaces in `app/lib/mock-data.ts` — if your serializers match these, wiring = replacing mock imports with `fetch` calls.
