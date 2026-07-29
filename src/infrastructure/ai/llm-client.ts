/**
 * LLM Client — wraps OpenAI/Anthropic API calls.
 * 
 * For now, uses a mock that returns deterministic sample data.
 * Replace with real API calls when LLM keys are configured.
 */

import type { AIGeneratedPage } from "../../application/store/generate-store";

/**
 * Mock AI store generator — returns sample data for development/testing.
 * Matches the shape expected by the GenerateStore use case.
 */
export async function mockAIGenerate(input: {
  businessName: string;
  businessType: string;
  productCategory: string;
  aesthetic: string;
}): Promise<AIGeneratedPage> {
  // Simulate network delay
  await new Promise((r) => setTimeout(r, 100));

  const storeName = input.businessName;

  return {
    sections: [
      {
        type: "hero",
        data: {
          title: `Selamat Datang di ${storeName}`,
          subtitle: `${getTagline(input.businessType)} | Pesan sekarang via WhatsApp!`,
          ctaText: "Pesan Sekarang",
        },
      },
      {
        type: "about",
        data: {
          heading: "Tentang Kami",
          text: `${storeName} hadir untuk memberikan produk ${input.productCategory} terbaik dengan kualitas premium dan harga terjangkau. Kami percaya setiap pelanggan berhak mendapatkan produk berkualitas dengan pelayanan ramah khas Indonesia.`,
        },
      },
      {
        type: "product-grid",
        data: {
          heading: "Produk Unggulan Kami",
        },
      },
      {
        type: "testimonial",
        data: {
          heading: "Apa Kata Pelanggan",
          items: [
            { name: "Budi S.", text: `Produk ${input.productCategory}-nya enak banget! Pasti order lagi.`, rating: 5 },
            { name: "Sari W.", text: "Pelayanannya ramah dan cepat. Recommended!", rating: 5 },
            { name: "Dewi K.", text: "Harga terjangkau, kualitas premium. Suka banget!", rating: 4 },
          ],
        },
      },
      {
        type: "cta",
        data: {
          heading: "Siap Pesan?",
          description: `Dapatkan produk ${input.productCategory} terbaik dari ${storeName}. Pesan sekarang dan nikmati kualitasnya!`,
          buttonText: "Pesan via WhatsApp",
        },
      },
      {
        type: "contact",
        data: {
          heading: "Hubungi Kami",
          whatsappNumber: "(nomor WhatsApp Anda)",
          address: "Jl. Contoh No. 123, Jakarta",
          hours: "Senin - Sabtu: 08:00 - 20:00 WIB",
        },
      },
      {
        type: "faq",
        data: {
          heading: "Pertanyaan Umum",
          items: [
            { question: "Berapa lama proses pemesanan?", answer: "Pesanan akan diproses dalam 1-2 hari kerja setelah konfirmasi pembayaran." },
            { question: "Apakah bisa COD?", answer: "Saat ini kami hanya melayani pembayaran via transfer dan pesanan diantar setelah pembayaran dikonfirmasi." },
            { question: "Bagaimana cara memesan?", answer: "Cukup klik tombol 'Pesan via WhatsApp' dan kirimkan produk yang Anda inginkan beserta jumlahnya." },
          ],
        },
      },
    ],
    sampleProducts: getSampleProducts(input.productCategory, input.businessType),
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

// ---------------------------------------------------------------------------
// Real LLM client (to be wired up post-MVP)
// ---------------------------------------------------------------------------

/**
 * Real AI store generator using OpenAI/Anthropic API.
 * Requires LLM_API_KEY secret set on the Worker.
 */
export async function realAIGenerate(
  _input: {
    businessName: string;
    businessType: string;
    productCategory: string;
    aesthetic: string;
  },
  _env: { LLM_API_KEY: string; LLM_MODEL: string }
): Promise<AIGeneratedPage> {
  throw new Error("Real LLM client not yet implemented. Use mockAIGenerate for development.");
}
