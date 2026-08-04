# Tokko API Contract — Frontend Integration Guide

> **Status:** Backend verified & running. All endpoints tested against local D1.
> **Base URL:** `http://localhost:8787` (dev) · `https://api.tokko.com` (prod)

---

## 1. Conventions

### Auth
All auth uses **HttpOnly session cookies** set by the server. No Authorization header needed.

```
Set-Cookie: better-auth.session_token=xxx; HttpOnly; SameSite=Lax; Path=/
```

The browser sends this cookie automatically. For cross-origin (localhost:3000 → localhost:8787), use `credentials: "include"` in fetch.

```ts
fetch("http://localhost:8787/api/stores/me", { credentials: "include" })
```

### Content Type
`application/json` everywhere except uploads (`multipart/form-data`).

### Error shape (every endpoint)
```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable Bahasa Indonesia message"
  }
}
```

### HTTP status codes
| Status | Meaning |
|--------|---------|
| 200 | Success |
| 201 | Created |
| 400 | Validation error |
| 401 | Not authenticated |
| 403 | Not authorized (not owner) |
| 404 | Not found |
| 409 | Conflict (email taken, subdomain taken) |
| 422 | AI generation failed |

---

## 2. Shared Types

```ts
// ID: UUID v4 string
type ID = string;

// Money: integer Rupiah (not cents). e.g. 85000 = Rp 85.000
type Rupiah = number;

type StoreStatus = "draft" | "published";
type OrderStatus = "pending" | "contacted" | "completed";
type ProductType = "product" | "service" | "booking";
type Aesthetic = "minimal" | "warm" | "bold";
type BusinessType = "food" | "fashion" | "gift" | "beauty" | "craft" | "gadget" | "home" | "service";
type SectionType = "hero" | "about" | "product-grid" | "testimonial" | "cta" | "contact" | "faq";

interface User {
  id: ID;
  name: string;
  email: string;
}

interface Store {
  id: ID;
  name: string;
  subdomain: string;
  description: string | null;
  businessType: BusinessType;
  aestheticPreference: Aesthetic;
  whatsappNumber: string;
  status: StoreStatus;
  heroImageUrl: string | null;
}

interface Product {
  id: ID;
  storeId: ID;
  name: string;
  description: string | null;
  price: Rupiah;
  imageUrl: string | null;
  isAvailable: boolean;
  type: ProductType; // determines checkout + fulfillment flow
}

interface OrderItem {
  productId: ID;
  productName: string;
  quantity: number;
  unitPrice: Rupiah;
  productType: ProductType; // snapshot of the product kind at order time
}

interface Order {
  id: ID;
  storeId: ID;
  orderCode: string; // human-friendly ref, e.g. "TK-8F3K2"
  customerName: string;
  customerPhone: string;
  items: OrderItem[];
  totalAmount: Rupiah;
  status: OrderStatus;
  notes: string | null;
  shippingAddress: string | null; // required for product orders
  trackingNumber: string | null; // nomor resi — filled by admin (product)
  courier: string | null; // jasa kirim — filled by admin (product)
  paymentConfirmed: boolean; // filled by admin (service)
  paymentNote: string | null; // filled by admin (service)
  queueNumber: string | null; // nomor antrian — filled by admin (booking)
  createdAt: string; // ISO 8601
}

interface Section {
  id: ID;
  type: SectionType;
  sortOrder: number;
  data: SectionData; // varies by type, see §7
}
```

---

## 3. Auth Endpoints

### `POST /api/auth/register`
Create account. Sets session cookie.

**Request:**
```json
{
  "name": "Anna Wijaya",
  "email": "anna@mail.com",
  "password": "min8chars"
}
```

**Response `201`:**
```json
{
  "user": { "id": "...", "name": "Anna Wijaya", "email": "anna@mail.com" }
}
```

**Errors:** `409 EMAIL_TAKEN` · `400 VALIDATION`

---

### `POST /api/auth/login`
Sign in. Sets session cookie.

**Request:**
```json
{
  "email": "anna@mail.com",
  "password": "min8chars"
}
```

**Response `200`:**
```json
{
  "user": { "id": "...", "name": "Anna Wijaya", "email": "anna@mail.com" },
  "store": { "id": "...", "name": "Anna's Bakery", "subdomain": "annas-bakery", "status": "draft" }
}
```
`store` is `null` if user has no store yet → redirect to `/onboarding`.

**Errors:** `401 INVALID_CREDENTIALS`

---

### `POST /api/auth/logout`
Clears session cookie.

**Response `200`:**
```json
{ "success": true }
```

---

### `GET /api/auth/me`
Returns current session. Used as route guard.

