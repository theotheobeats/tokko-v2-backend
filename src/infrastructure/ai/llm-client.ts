/**
 * Mock AI store generator — returns structured content for development/testing.
 * Matches the component-based AIGeneratedPage shape (no HTML, just data).
 */

import type { AIGeneratedPage } from "../../application/store/generate-store";

export async function mockAIGenerate(input: {
  businessName: string;
  businessType: string;
  productCategory: string;
  aesthetic: string;
}): Promise<AIGeneratedPage> {
  await new Promise((r) => setTimeout(r, 100));

  const storeName = input.businessName;

  return {
    sections: [
      {
        type: "hero",
        variant: "split",
        content: {
          eyebrow: "✦ " + input.productCategory,
          title: `Selamat Datang di ${storeName}`,
          subtitle: `${getTagline(input.businessType)}. Pesan sekarang via WhatsApp!`,
          ctaText: "Pesan Sekarang",
        },
      },
      {
        type: "about",
        variant: "stats",
        content: {
          eyebrow: "✦ Tentang Kami",
          heading: "Kenapa Memilih Kami",
          body: `${storeName} hadir untuk memberikan produk ${input.productCategory} terbaik dengan kualitas premium dan harga terjangkau. Kami percaya setiap pelanggan berhak mendapatkan produk berkualitas dengan pelayanan ramah khas Indonesia.`,
          stats: [
            { value: "500+", label: "Pelanggan Puas" },
            { value: "4.9", label: "Rating Toko" },
            { value: "100%", label: "Original" },
          ],
        },
      },
      {
        type: "product-grid",
        variant: "grid",
        content: { eyebrow: "✦ Koleksi", heading: "Produk Unggulan Kami" },
      },
      {
        type: "testimonial",
        variant: "cards",
        content: {
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
        variant: "band",
        content: {
          heading: "Siap Pesan?",
          subtitle: `Dapatkan produk ${input.productCategory} terbaik dari ${storeName}. Pesan sekarang!`,
          ctaText: "Pesan via WhatsApp",
        },
      },
      {
        type: "contact",
        variant: "split",
        content: {
          eyebrow: "✦ Kontak",
          heading: "Hubungi Kami",
          whatsapp: "6281234567890",
          address: "Jl. Contoh No. 123, Jakarta",
          hours: "Senin - Sabtu: 08:00 - 20:00 WIB",
        },
      },
    ],
    sampleProducts: getSampleProducts(input.productCategory, input.businessType),
    designTokens: {
      accent: "#f97316",
      bg: "#fdfcfa",
      cardBg: "#ffffff",
      text: "#1c1917",
      textSecondary: "#78716c",
      ctaText: "#ffffff",
      borderRadius: "12px",
      buttonRadius: "9999px",
      fontStyle: "sans-clean",
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
