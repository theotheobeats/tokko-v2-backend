/**
 * Order bounded context — domain rules (pure functions).
 */

/** Alphabet without ambiguous characters (no I, O, 0, 1) */
const ORDER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * Generate a human-friendly order code: TK-XXXXXX.
 * Shown to the customer on the checkout success screen and used as the
 * reference in WhatsApp conversations (customer ↔ store owner).
 */
export function generateOrderCode(): string {
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += ORDER_CODE_ALPHABET[Math.floor(Math.random() * ORDER_CODE_ALPHABET.length)];
  }
  return `TK-${code}`;
}