**Response `200`:**
```json
{
  "user": { "id": "...", "name": "Anna", "email": "anna@mail.com" },
  "store": { "id": "...", "name": "...", "subdomain": "...", "status": "draft" }
}
```
`store` is `null` if no store exists. Returns `401` if not logged in.

---

## 4. Store Endpoints

### `GET /api/stores/check-subdomain?name=Anna's Bakery`
Live subdomain availability check during onboarding.

**Response `200`:**
```json
{ "subdomain": "annas-bakery", "available": true }
```

---

### `POST /api/stores/generate`
**Requires auth.** AI-generates store from quiz answers. Creates store + page + 5 sample products.

**Request:**
```json
{
  "businessName": "Anna's Bakery",
  "businessType": "food",
  "productCategory": "kue ulang tahun custom",
  "aesthetic": "warm",
  "whatsappNumber": "+6281234567890"
}
```

**Response `201`:**
```json
{
  "store": { /* Store object, status: "draft" */ },
  "page": {
    "id": "...",
    "storeId": "...",
    "sections": [ /* 6-7 Section objects, see §7 */ ]
  },
  "products": [ /* 5 Product objects */ ]
}
```

**Errors:** `409 SUBDOMAIN_TAKEN` · `422 AI_GENERATION_FAILED`

---

### `GET /api/stores/me`
**Requires auth.** Returns current user's store.

**Response `200`:**
```json
{ "store": { /* Store object */ } }
```
`store` is `null` if none.

---

### `PATCH /api/stores/:id`
**Requires auth, owner only.** Update store details.

**Request (partial):**
```json
{
  "name": "New Name",
  "description": "Updated description",
  "whatsappNumber": "+628999",
  "heroImageUrl": "stores/abc/hero.jpg"
}
```

**Response `200`:**
```json
{ "store": { /* updated Store */ } }
```

**Errors:** `404 NOT_FOUND` · `403 FORBIDDEN`

---

### `POST /api/stores/:id/publish`
**Requires auth, owner only.** Publish store. Requires ≥1 product.

**Response `200`:**
```json
{ "store": { "id": "...", "name": "...", "subdomain": "...", "status": "published" } }
```

**Errors:** `400 STORE_HAS_NO_PRODUCTS` · `404 NOT_FOUND`

---

### `POST /api/stores/:id/unpublish`
**Requires auth, owner only.** Unpublish store.

**Response `200`:**
```json
{ "store": { "id": "...", "name": "...", "subdomain": "...", "status": "draft" } }
```

---

### `GET /api/stores/by-subdomain?subdomain=annas-bakery`
**Public.** Returns published store with sections and products. Hot path — used by store pages.

**Response `200`:**
```json
{
  "store": { /* Store object */ },
  "sections": [ /* Section[] */ ],
  "products": [ /* Product[] */ ]
}
```

**Errors:** `404 STORE_NOT_FOUND` · `404 STORE_NOT_PUBLISHED` (drafts are hidden)

---

## 5. Product Endpoints

All under `/api/stores/:storeId/products`.

### `POST /api/stores/:storeId/products`
**Requires auth, owner only.** Create product. Max 20 per store.

**Request:**
```json
{
  "name": "Rainbow Cake",
  "price": 85000,
  "description": "Optional description",
  "imageUrl": "stores/abc/cake.jpg",
  "type": "product"
}
```

`type` is optional, defaults to `"product"`. One of `"product" | "service" | "booking"`.

**Response `201`:**
```json
{ "product": { /* Product object */ } }
```

**Errors:** `400 PRODUCT_LIMIT_REACHED` · `400 VALIDATION`

---

### `GET /api/stores/:storeId/products`
Public if store is published. Auth required for draft stores (owner only).

**Response `200`:**
```json
[ /* Product[] */ ]
```

---

### `PATCH /api/stores/:storeId/products/:id`
**Requires auth, owner only.** Partial update. Send only changed fields.

**Request:**
```json
{
  "name": "New Name",
  "price": 99999,
  "isAvailable": false,
  "description": null,
  "imageUrl": "new.jpg"
}
```

**Response `200`:**
```json
{ "product": { /* updated Product */ } }
```

**Errors:** `404 NOT_FOUND`

---

### `DELETE /api/stores/:storeId/products/:id`
**Requires auth, owner only.**

**Response `200`:**
```json
{ "success": true }
```

---

### `POST /api/stores/:storeId/products/generate-description`
**Requires auth, owner only.** AI-generates product description.

**Request:**
```json
{
  "name": "Rainbow Cake",
  "category": "kue"
}
```

**Response `200`:**
```json
{ "description": "Rainbow Cake adalah produk kue berkualitas premium..." }
```

**Errors:** `422 AI_GENERATION_FAILED`

---

## 6. Order Endpoints

