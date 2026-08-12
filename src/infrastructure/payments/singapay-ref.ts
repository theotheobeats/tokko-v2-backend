/**
 * Compact reversible encoding for SingaPay payment-link `reff_no`.
 *
 * SingaPay caps reff_no at 40 chars, but our canonical plan external ids are
 * 60+ chars (`tokko-sub::<uuid36>::pro::monthly::<nonce>`). For those we send
 * a compact 33-char ref and decode it back to the canonical id on the webhook:
 *
 *   tk <kind> <b64url(uuid)> <plan> <cycle> <nonce>
 *    2    1        22          1      1       6   = 33 chars
 *
 *   kind:  s = subscription (tokko-sub::) | p = pending plan (tokko-pre::)
 *   plan:  o = pro | c = commerce
 *   cycle: m = monthly | a = annual
 *   nonce: 6 hex chars (regenerated — the canonical nonce is only a
 *          uniqueness marker and is never parsed)
 *
 * Order external ids (`tokko-<uuid>`, ≤ 40 chars) pass through untouched.
 */

import {
  SUBSCRIPTION_EXTERNAL_ID_PREFIX,
  PENDING_PLAN_EXTERNAL_ID_PREFIX,
} from "../../domain/plan/pricing";

export const SINGAPAY_REF_MARKER = "tk";
const REF_LENGTH = 33; // 2 + 1 + 22 + 1 + 1 + 6

const PLAN_CODE: Record<string, string> = { pro: "o", commerce: "c" };
const CYCLE_CODE: Record<string, string> = { monthly: "m", annual: "a" };
const CODE_PLAN: Record<string, string> = { o: "pro", c: "commerce" };
const CODE_CYCLE: Record<string, string> = { m: "monthly", a: "annual" };

const B64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function uuidToB64url(uuid: string): string {
  const hex = uuid.replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error(`Bukan UUID yang valid: ${uuid}`);
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  // 16 bytes → 22 base64url chars, no padding.
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
    out += B64URL_ALPHABET[b0 >> 2];
    out += B64URL_ALPHABET[((b0 & 3) << 4) | (b1 >> 4)];
    if (i + 1 < bytes.length) out += B64URL_ALPHABET[((b1 & 15) << 2) | (b2 >> 6)];
    if (i + 2 < bytes.length) out += B64URL_ALPHABET[b2 & 63];
  }
  return out;
}

function b64urlToUuid(b64: string): string | null {
  if (!/^[A-Za-z0-9_-]{22}$/.test(b64)) return null;
  const bytes = new Uint8Array(16);
  let buf = 0;
  let bits = 0;
  let idx = 0;
  for (const ch of b64) {
    const v = B64URL_ALPHABET.indexOf(ch);
    if (v < 0) return null;
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[idx++] = (buf >> bits) & 0xff;
    }
  }
  if (idx !== 16) return null;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function encodeRef(kind: "s" | "p", rest: string): string {
  const [id, plan, cycle] = rest.split("::");
  const planCode = PLAN_CODE[plan];
  const cycleCode = CYCLE_CODE[cycle];
  if (!id || !planCode || !cycleCode) {
    throw new Error("External id tidak bisa di-encode untuk SingaPay");
  }
  const nonce = crypto.randomUUID().replace(/-/g, "").slice(0, 6);
  return `${SINGAPAY_REF_MARKER}${kind}${uuidToB64url(id)}${planCode}${cycleCode}${nonce}`;
}

/**
 * Encode a canonical plan external id into a ≤40-char SingaPay reff_no.
 * Non-plan refs (order payments) are returned unchanged.
 */
export function encodeSingaPayRef(externalId: string): string {
  if (externalId.startsWith(SUBSCRIPTION_EXTERNAL_ID_PREFIX)) {
    return encodeRef("s", externalId.slice(SUBSCRIPTION_EXTERNAL_ID_PREFIX.length));
  }
  if (externalId.startsWith(PENDING_PLAN_EXTERNAL_ID_PREFIX)) {
    return encodeRef("p", externalId.slice(PENDING_PLAN_EXTERNAL_ID_PREFIX.length));
  }
  return externalId;
}

/**
 * Decode a SingaPay reff_no back to the canonical external id.
 * Returns null for non-encoded refs (order payments, foreign refs).
 */
export function decodeSingaPayRef(ref: string): string | null {
  if (!ref.startsWith(SINGAPAY_REF_MARKER) || ref.length !== REF_LENGTH) return null;
  const kind = ref[2];
  if (kind !== "s" && kind !== "p") return null;
  const id = b64urlToUuid(ref.slice(3, 25));
  const plan = CODE_PLAN[ref[25]];
  const cycle = CODE_CYCLE[ref[26]];
  const nonce = ref.slice(27, 33);
  if (!id || !plan || !cycle || !nonce) return null;
  const prefix = kind === "s" ? SUBSCRIPTION_EXTERNAL_ID_PREFIX : PENDING_PLAN_EXTERNAL_ID_PREFIX;
  return `${prefix}${id}::${plan}::${cycle}::${nonce}`;
}
