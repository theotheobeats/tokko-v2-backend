/**
 * Seed demo stores (landing-page templates) — generates idempotent SQL.
 *
 *   npx tsx scripts/seed-demo-stores.ts > /tmp/seed-demo.sql
 *   wrangler d1 execute tokko-db --local  --file /tmp/seed-demo.sql
 *   wrangler d1 execute tokko-db --remote --file /tmp/seed-demo.sql
 *
 * All demo entity ids use the "demo-" prefix so re-runs wipe + recreate
 * cleanly. Products use verified Unsplash stock photos (real product photos,
 * not placeholders). The stores are fully published storefronts.
 */

const u = (id: string) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=800&q=70`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sql = (strings: TemplateStringsArray, ...values: unknown[]): string =>
  strings.reduce((acc, str, i) => acc + str + (i < values.length ? String(values[i]) : ""), "");
function esc(v: string): string {
  return v.replace(/'/g, "''");
}
function json(v: unknown): string {
  return esc(JSON.stringify(v));
}

interface DemoProduct {
  id: string;
  name: string;
  desc: string;
  price: number;
  sale?: number;
  image: string;
  category: string;
  stock?: number;
  weight?: number;
  variants?: { name: string; price?: number }[];
}

interface DemoStore {
  id: string;
  ownerId: string;
  name: string;
  subdomain: string;
  businessType: "food" | "fashion" | "gift" | "beauty";
  aesthetic: "minimal" | "warm" | "bold";
  desc: string;
  whatsapp: string;
  accent: string;
  /** Background tint (near-white paper for warm stores, pure white for fashion). */
  bg?: string;
  fontStyle: string;
  /** Hero slideshow photos (editorial mode — image only, no text overlay). */
  heroSlides: string[];
  hero: { eyebrow: string; title: string; subtitle: string; ctaText: string };
  categories: { name: string; slug: string }[];
  products: DemoProduct[];
  testimonial: { quote: string; name: string; role: string };
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

const stores: DemoStore[] = [
  {
    id: "demo-store-dapur", ownerId: "demo-user-dapur", name: "Dapur", subdomain: "dapur",
    businessType: "food", aesthetic: "warm",
    desc: "Roti artisan, kue custom & cookies — dipanggang setiap pagi dengan bahan pilihan.",
    whatsapp: "081234567890", accent: "#b45309", bg: "#faf8f5", fontStyle: "classic-book",
    heroSlides: [u("photo-1509440159596-0249088772ff", 1400), u("photo-1555507036-ab1f4038808a", 1400)],
    hero: { eyebrow: "✦ Fresh dari oven", title: "Roti & Kue Artisan", subtitle: "Sourdough, croissant, dan kue custom yang dipanggang setiap pagi dengan bahan pilihan. Pesan sebelum jam 3 sore untuk pengiriman hari yang sama.", ctaText: "Lihat Menu" },
    categories: [
      { name: "Roti Artisan", slug: "roti-artisan" },
      { name: "Cookies", slug: "cookies" },
      { name: "Pastry", slug: "pastry" },
      { name: "Kue & Cake", slug: "kue-cake" },
    ],
    products: [
      { id: "demo-prod-dapur-1", name: "Sourdough Klasik", desc: "Roti sourdough fermentasi 24 jam — kulit renyah, dalam lembut.", price: 45000, image: u("photo-1509440159596-0249088772ff"), category: "roti-artisan", stock: 12, weight: 600 },
      { id: "demo-prod-dapur-2", name: "Croissant Butter", desc: "Croissant 27 lapis dengan butter Prancis asli.", price: 22000, image: u("photo-1555507036-ab1f4038808a"), category: "pastry", stock: 20, weight: 120 },
      { id: "demo-prod-dapur-3", name: "Choco Chip Cookies", desc: "Cookies kenyal dengan dark chocolate 64%.", price: 55000, sale: 45000, image: u("photo-1558961363-fa8fdf82db35"), category: "cookies", stock: 30, weight: 300 },
      { id: "demo-prod-dapur-4", name: "Donat Gula Klasik", desc: "Donat lembut taburan gula halus — 6 pcs.", price: 38000, image: u("photo-1486427944299-d1955d23e34d"), category: "roti-artisan", stock: 15, weight: 400 },
      { id: "demo-prod-dapur-5", name: "Cake Cokelat Premium", desc: "Moist chocolate cake dengan ganache — 20cm.", price: 285000, image: u("photo-1578985545062-69928b1d9587"), category: "kue-cake", stock: 5, weight: 1200 },
      { id: "demo-prod-dapur-6", name: "Macaron Box (6 pcs)", desc: "Macaron beragam rasa — pilih isi favoritmu.", price: 75000, image: u("photo-1587668178277-295251f900ce"), category: "kue-cake", stock: 10, weight: 250, variants: [{ name: "Merah Muda" }, { name: "Pistachio", price: 80000 }, { name: "Cokelat" }] },
      { id: "demo-prod-dapur-7", name: "Pancake Madu", desc: "Pancake fluffy dengan madu asli & mentega.", price: 42000, image: u("photo-1548369937-47519962c11a"), category: "kue-cake", stock: 8, weight: 350 },
      { id: "demo-prod-dapur-8", name: "Dessert Strawberry", desc: "Dessert segar dengan strawberry premium.", price: 48000, image: u("photo-1565958011703-44f9829ba187"), category: "kue-cake", stock: 6, weight: 300 },
      { id: "demo-prod-dapur-9", name: "Cupcake Vanilla", desc: "Cupcake vanilla dengan buttercream — 4 pcs.", price: 45000, image: u("photo-1519869325930-281384150729"), category: "kue-cake", stock: 18, weight: 280 },
      { id: "demo-prod-dapur-10", name: "Brownies Fudgy", desc: "Brownies fudgy padat, cokelat pekat.", price: 48000, sale: 39000, image: u("photo-1606313564200-e75d5e30476c"), category: "cookies", stock: 14, weight: 320 },
    ],
    testimonial: { quote: "Sourdough-nya juara! Kirim ke rumah masih renyah. Sekarang langganan tiap minggu.", name: "Sari", role: "Pelanggan setia" },
  },
  {
    id: "demo-store-kopikita", ownerId: "demo-user-kopikita", name: "Kopi Kita", subdomain: "kopikita",
    businessType: "food", aesthetic: "minimal",
    desc: "Kedai kopi & minuman segar — seduh sendiri di rumah dengan biji pilihan.",
    whatsapp: "081298765432", accent: "#44403c", bg: "#faf9f7", fontStyle: "mixed-warm",
    heroSlides: [u("photo-1509042239860-f550ce710b93", 1400), u("photo-1447933601403-0c6688de566e", 1400)],
    hero: { eyebrow: "✦ Seduh segar setiap hari", title: "Kopi Kita", subtitle: "Biji pilihan, seduhan manual, dan minuman segar untuk menemani harimu. Antar cepat di area Bandung.", ctaText: "Pesan Kopi" },
    categories: [
      { name: "Kopi", slug: "kopi" },
      { name: "Non-Kopi", slug: "non-kopi" },
      { name: "Biji Kopi", slug: "biji-kopi" },
    ],
    products: [
      { id: "demo-prod-kopi-1", name: "Kopi Susu Gula Aren", desc: "Espresso + susu segar + gula aren asli.", price: 22000, sale: 19000, image: u("photo-1509042239860-f550ce710b93"), category: "kopi", stock: 50, weight: 350 },
      { id: "demo-prod-kopi-2", name: "Cappuccino", desc: "Klasik — espresso, susu, foam tebal.", price: 25000, image: u("photo-1572442388796-11668a67e53d"), category: "kopi", stock: 50, weight: 350 },
      { id: "demo-prod-kopi-3", name: "Es Teh Lemon", desc: "Teh hitam segar dengan perasan lemon.", price: 15000, image: u("photo-1556679343-c7306c1976bc"), category: "non-kopi", stock: 60, weight: 350 },
      { id: "demo-prod-kopi-4", name: "Iced Tea", desc: "Es teh melati manis pas — segar.", price: 14000, image: u("photo-1544787219-7f47ccb76574"), category: "non-kopi", stock: 60, weight: 350 },
      { id: "demo-prod-kopi-5", name: "Biji Kopi 250g", desc: "Single origin Sumatra — sangrai medium.", price: 65000, image: u("photo-1447933601403-0c6688de566e"), category: "biji-kopi", stock: 20, weight: 250 },
      { id: "demo-prod-kopi-6", name: "Smoothie Bowl", desc: "Buah segar, granola, dan madu.", price: 35000, image: u("photo-1558857563-b371033873b8"), category: "non-kopi", stock: 15, weight: 400 },
      { id: "demo-prod-kopi-7", name: "Salad Bowl", desc: "Sayur segar + protein pilihan — lunch sehat.", price: 32000, image: u("photo-1546069901-ba9599a7e63c"), category: "non-kopi", stock: 12, weight: 350 },
    ],
    testimonial: { quote: "Kopi susu gula arennya pas banget, gak terlalu manis. Pengiriman cepat!", name: "Dimas", role: "Pelanggan" },
  },
  {
    id: "demo-store-glowskin", ownerId: "demo-user-glowskin", name: "Glow Skin", subdomain: "glowskin",
    businessType: "beauty", aesthetic: "minimal",
    desc: "Skincare lokal dengan bahan aktif terbukti — aman untuk semua jenis kulit.",
    whatsapp: "081234561111", accent: "#1a1a1a", bg: "#fbfbfa", fontStyle: "editorial-luxe",
    heroSlides: [u("photo-1620916566398-39f1143ab7be", 1400), u("photo-1556228720-195a672e8a03", 1400)],
    hero: { eyebrow: "✦ Glow dari dalam", title: "Skincare Routine", subtitle: "Rangkaian skincare lokal dengan bahan aktif terbukti — bersih, lembut, dan cerah untuk semua jenis kulit.", ctaText: "Lihat Koleksi" },
    categories: [
      { name: "Skincare", slug: "skincare" },
      { name: "Makeup", slug: "makeup" },
      { name: "Body Care", slug: "body-care" },
    ],
    products: [
      { id: "demo-prod-glow-1", name: "Facial Serum Niacinamide", desc: "Serum 10% niacinamide + zinc — kontrol minyak & pori.", price: 120000, sale: 99000, image: u("photo-1570172619644-dfd03ed5d881"), category: "skincare", stock: 40, weight: 120 },
      { id: "demo-prod-glow-2", name: "Moisturizer Ceramide", desc: "Pelembap ringan dengan ceramide + hyaluronic acid.", price: 95000, image: u("photo-1556228720-195a672e8a03"), category: "skincare", stock: 45, weight: 130 },
      { id: "demo-prod-glow-3", name: "Sunscreen SPF 50+", desc: "Tabir surya ringan, no white cast, waterproof.", price: 110000, image: u("photo-1608248543803-ba4f8c70ae0b"), category: "skincare", stock: 50, weight: 100 },
      { id: "demo-prod-glow-4", name: "Gentle Cleanser", desc: "Pembersih wajah pH-balanced untuk kulit sensitif.", price: 85000, image: u("photo-1556228578-8c89e6adf883"), category: "skincare", stock: 40, weight: 150 },
      { id: "demo-prod-glow-5", name: "Lip Tint Velvet", desc: "Lip tint tahan lama — hasil matte velvet.", price: 45000, image: u("photo-1522335789203-aabd1fc54bc9"), category: "makeup", stock: 60, weight: 30, variants: [{ name: "Nude" }, { name: "Red", price: 47000 }, { name: "Coral" }] },
      { id: "demo-prod-glow-6", name: "Night Cream Retinol", desc: "Krim malam dengan retinol 0.3% — haluskan tekstur.", price: 135000, image: u("photo-1563729784474-d77dbb933a9e"), category: "skincare", stock: 25, weight: 140 },
      { id: "demo-prod-glow-7", name: "Toner Pore Refining", desc: "Toner penyegar dengan witch hazel.", price: 70000, image: u("photo-1596755389378-c31d21fd1273"), category: "skincare", stock: 35, weight: 160 },
    ],
    testimonial: { quote: "Jerawatan mulai mereda setelah 2 minggu pakai serumnya. Bahan lokal yang beneran works!", name: "Rani", role: "Pengguna Glow" },
  },
  {
    id: "demo-store-rumahmode", ownerId: "demo-user-rumahmode", name: "Rumah Mode", subdomain: "rumahmode",
    businessType: "fashion", aesthetic: "bold",
    desc: "Fashion lokal — pakaian, aksesoris, dan alas kaki dengan kualitas premium.",
    whatsapp: "081234562222", accent: "#111111", bg: "#ffffff", fontStyle: "modern-sans",
    heroSlides: [u("photo-1445205170230-053b83016050", 1400), u("photo-1469334031218-e382a71b716b", 1400)],
    hero: { eyebrow: "✦ New season", title: "Rumah Mode", subtitle: "Koleksi terbaru — pakaian, tas, dan alas kaki untuk gaya harianmu. Ukuran lengkap, stok terbatas.", ctaText: "Belanja Sekarang" },
    categories: [
      { name: "Atasan", slug: "atasan" },
      { name: "Bawahan", slug: "bawahan" },
      { name: "Aksesoris", slug: "aksesoris" },
      { name: "Alas Kaki", slug: "alas-kaki" },
    ],
    products: [
      { id: "demo-prod-mode-1", name: "Kemeja Oversize Linen", desc: "Kemeja linen premium — adem & jatuh.", price: 149000, image: u("photo-1521572163474-6864f9cf17ab"), category: "atasan", stock: 30, weight: 300, variants: [{ name: "S" }, { name: "M" }, { name: "L" }, { name: "XL" }] },
      { id: "demo-prod-mode-2", name: "Sneakers White", desc: "Sneakers kulit sintetis — nyaman seharian.", price: 399000, image: u("photo-1542291026-7eec264c27ff"), category: "alas-kaki", stock: 20, weight: 900, variants: [{ name: "39" }, { name: "40" }, { name: "41" }, { name: "42" }] },
      { id: "demo-prod-mode-3", name: "Tote Bag Kulit", desc: "Tote kulit asli — muat laptop 14 inch.", price: 285000, image: u("photo-1584917865442-de89df76afd3"), category: "aksesoris", stock: 10, weight: 800 },
      { id: "demo-prod-mode-4", name: "Jaket Denim", desc: "Jaket denim klasik — bahan tebal tidak kaku.", price: 329000, sale: 289000, image: u("photo-1591047139829-d91aecb6caea"), category: "atasan", stock: 12, weight: 1100, variants: [{ name: "M" }, { name: "L" }, { name: "XL" }] },
      { id: "demo-prod-mode-5", name: "Jam Tangan Minimalis", desc: "Jam kuarsa dengan strap kulit — elegan.", price: 499000, image: u("photo-1523170335258-f5ed11844a49"), category: "aksesoris", stock: 8, weight: 150 },
      { id: "demo-prod-mode-6", name: "Kaos Polos Premium", desc: "Kaos 24s katun combed — tidak menerawang.", price: 79000, image: u("photo-1576566588028-4147f3842f27"), category: "atasan", stock: 50, weight: 180, variants: [{ name: "Putih" }, { name: "Hitam" }, { name: "Abu" }, { name: "Navy" }] },
      { id: "demo-prod-mode-7", name: "Rok Plisket", desc: "Rok plisket midi — ringan dan flowy.", price: 129000, image: u("photo-1515372039744-b8f02a3ae446"), category: "bawahan", stock: 18, weight: 350, variants: [{ name: "S" }, { name: "M" }, { name: "L" }] },
      { id: "demo-prod-mode-8", name: "Trench Coat", desc: "Trench coat klasik — bahan waterproof.", price: 599000, image: u("photo-1541099649105-f69ad21f3246"), category: "atasan", stock: 6, weight: 1400, variants: [{ name: "M" }, { name: "L" }] },
    ],
    testimonial: { quote: "Kualitasnya setara brand import, harga lokal. Kemeja linennya jadi andalan kerja.", name: "Ayu", role: "Pelanggan" },
  },
];

// ---------------------------------------------------------------------------
// SQL generation
// ---------------------------------------------------------------------------

const out: string[] = [];

// Wipe previous demo rows (idempotent).
out.push(sql`
DELETE FROM product_variants WHERE product_id LIKE 'demo-%';
DELETE FROM products WHERE id LIKE 'demo-%';
DELETE FROM product_categories WHERE id LIKE 'demo-%';
DELETE FROM sections WHERE id LIKE 'demo-%';
DELETE FROM pages WHERE id LIKE 'demo-%';
DELETE FROM stores WHERE id LIKE 'demo-%';
DELETE FROM user WHERE id LIKE 'demo-%';
`);

// Editorial-monochrome tokens — matches the landing-page template previews
// (navbar-editorial + hero slideshow editorial + bestseller carousel).
const designTokens = (accent: string, fontStyle: string, bg: string) => ({
  accent,
  bg,
  cardBg: "#ffffff",
  text: "#111111",
  textSecondary: "#737373",
  ctaText: "#ffffff",
  borderRadius: "0px",
  buttonRadius: "0px",
  fontStyle,
  spacing: "comfortable",
  elevation: "flat",
  decorDensity: "minimal",
  layoutStyle: "editorial",
  navbarStyle: "navbar-editorial",
});

for (const s of stores) {
  // Owner user
  out.push(sql`INSERT INTO user (id, name, email, email_verified, role, banned, created_at, updated_at)
