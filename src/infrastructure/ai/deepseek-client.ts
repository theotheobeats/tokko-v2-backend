/**
 * DeepSeek LLM Client — OpenAI-compatible API.
 *
 * DeepSeek endpoint: https://api.deepseek.com/v1
 * Model: deepseek-chat
 *
 * Uses standard fetch() — no SDK needed. Works in Cloudflare Workers runtime.
 */

import type { AIGeneratedPage } from "../../application/store/generate-store";
import { buildStorePrompt } from "./prompts/store-generator";
import { PRODUCT_DESCRIPTION_PROMPT } from "./prompts/product-description";
import { loadDesignGuide, mapAestheticToFolder } from "./design-loader";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

interface DeepSeekConfig {
  apiKey: string;
  model?: string;
}

const DEFAULT_MODEL = "deepseek-chat";
const BASE_URL = "https://api.deepseek.com/v1";

// ---------------------------------------------------------------------------
// Core client
// ---------------------------------------------------------------------------

async function chatCompletion(
  config: DeepSeekConfig,
  messages: { role: "system" | "user"; content: string }[],
  options?: { jsonMode?: boolean; maxTokens?: number; temperature?: number }
): Promise<string> {
  const response = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model ?? DEFAULT_MODEL,
      messages,
      temperature: options?.temperature ?? 0.7,
      // Store pages are large (5 sections × inline-CSS HTML + 5 products).
      // 2048 truncates the payload mid-string → unparseable. Default to 8192.
      max_tokens: options?.maxTokens ?? 8192,
      ...(options?.jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "Unknown error");
    throw new Error(`DeepSeek API error ${response.status}: ${errText.slice(0, 200)}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };

  return data.choices[0]?.message?.content ?? "";
}

// ---------------------------------------------------------------------------
// Store generation
// ---------------------------------------------------------------------------

/**
 * Generate a complete store page + sample products from quiz answers.
 * Replaces mockAIGenerate.
 */
export async function generateStore(
  config: DeepSeekConfig,
  input: {
    businessName: string;
    businessType: string;
    productCategory: string;
    aesthetic: string;
  }
): Promise<AIGeneratedPage> {
  // Load a random design guide for this aesthetic
  const designGuide = loadDesignGuide(input.aesthetic);
  const systemPrompt = buildStorePrompt(designGuide, input.aesthetic);

  const userMessage = JSON.stringify({
    namaBisnis: input.businessName,
    jenisBisnis: input.businessType,
    kategoriProduk: input.productCategory,
    gayaDesain: input.aesthetic,
  });

  const raw = await chatCompletion(
    config,
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    { jsonMode: true, temperature: 0.8 }
  );

  try {
    return parseStoreResponse(raw);
  } catch (err: any) {
    console.error("PARSE ERROR:", err.message);
    console.error("RAW RESPONSE (first 500 chars):", raw.slice(0, 500));
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Product description generation
// ---------------------------------------------------------------------------

/**
 * Generate a product description from name + category.
 * Replaces the inline mock in the products route.
 */
export async function generateProductDesc(
  config: DeepSeekConfig,
  input: { name: string; category: string }
): Promise<string> {
  const raw = await chatCompletion(
    config,
    [
      { role: "system", content: PRODUCT_DESCRIPTION_PROMPT },
      { role: "user", content: `Produk: ${input.name}\nKategori: ${input.category}` },
    ],
    { maxTokens: 200, temperature: 0.7 }
  );

  return raw.trim();
}

// ---------------------------------------------------------------------------
// JSON repair — handles newlines in string values (common DeepSeek quirk)
// ---------------------------------------------------------------------------

function repairJsonNewlines(raw: string): string {
  let result = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];

    if (escaped) {
      result += ch;
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      result += ch;
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      result += ch;
      continue;
    }

    if (inString && (ch === "\n" || ch === "\r")) {
      // Inside a JSON string value — escape the newline
      if (ch === "\n") result += "\\n";
      // Skip \r (or handle as needed)
      continue;
    }

    result += ch;
  }

  return result;
}

/**
 * Extract the outermost balanced {...} JSON object from a raw LLM response.
 * Handles leading prose, markdown fences, and trailing prose. Returns the
 * substring from the first '{' to its matching '}', or null if unbalanced.
 */
function extractJsonObject(raw: string): string | null {
  const start = raw.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }

  // Unbalanced — likely truncated. Return null so caller can fail clearly.
  return null;
}

// ---------------------------------------------------------------------------
// Response parser
// ---------------------------------------------------------------------------

function parseStoreResponse(raw: string): AIGeneratedPage {
  let parsed: unknown;

  // Attempt 1: strict parse (works when json_mode behaves).
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Attempt 2: extract the outermost balanced {...} then repair newlines.
    // Handles: markdown fences, leading prose, multi-line HTML strings.
    const extracted = extractJsonObject(raw);
    if (extracted) {
      try {
        parsed = JSON.parse(repairJsonNewlines(extracted));
      } catch {
        // fall through to error below
      }
    }

    if (parsed === undefined) {
      // Attempt 3: repair newlines across the whole raw payload.
      try {
        parsed = JSON.parse(repairJsonNewlines(raw));
      } catch {
        console.error("RAW RESPONSE (first 800 chars):", raw.slice(0, 800));
        throw new Error("AI response is not valid JSON");
      }
    }
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("AI response is not an object");
  }

  const data = parsed as Record<string, unknown>;

  if (!Array.isArray(data.sections)) {
    throw new Error("AI response missing 'sections' array");
  }

  if (!Array.isArray(data.sampleProducts)) {
    throw new Error("AI response missing 'sampleProducts' array");
  }

  // Validate and sanitize sections
  const validTypes = ["hero", "about", "product-grid", "testimonial", "cta", "contact", "faq"];
  const sections = (data.sections as Array<Record<string, unknown>>)
    .filter((s) => validTypes.includes(s.type as string))
    .map((s) => {
      const rawTemplate = (typeof s.template === "string" ? s.template : `<div>{{content}}</div>`) as string;
      // Normalize: collapse any newlines/excess whitespace into single-line HTML
      const template = rawTemplate.replace(/\s+/g, " ").trim();
      const slots = (s.slots && typeof s.slots === "object" ? s.slots : { content: s.data ? JSON.stringify(s.data) : "" }) as Record<string, string>;
      return { type: s.type as string, template, slots };
    });

  if (sections.length === 0) {
    throw new Error("AI response has no valid sections");
  }

  // Validate and sanitize products
  const sampleProducts = (data.sampleProducts as Array<Record<string, unknown>>)
    .filter((p) => typeof p.name === "string" && typeof p.price === "number")
    .map((p) => ({
      name: p.name as string,
      description: typeof p.description === "string" ? p.description : "",
      price: Math.max(0, Math.round(p.price as number)),
    }))
    .slice(0, 5);

  if (sampleProducts.length === 0) {
    throw new Error("AI response has no valid products");
  }

  // Parse design tokens
  const designTokens = (data.designTokens && typeof data.designTokens === "object"
    ? data.designTokens as Record<string, string>
    : undefined);

  return { sections, sampleProducts, designTokens };
}

// ---------------------------------------------------------------------------
// Mock (fallback for development without API key)
// ---------------------------------------------------------------------------

export { mockAIGenerate } from "./llm-client";
