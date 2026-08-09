/**
 * Courier catalog — the couriers a store can enable for shipping quotes.
 *
 * Biteship lists available couriers (name + service tier) but NOT rates —
 * courier pricing is per-quote (POST /v1/rates/couriers), which the app
 * already fetches live at checkout. This catalog drives the enable/disable
 * list in Settings; enabled couriers are then quoted by GetShippingRates.
 */

export interface CourierInfo {
  /** Biteship courier code (e.g. "jne"). */
  code: string;
  /** Human name for the settings list. */
  name: string;
  type: "standard" | "instant";
}

export const COURIER_CATALOG: CourierInfo[] = [
  { code: "jne", name: "JNE", type: "standard" },
  { code: "sicepat", name: "SiCepat", type: "standard" },
  { code: "jnt", name: "J&T Express", type: "standard" },
  { code: "anteraja", name: "AnterAja", type: "standard" },
  { code: "gosend", name: "GoSend", type: "instant" },
  { code: "grab", name: "GrabExpress", type: "instant" },
];

/** Couriers quoted when the store hasn't configured a custom list yet. */
export const DEFAULT_COURIERS: string[] = COURIER_CATALOG.map((c) => c.code);

export function isCourierCode(code: string): boolean {
  return COURIER_CATALOG.some((c) => c.code === code);
}
