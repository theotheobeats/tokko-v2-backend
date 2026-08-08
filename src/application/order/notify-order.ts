/**
 * New-order notification — tells the store owner a customer submitted an order.
 *
 * Best-effort and never blocks the order response: failures are logged and
 * swallowed (the emailer itself skips when RESEND_API_KEY is unset).
 */

import { eq } from "drizzle-orm";
import type { Env } from "../../types";
import type { DbClient } from "../../infrastructure/db/drizzle";
import { ResendEmailer } from "../../infrastructure/email/resend";
import { user } from "../../infrastructure/db/schema";

/** "Rp 85.000" (integer Rupiah). */
function formatRupiah(amount: number): string {
  return "Rp " + amount.toLocaleString("id-ID");
}

export interface NewOrderSnapshot {
  orderCode: string;
  customerName: string;
  customerPhone: string;
  items: { productName: string; quantity: number; unitPrice: number; variantName?: string | null }[];
  totalAmount: number;
  shippingAddress: string | null;
  notes: string | null;
}

export async function notifyStoreOwnerOfNewOrder(params: {
  db: DbClient;
  env: Env;
  ownerId: string;
  storeName: string;
  order: NewOrderSnapshot;
}): Promise<void> {
  try {
    const { db, env, ownerId, storeName, order } = params;

    const owner = await db.select({ email: user.email }).from(user).where(eq(user.id, ownerId)).get();
    if (!owner?.email) return;

    const itemsHtml = order.items
      .map(
        (i) =>
          `<tr>
            <td style="padding:8px 12px;border-bottom:1px solid #f1f1f1">${i.productName}${i.variantName ? `<br/><span style="color:#78716c;font-size:12px">${i.variantName}</span>` : ""}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #f1f1f1;text-align:center">${i.quantity}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #f1f1f1;text-align:right">${formatRupiah(i.unitPrice * i.quantity)}</td>
          </tr>`,
      )
      .join("");

    const dashboardUrl = `${env.FRONTEND_URL ?? "http://localhost:3000"}/dashboard/orders`;
    const customerLine = `${order.customerName} · ${order.customerPhone}`;

    const html = `
      <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px">
        <h2 style="color:#1c1917;margin:0 0 6px">🛍️ Pesanan baru</h2>
        <p style="color:#57534b;font-size:14px;margin:0 0 20px">
          Ada pesanan masuk untuk <strong>${storeName}</strong>.
        </p>
        <div style="background:#faf9f7;border:1px solid #eee;border-radius:12px;padding:14px 16px;margin-bottom:16px">
          <div style="font-size:13px;color:#78716c">Kode pesanan</div>
          <div style="font-size:16px;font-weight:700;color:#1c1917">${order.orderCode}</div>
          <div style="font-size:13px;color:#78716c;margin-top:8px">Pelanggan</div>
          <div style="font-size:14px;color:#1c1917">${customerLine}</div>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:13px;color:#1c1917">
          <thead>
            <tr>
              <th style="text-align:left;padding:8px 12px;border-bottom:2px solid #eee">Produk</th>
              <th style="text-align:center;padding:8px 12px;border-bottom:2px solid #eee">Qty</th>
              <th style="text-align:right;padding:8px 12px;border-bottom:2px solid #eee">Subtotal</th>
            </tr>
          </thead>
          <tbody>${itemsHtml}</tbody>
        </table>
        <div style="display:flex;justify-content:space-between;padding:12px 12px 0;font-size:14px;font-weight:700;color:#1c1917">
          <span>Total</span>
          <span>${formatRupiah(order.totalAmount)}</span>
        </div>
        ${order.shippingAddress ? `<p style="font-size:12px;color:#78716c;margin:12px 12px 0">Alamat kirim: ${order.shippingAddress}</p>` : ""}
        ${order.notes ? `<p style="font-size:12px;color:#78716c;margin:4px 12px 0">Catatan: ${order.notes}</p>` : ""}
        <a href="${dashboardUrl}" style="display:inline-block;margin-top:20px;background:#f97316;color:#fff;text-decoration:none;font-weight:600;padding:12px 24px;border-radius:9999px">
          Lihat di dashboard
        </a>
      </div>`;

    const sent = await new ResendEmailer(env).send({
      to: owner.email,
      subject: `Pesanan baru ${order.orderCode} — ${formatRupiah(order.totalAmount)}`,
      html,
    });
    if (!sent) {
      console.warn(`[notify] order ${order.orderCode}: email not sent (no key or failure)`);
    }
  } catch (e) {
    // Never let a notification break the order flow.
    console.error("[notify] failed to notify store owner:", e);
  }
}
