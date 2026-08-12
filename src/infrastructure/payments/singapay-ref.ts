/**
 * Compact reversible encoding for SingaPay payment-link `reff_no`.
 *
 * SingaPay caps reff_no at 40 chars, but our canonical plan external ids are
 * 60-80 chars (`tokko-sub::<id>::<plan>::<cycle>::<nonce>`). For those we send
 * a compact ref and decode it back to the canonical id on the webhook:
 *
 *   <kind><id><plan><cycle><nonce4>
 *    kind:  s = subscription (tokko-sub::) | p = pending plan (tokko-pre::)
 *    plan:  o = pro | c = commerce
 *    cycle: m = monthly | a = annual
 *    nonce: 4 hex chars (regenerated — the canonical nonce is only a
 *           uniqueness marker and is never parsed)
 *
 *   s (store id = UUID):   s <b64url(16B)=22> <p> <c> <n4>  → 29 chars
 *   p (user id = better-auth 32-char base62): p <raw 32> <p> <c> <n4> → 39 chars
 *
 * Order external ids (`tokko-<uuid-no-dashes>`, 38 chars) pass through.
 */

import {
  SUBSCRIPTION_EXTERNAL_ID_PREFIX,
  PENDING_PLAN_EXTERNAL_ID_PREFIX,
} from "../../domain/plan/pricing";

const NONCE_LEN = 4;
const REF_LEN_S = 29; // 1 + 22 + 1 + 1 + 4
const REF_LEN_P = 39; // 1 + 32 + 1 + 1 + 4

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

function parseCanonical(
  externalId: string,
): { kind: "s" | "p"; id: string; plan: string; cycle: string } | null {
  if (externalId.startsWith(SUBSCRIPTION_EXTERNAL_ID_PREFIX)) {
    const [id, plan, cycle] = externalId.slice(SUBSCRIPTION_EXTERNAL_ID_PREFIX.length).split("::");
    return { kind: "s", id, plan, cycle };
  }
  if (externalId.startsWith(PENDING_PLAN_EXTERNAL_ID_PREFIX)) {
    const [id, plan, cycle] = externalId.slice(PENDING_PLAN_EXTERNAL_ID_PREFIX.length).split("::");
    return { kind: "p", id, plan, cycle };
  }
  return null;
}

/**
 * Encode a canonical plan external id into a ≤40-char SingaPay reff_no.
 * Non-plan refs (order payments) are returned unchanged.
 */
export function encodeSingaPayRef(externalId: string): string {
  const parsed = parseCanonical(externalId);
  if (!parsed) {
    if (externalId.length > 40) {
      throw new Error(`External id terlalu panjang untuk SingaPay reff_no (${externalId.length} > 40)`);
    }
    return externalId;
  }

  const planCode = PLAN_CODE[parsed.plan];
  const cycleCode = CYCLE_CODE[parsed.cycle];
  if (!planCode || !cycleCode) {
    throw new Error("External id tidak bisa di-encode untuk SingaPay");
  }
  const nonce = crypto.randomUUID().replace(/-/g, "").slice(0, NONCE_LEN);

  if (parsed.kind === "s") {
    // store id is one of our UUIDs
    return `s${uuidToB64url(parsed.id)}${planCode}${cycleCode}${nonce}`;
  }
  // pending-plan user id is better-auth's 32-char base62 id — raw, fits
  if (!/^[A-Za-z0-9]{32}$/.test(parsed.id)) {
    throw new Error(`ID pengguna tidak valid: ${parsed.id}`);
  }
  return `p${parsed.id}${planCode}${cycleCode}${nonce}`;
}

/**
 * Decode a SingaPay reff_no back to the canonical external id.
 * Returns null for non-encoded refs (order payments, foreign refs).
 */
export function decodeSingaPayRef(ref: string): string | null {
  if (ref[0] === "s" && ref.length === REF_LEN_S) {
    const id = b64urlToUuid(ref.slice(1, 23));
    const plan = CODE_PLAN[ref[23]];
    const cycle = CODE_CYCLE[ref[24]];
    const nonce = ref.slice(25, 29);
    if (!id || !plan || !cycle || nonce.length !== NONCE_LEN) return null;
    return `${SUBSCRIPTION_EXTERNAL_ID_PREFIX}${id}::${plan}::${cycle}::${nonce}`;
  }

  if (ref[0] === "p" && ref.length === REF_LEN_P) {
    const id = ref.slice(1, 33);
    const plan = CODE_PLAN[ref[33]];
    const cycle = CODE_CYCLE[ref[34]];
    const nonce = ref.slice(35, 39);
    if (!/^[A-Za-z0-9]{32}$/.test(id) || !plan || !cycle || nonce.length !== NONCE_LEN) return null;
    return `${PENDING_PLAN_EXTERNAL_ID_PREFIX}${id}::${plan}::${cycle}::${nonce}`;
  }

  return null;
}
