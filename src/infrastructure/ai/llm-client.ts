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
        template: `<div style="background: {{bg}}; padding: 48px 24px; text-align: center;"><h1 style="font-size: 32px; font-weight: 700; color: {{text}}; margin-bottom: 12px;">{{title}}</h1><p style="font-size: 15px; color: {{textSecondary}}; line-height: 1.6; margin-bottom: 24px;">{{subtitle}}</p><a href="#" style="display: inline-block; background: {{accent}}; color: {{ctaText}}; padding: 14px 32px; border-radius: {{buttonRadius}}; text-decoration: none; font-weight: 600;">{{ctaText}}</a></div>`,
        slots: {
          title: `Selamat Datang di ${storeName}`,
          subtitle: `${getTagline(input.businessType)} | Pesan sekarang via WhatsApp!`,
          ctaText: "Pesan Sekarang",
        },
      },
      {
        type: "about",
        template: `<div style="padding: 40px 24px; max-width: 480px; margin: 0 auto;"><h2 style="font-size: 22px; font-weight: 700; color: {{text}}; margin-bottom: 12px;">{{heading}}</h2><p style="font-size: 15px; color: {{textSecondary}}; line-height: 1.7;">{{text}}</p></div>`,
        slots: {
          heading: "Tentang Kami",
          text: `${storeName} hadir untuk memberikan produk ${input.productCategory} terbaik dengan kualitas premium dan harga terjangkau. Kami percaya setiap pelanggan berhak mendapatkan produk berkualitas dengan pelayanan ramah khas Indonesia.`,
        },
      },
      {
        type: "product-grid",
        template: `<div style="padding: 40px 24px; max-width: 480px; margin: 0 auto;"><h2 style="font-size: 22px; font-weight: 700; color: {{text}}; margin-bottom: 20px;">{{heading}}</h2><div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;"><div style="background: {{cardBg}}; border-radius: {{borderRadius}}; padding: 16px; text-align: center;"><div style="font-size: 32px; margin-bottom: 8px;">📦</div><div style="font-size: 13px; font-weight: 600; color: {{text}};">Produk 1</div><div style="font-size: 12px; color: {{textSecondary}};">Rp 85.000</div></div><div style="background: {{cardBg}}; border-radius: {{borderRadius}}; padding: 16px; text-align: center;"><div style="font-size: 32px; margin-bottom: 8px;">📦</div><div style="font-size: 13px; font-weight: 600; color: {{text}};">Produk 2</div><div style="font-size: 12px; color: {{textSecondary}};">Rp 55.000</div></div></div></div>`,
        slots: { heading: "Produk Unggulan Kami" },
      },
      {
        type: "testimonial",
        template: `<div style="background: {{bg}}; padding: 40px 24px; max-width: 480px; margin: 0 auto;"><h2 style="font-size: 22px; font-weight: 700; color: {{text}}; margin-bottom: 16px;">{{heading}}</h2><div style="background: {{cardBg}}; border-radius: {{borderRadius}}; padding: 16px; margin-bottom: 10px;"><div style="color: #f59e0b; font-size: 14px;">{{stars1}}</div><p style="font-size: 14px; color: {{text}}; line-height: 1.6; margin: 8px 0;">{{text1}}</p><p style="font-size: 12px; color: {{textSecondary}};">— {{name1}}</p></div><div style="background: {{cardBg}}; border-radius: {{borderRadius}}; padding: 16px; margin-bottom: 10px;"><div style="color: #f59e0b; font-size: 14px;">{{stars2}}</div><p style="font-size: 14px; color: {{text}}; line-height: 1.6; margin: 8px 0;">{{text2}}</p><p style="font-size: 12px; color: {{textSecondary}};">— {{name2}}</p></div></div>`,
        slots: {
          heading: "Apa Kata Pelanggan",
          stars1: "★★★★★", text1: `Produk ${input.productCategory}-nya enak banget! Pasti order lagi.`, name1: "Budi S.",
          stars2: "★★★★★", text2: "Pelayanannya ramah dan cepat. Recommended!", name2: "Sari W.",
        },
      },
      {
        type: "cta",
        template: `<div style="padding: 40px 24px; text-align: center; max-width: 480px; margin: 0 auto;"><div style="background: linear-gradient(135deg, {{accent}}, {{accent}}dd); border-radius: {{borderRadius}}; padding: 32px 24px;"><h2 style="font-size: 22px; font-weight: 700; color: {{ctaText}}; margin-bottom: 8px;">{{heading}}</h2><p style="font-size: 14px; color: {{ctaText}}; opacity: 0.9; line-height: 1.6; margin-bottom: 20px;">{{description}}</p><a href="#" style="display: inline-block; background: {{ctaText}}; color: {{accent}}; padding: 12px 24px; border-radius: {{buttonRadius}}; text-decoration: none; font-weight: 600; font-size: 14px;">{{buttonText}}</a></div></div>`,
        slots: {
          heading: "Siap Pesan?",
          description: `Dapatkan produk ${input.productCategory} terbaik dari ${storeName}. Pesan sekarang dan nikmati kualitasnya!`,
          buttonText: "Pesan via WhatsApp",
        },
      },
      {
        type: "contact",
        template: `<div style="background: {{text}}; padding: 40px 24px; text-align: center;"><h2 style="font-size: 22px; font-weight: 700; color: #ffffff; margin-bottom: 12px;">{{heading}}</h2><p style="font-size: 14px; color: rgba(255,255,255,0.7); line-height: 1.6; margin-bottom: 4px;">{{address}}</p><p style="font-size: 13px; color: rgba(255,255,255,0.5); margin-bottom: 16px;">{{hours}}</p><a href="https://wa.me/{{whatsappNumber}}" style="display: inline-block; background: #25D366; color: white; padding: 12px 28px; border-radius: 9999px; text-decoration: none; font-weight: 600; font-size: 14px;">Chat via WhatsApp</a></div>`,
        slots: {
          heading: "Hubungi Kami",
          whatsappNumber: "6281234567890",
          address: "Jl. Contoh No. 123, Jakarta",
          hours: "Senin - Sabtu: 08:00 - 20:00 WIB",
        },
      },
      {
        type: "faq",
        template: `<div style="padding: 40px 24px; max-width: 480px; margin: 0 auto;"><h2 style="font-size: 22px; font-weight: 700; color: {{text}}; margin-bottom: 16px;">{{heading}}</h2><div style="background: {{cardBg}}; border-radius: {{borderRadius}}; padding: 16px; margin-bottom: 8px;"><p style="font-size: 14px; font-weight: 600; color: {{text}}; margin-bottom: 6px;">{{q1}}</p><p style="font-size: 13px; color: {{textSecondary}}; line-height: 1.6;">{{a1}}</p></div><div style="background: {{cardBg}}; border-radius: {{borderRadius}}; padding: 16px; margin-bottom: 8px;"><p style="font-size: 14px; font-weight: 600; color: {{text}}; margin-bottom: 6px;">{{q2}}</p><p style="font-size: 13px; color: {{textSecondary}}; line-height: 1.6;">{{a2}}</p></div></div>`,
        slots: {
          heading: "Pertanyaan Umum",
          q1: "Berapa lama proses pemesanan?", a1: "Pesanan akan diproses dalam 1-2 hari kerja setelah konfirmasi.",
          q2: "Bagaimana cara memesan?", a2: "Klik tombol WhatsApp dan kirimkan produk yang Anda inginkan.",
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