All under `/api/stores/:storeId/orders`.

### `POST /api/stores/:storeId/orders`
**Public.** Submit order. Prices computed server-side from DB — never trust client.

**Request:**
```json
{
  "customerName": "Rina Susanti",
  "customerPhone": "+628111222333",
  "items": [
    { "productId": "prod_uuid", "quantity": 2 }
  ],
  "shippingAddress": "Jl. Merdeka No. 1, Jakarta 10110",
  "notes": "Tolong bungkus kado"
}
```

`shippingAddress` is **required** when the order contains a physical product (`type: "product"`); ignored otherwise.

**Response `201`:**
```json
{
  "order": { /* Order object, status: "pending", includes orderCode */ },
  "waDeepLink": "https://wa.me/6281234567890?text=Halo%20..."
}
```
`waDeepLink` is a pre-built WhatsApp URL to the store owner (includes orderCode + shipping address). Frontend renders it as a success action button, and shows the `orderCode` as the customer's reference.

**Errors:** `400 VALIDATION` (incl. missing shippingAddress) · `400 PRODUCT_UNAVAILABLE`

---

### `GET /api/stores/:storeId/orders`
**Requires auth, owner only.** List orders with filter tabs.

**Query params:** `?status=pending&limit=50&offset=0`

**Response `200`:**
```json
{
  "orders": [ /* Order[] */ ],
  "counts": {
    "all": 5,
    "pending": 2,
    "contacted": 1,
    "completed": 2
  }
}
```
`counts` powers filter tab badges.

---

### `PATCH /api/stores/:storeId/orders/:id`
**Requires auth, owner only.** Advance order status.

**Request:**
```json
{ "status": "contacted" }
```

**Valid transitions:** `pending → contacted → completed`. Cannot skip or go backward.

**Completion gate:** transitioning to `completed` is rejected unless the order's fulfillment data is present, per the ordered item's type:
- `product` → `trackingNumber` (nomor resi) must be set
- `service` → `paymentConfirmed` must be true
- `booking` → `queueNumber` must be set

**Response `200`:**
```json
{ "order": { /* updated Order */ } }
```

**Errors:** `400 INVALID_STATUS_TRANSITION` · `400 FULFILLMENT_INCOMPLETE` · `404 NOT_FOUND`

---

### `PUT /api/stores/:storeId/orders/:id/fulfillment`
**Requires auth, owner only.** Attach fulfillment data (resi / payment confirmation / queue number) and get a WhatsApp deep link to notify the customer.

**Request** (all fields optional — send only what applies to this order):
```json
{
  "trackingNumber": "JNE123456",
  "courier": "JNE",
  "paymentConfirmed": true,
  "paymentNote": "BCA a.n. Anna",
  "queueNumber": "A-001"
}
```

**Response `200`:**
```json
{
  "order": { /* updated Order with fulfillment fields */ },
  "waDeepLink": "https://wa.me/62811...?text=Halo%20Rina!%20Pesanan%20TK-8F3K2%20kamu..."
}
```
`waDeepLink` is pre-filled with the confirmation message for the customer (resi / payment confirmed / queue number).

**Errors:** `400 VALIDATION` · `404 NOT_FOUND`

---

### `GET /api/stores/:storeId/orders/export`
**Requires auth, owner only.** Download CSV.

**Response `200`:** `text/csv` with `Content-Disposition: attachment`.

CSV columns: `orderCode,customer,phone,shippingAddress,items,total,status,trackingNumber,courier,paymentConfirmed,queueNumber,date`

---

## 7. Page / Section Endpoints

All under `/api/stores/:storeId/page`.

### `GET /api/stores/:storeId/page`
Public if store is published. Auth required for drafts (owner only).

**Response `200`:**
```json
{
  "id": "page_uuid",
  "storeId": "store_uuid",
  "sections": [
    {
      "id": "sec_uuid",
      "type": "hero",
      "sortOrder": 0,
      "data": { "title": "Welcome", "subtitle": "...", "ctaText": "Pesan" }
    }
  ]
}
```
Returns `null` if no page exists.

---

### `PATCH /api/stores/:storeId/page/sections/:id`
**Requires auth, owner only.** Update section data (inline text edit, debounced save).

**Request:**
```json
{
  "data": {
    "title": "Updated Title",
    "subtitle": "New subtitle",
    "ctaText": "New CTA"
  }
}
```

**Response `200`:**
```json
{ "section": { /* updated Section */ } }
```

---

### `POST /api/stores/:storeId/page/sections`
**Requires auth, owner only.** Add new section.

**Request:**
```json
{
  "type": "faq",
  "data": { "heading": "FAQ", "items": [{ "question": "Q?", "answer": "A." }] },
  "sortOrder": 3
}
```

