/**
 * Mock AI store generator — structured content for dev/test (no HTML, just data).
 * Emits all 8 sections and varies blockId/theme per call so "regenerate" in
 * dev produces a visibly different page instead of an identical copy.
 * Numeric/metric fields are left empty so no numbers are fabricated.
 */

import type { AIGeneratedPage } from "../../application/store/generate-store";

const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

const HERO_BLOCKS = ["hero-shadcn-centered", "hero-shadcn-minimal", "hero-premium-mesh", "hero-photo-collage", "hero-card-cluster"];
const ABOUT_BLOCKS = ["about-shadcn-centered", "about-shadcn-split", "about-coach-story", "about-soft-panel", "about-serif-manifesto"];
const TESTIMONIAL_BLOCKS = ["testimonial-shadcn-cards", "testimonial-shadcn-quote", "testimonial-big-center", "testimonial-avatar-row"];
const FOOTER_BLOCKS = ["footer-simple-centered", "footer-split-contact", "footer-social-grid", "footer-minimal-bar"];

const THEMES = [
  { accent: "#f97316", bg: "#fdfcfa", cardBg: "#ffffff", text: "#1c1917", textSecondary: "#78716c" },
  { accent: "#0ea5e9", bg: "#f8fafc", cardBg: "#ffffff", text: "#0f172a", textSecondary: "#64748b" },
  { accent: "#16a34a", bg: "#f7fee7", cardBg: "#ffffff", text: "#14532d", textSecondary: "#4d7c0f" },
  { accent: "#e11d48", bg: "#fff1f2", cardBg: "#ffffff", text: "#4c0519", textSecondary: "#9f1239" },
];

export async function mockAIGenerate(input: {
  businessName: string;
  businessType: string;
  productCategory: string;
  aesthetic: string;
}): Promise<AIGeneratedPage> {
  await new Promise((r) => setTimeout(r, 100));

  const storeName = input.businessName;
  const theme = pick(THEMES);

  return {
    sections: [
      {
        type: "hero",
        variant: "default",
        content: {
          blockId: pick(HERO_BLOCKS),
          eyebrow: "✦ " + input.productCategory,
          title: `Selamat Datang di ${storeName}`,
          subtitle: `${getTagline(input.businessType)}. Pesan sekarang via WhatsApp!`,
          ctaText: "Pesan Sekarang",
        },
      },
      {
        type: "about",
        variant: "default",
        content: {
          blockId: pick(ABOUT_BLOCKS),
          eyebrow: "✦ Tentang Kami",
          heading: "Kenapa Memilih Kami",
          body: `${storeName} hadir untuk memberikan produk ${input.productCategory} terbaik dengan kualitas premium dan harga terjangkau. Kami percaya setiap pelanggan berhak mendapatkan produk berkualitas dengan pelayanan ramah khas Indonesia.`,
          // no stats — owner fills real numbers in the editor
        },
      },
      {
        type: "product-grid",
        variant: "default",
        content: { blockId: "product-grid-shadcn-cards", eyebrow: "✦ Koleksi", heading: "Produk Unggulan Kami" },
      },
      {
        type: "testimonial",
        variant: "default",
        content: {
          blockId: pick(TESTIMONIAL_BLOCKS),
          eyebrow: "✦ Testimoni",
          heading: "Apa Kata Pelanggan",
          items: [
            { quote: `Produk ${input.productCategory}-nya bagus banget! Pasti order lagi.`, name: "Budi S.", role: "Jakarta" },
            { quote: "Pelayanannya ramah dan cepat. Recommended!", name: "Sari W.", role: "Bandung" },
          ],
        },
      },
      {
        type: "cta",
        variant: "default",
        content: {
          blockId: "cta-shadcn-band",
          heading: "Siap Pesan?",
          subtitle: `Dapatkan produk ${input.productCategory} terbaik dari ${storeName}. Pesan sekarang!`,
          ctaText: "Pesan via WhatsApp",
        },
      },
      {
        type: "faq",
        variant: "default",
        content: {
          blockId: "faq-shadcn-accordion",
          eyebrow: "✦ FAQ",
          heading: "Pertanyaan Umum",
          items: [
            { question: "Bagaimana cara memesan?", answer: "Klik tombol pesan dan hubungi kami via WhatsApp." },
            { question: "Apakah bisa kirim ke luar kota?", answer: "Bisa, kami melayani pengiriman ke seluruh Indonesia." },
          ],
        },
      },
      {
        type: "contact",
        variant: "default",
        content: {
          blockId: "contact-shadcn-cards",
          eyebrow: "✦ Kontak",
          heading: "Hubungi Kami",
          whatsapp: "6281234567890",
          address: "Jl. Contoh No. 123, Jakarta",
          hours: "Senin - Sabtu: 08:00 - 20:00 WIB",
        },
      },
      {
        type: "footer",
        variant: "default",
        content: { blockId: pick(FOOTER_BLOCKS), tagline: "Terima kasih sudah berbelanja!" },
      },
    ],
    sampleProducts: getSampleProducts(input.productCategory, input.businessType),
    designTokens: {
      accent: theme.accent,
      bg: theme.bg,
      cardBg: theme.cardBg,
      text: theme.text,
      textSecondary: theme.textSecondary,
      ctaText: "#ffffff",
      borderRadius: "12px",
      buttonRadius: "9999px",
      fontStyle: "modern-sans",
      spacing: "comfortable",
      elevation: "subtle-shadow",
      decorDensity: "moderate",
      layoutStyle: "startup",
    },
  };
}