VALUES ('${s.ownerId}', '${esc(s.name)}', '${s.ownerId}@7okko-demo.local', 1, 'user', 0, datetime('now'), datetime('now'));`);

  // Store (published)
  out.push(sql`INSERT INTO stores (id, owner_id, name, subdomain, description, business_type, aesthetic_preference, whatsapp_number, status, hero_image_url, design_tokens, origin_address, origin_postal_code, origin_contact_name, origin_contact_phone, origin_latitude, origin_longitude, created_at, updated_at)
VALUES ('${s.id}', '${s.ownerId}', '${esc(s.name)}', '${s.subdomain}', '${esc(s.desc)}', '${s.businessType}', '${s.aesthetic}', '${s.whatsapp}', 'published', NULL, '${json(designTokens(s.accent, s.fontStyle, s.bg ?? "#ffffff"))}', 'Jl. Merdeka No. 1', '40111', '${esc(s.name)}', '${s.whatsapp}', -6.9175, 107.6191, datetime('now'), datetime('now'));`);

  // Categories
  s.categories.forEach((c, i) => {
    out.push(sql`INSERT INTO product_categories (id, store_id, name, slug, created_at)
VALUES ('${s.id}-cat-${i + 1}', '${s.id}', '${esc(c.name)}', '${c.slug}', datetime('now'));`);
  });

  // Products + variants
  s.products.forEach((p, i) => {
    out.push(sql`INSERT INTO products (id, store_id, name, description, price, image_url, images, sale_price, slug, category_id, stock, weight, is_available, type, created_at, updated_at)