**Response `201`:**
```json
{ "section": { /* new Section */ } }
```

---

### `DELETE /api/stores/:storeId/page/sections/:id`
**Requires auth, owner only.** Remove section.

**Response `200`:**
```json
{
  "sections": [ /* remaining Section[] */ ]
}
```

---

### `PATCH /api/stores/:storeId/page/reorder`
**Requires auth, owner only.** Reorder all sections.

**Request:**
```json
{
  "sectionIds": ["sec_003", "sec_001", "sec_002"]
}
```

**Response `200`:**
```json
{
  "sections": [ /* reordered Section[] */ ]
}
```

---

### `POST /api/stores/:storeId/page/regenerate`
**Requires auth, owner only.** AI regenerates all sections. Products untouched.

**Response `200`:**
```json
{
  "page": {
    "id": "...",
    "storeId": "...",
    "sections": [ /* new Section[] */ ]
  }
}
```

---

## 8. Section Data Shapes

Each section type has a specific `data` shape:

```ts
// hero
{ title: string; subtitle: string; ctaText: string }

// about
{ heading: string; text: string }

// product-grid
{ heading: string }

// testimonial
{ heading: string; items: { name: string; text: string; rating: number }[] }

// cta
{ heading: string; description: string; buttonText: string }

// contact
{ heading: string; whatsappNumber: string; address: string; hours: string }

// faq
{ heading: string; items: { question: string; answer: string }[] }
```

---

## 9. Upload Endpoints

### `POST /api/stores/:storeId/upload`
**Requires auth, owner only.** Upload image (JPG/PNG/WebP, max 2MB).

**Request:** `multipart/form-data`
| Field | Type | Description |
|-------|------|-------------|
| `file` | File | Image file |
| `purpose` | string | `"product"` or `"hero"` |

**Response `201`:**
```json
{
  "key": "stores/store_uuid/abc123.jpg",
  "url": "http://localhost:8787/api/images/stores/store_uuid/abc123.jpg"
}
```

**Errors:** `400 FILE_TOO_LARGE` · `400 INVALID_FILE_TYPE`

---

### `GET /api/images/:key`
**Public.** Serve uploaded image from storage.

**Response:** Binary image with `Content-Type`. `Cache-Control: public, max-age=31536000, immutable`.

---

## 10. Error Codes Reference

| Code | HTTP | Meaning |
|------|------|---------|
| `VALIDATION` | 400 | Invalid input |
| `UNAUTHORIZED` | 401 | Login required |
| `INVALID_CREDENTIALS` | 401 | Wrong email/password |
| `FORBIDDEN` | 403 | Not the store owner |
| `NOT_FOUND` | 404 | Resource not found |
| `STORE_NOT_FOUND` | 404 | No store at subdomain |
| `STORE_NOT_PUBLISHED` | 404 | Store exists but is draft |
| `SECTION_NOT_FOUND` | 404 | Section ID doesn't exist on page |
| `PAGE_NOT_FOUND` | 404 | No page for store |
| `EMAIL_TAKEN` | 409 | Email already registered |
| `SUBDOMAIN_TAKEN` | 409 | Subdomain already used |
| `PRODUCT_LIMIT_REACHED` | 400 | Store has max 20 products |
| `PRODUCT_UNAVAILABLE` | 400 | Product not available or not found |
| `STORE_HAS_NO_PRODUCTS` | 400 | Cannot publish with 0 products |
| `INVALID_STATUS_TRANSITION` | 400 | Invalid order status change |
| `FILE_TOO_LARGE` | 400 | Image > 2MB |
| `INVALID_FILE_TYPE` | 400 | Not JPG/PNG/WebP |
| `AI_GENERATION_FAILED` | 422 | AI call failed (retry allowed) |

---

## 11. Quick Reference — Fetch Setup

```ts
// api.ts — base fetch wrapper for the frontend
const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error);
  }

  return res.json();
}

export class ApiError extends Error {
  constructor(public status: number, public error?: { code: string; message: string }) {
    super(error?.message ?? "Unknown error");
  }
}
```

---

## 12. Build Priority (what to wire first)

| Phase | Endpoints | Unlocks |
|-------|-----------|---------|
| **P0** | auth (4) + `generate` + `stores/me` + `by-subdomain` | Full journey: register → quiz → generate → live store |
| **P1** | products CRUD + orders (submit/list/patch) | Selling works end-to-end |
| **P2** | page sections + publish/unpublish + `check-subdomain` | Editor + go-live control |
| **P3** | upload + images + export + regenerate + AI description | Polish |

---

*Generated from running backend. Last verified: `wrangler dev` full e2e smoke test passed (Register → Me → Generate → By-Subdomain).*