function getTagline(businessType: string): string {
  const taglines: Record<string, string> = {
    food: "Homemade, Lezat, dan Bergizi",
    fashion: "Stylish, Nyaman, dan Terjangkau",
    gift: "Hadiah Spesial untuk Orang Tersayang",
    beauty: "Kecantikan Alami untuk Semua",
    craft: "Kerajinan Tangan Berkualitas",
    gadget: "Gadget Canggih, Harga Bersahabat",
    home: "Perlengkapan Rumah Berkualitas",
    service: "Layanan Profesional & Terpercaya",
  };
  return taglines[businessType] ?? "Berkualitas dan Terpercaya";
}

function getSampleProducts(category: string, businessType: string) {
  const products: Record<string, Array<{ name: string; description: string; price: number }>> = {
    food: [
      { name: `${category} Premium`, description: `${category} spesial buatan sendiri dengan bahan berkualitas tinggi.`, price: 85000 },
      { name: `${category} Classic`, description: `${category} klasik favorit semua orang, cocok untuk berbagai acara.`, price: 55000 },
      { name: `${category} Mini Box`, description: `Paket ${category} mini isi 6, pas untuk hampers atau camilan.`, price: 45000 },
      { name: `${category} Special Edition`, description: `${category} edisi spesial dengan topping premium.`, price: 120000 },
      { name: `${category} Family Pack`, description: `Paket hemat ${category} untuk keluarga, isi lebih banyak.`, price: 150000 },
    ],
    fashion: [
      { name: `${category} Basic`, description: `${category} basic nyaman dipakai sehari-hari.`, price: 99000 },
      { name: `${category} Premium`, description: `${category} premium dengan bahan pilihan.`, price: 199000 },
      { name: `${category} Set`, description: `Set ${category} lengkap untuk tampilan maksimal.`, price: 249000 },
      { name: `${category} Limited`, description: `${category} edisi terbatas, hanya tersedia selagi stok ada.`, price: 299000 },
      { name: `${category} Classic`, description: `${category} model klasik yang tak lekang oleh waktu.`, price: 149000 },
    ],
    default: [
      { name: `${category} Basic`, description: `${category} pilihan dasar dengan kualitas terbaik.`, price: 50000 },
      { name: `${category} Standard`, description: `${category} standar untuk kebutuhan sehari-hari.`, price: 75000 },
      { name: `${category} Premium`, description: `${category} kualitas premium dengan fitur lengkap.`, price: 120000 },
      { name: `${category} Bundle`, description: `Paket hemat ${category} untuk Anda.`, price: 200000 },
      { name: `${category} Custom`, description: `${category} custom sesuai keinginan Anda.`, price: 150000 },
    ],
  };

  return (products[businessType] || products["default"]).slice(0, 5);
}