VALUES ('${p.id}', '${s.id}', '${esc(p.name)}', '${esc(p.desc)}', ${p.price}, '${p.image}', '${json([p.image])}', ${p.sale ?? "NULL"}, '${s.subdomain}-${p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}', '${s.id}-cat-${s.categories.findIndex((c) => c.slug === p.category) + 1}', ${p.stock ?? "NULL"}, ${p.weight ?? 250}, 1, 'product', datetime('now'), datetime('now'));`);
    (p.variants ?? []).forEach((v, vi) => {
      out.push(sql`INSERT INTO product_variants (id, product_id, name, price, sort_order, created_at)
VALUES ('${p.id}-var-${vi + 1}', '${p.id}', '${esc(v.name)}', ${v.price ?? "NULL"}, ${vi}, datetime('now'));`);
    });
  });

  // Home page
  const pageId = `${s.id}-home`;
  out.push(sql`INSERT INTO pages (id, store_id, slug, title, design_tokens, created_at, updated_at)
VALUES ('${pageId}', '${s.id}', 'beranda', 'Beranda', NULL, datetime('now'), datetime('now'));`);

  const sections: { type: string; content: Record<string, unknown> }[] = [
    { type: "hero", content: { blockId: "hero-slideshow", style: "editorial", slides: s.heroSlides.map((image) => ({ image, title: "", link: "" })) } },
    { type: "product-grid", content: { blockId: "product-grid-carousel-row", eyebrow: "Koleksi", heading: "Product Bestseller", browseAllText: "Browse All", variantLabel: "Warna" } },
    { type: "testimonial", content: { blockId: "testimonial-shadcn-cards", eyebrow: "Testimoni", heading: "Apa Kata Mereka", items: [{ quote: s.testimonial.quote, name: s.testimonial.name, role: s.testimonial.role }] } },
    { type: "cta", content: { blockId: "cta-shadcn-band", heading: "Siap Pesan?", subtitle: "Pesan sekarang — konfirmasi cepat via WhatsApp.", ctaText: "Order Sekarang" } },
    { type: "footer", content: { blockId: "footer-storeku", heading: s.name, tagline: s.desc, copyright: `© 2026 ${s.name}`, madeWithText: "Dibuat dengan 7okko", columns: [{ title: "Menu", links: [{ label: "Semua Produk", href: "/koleksi" }, { label: "Kontak", href: "#kontak" }] }], links: [{ label: "Koleksi", href: "/koleksi" }] } },
  ];

  sections.forEach((sec, i) => {
    const data = { variant: "default", content: sec.content };
    out.push(sql`INSERT INTO sections (id, page_id, type, data, sort_order)
VALUES ('${pageId}-sec-${i + 1}', '${pageId}', '${sec.type}', '${json(data)}', ${i});`);
  });
}

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

console.log(out.join("\n"));
