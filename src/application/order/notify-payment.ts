/**
 * Payment email notifications — fired from the payment webhook when a payment
 * is confirmed PAID:
 *   #5 payment-received → store owner ("Pembayaran diterima")
 *   #6 invoice/struk → the customer (only when they left an email at checkout)
 *
 * Best-effort and never blocks the webhook response — failures are logged and
 * swallowed (the emailer skips when RESEND_API_KEY is unset).
 */

import { eq } from "drizzle-orm";
import type { Env } from "../../types";
import type { DbClient } from "../../infrastructure/db/drizzle";
import { ResendEmailer } from "../../infrastructure/email/resend";
import { stores, user } from "../../infrastructure/db/schema";
import type { Payment } from "../../domain/payment/payment";
import type { Order } from "../../domain/order/order";

function formatRupiah(amount: number): string {
  return "Rp " + amount.toLocaleString("id-ID");
}

function itemsHtml(order: Order): string {
  return order.items
    .map(
      (i) =>
        `<tr>
          <td style="padding:8px 12px;border-bottom:1px solid #f1f1f1">${i.productName}${i.variantName ? `<br/><span style="color:#78716c;font-size:12px">${i.variantName}</span>` : ""}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f1f1f1;text-align:center">${i.quantity}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f1f1f1;text-align:right">${formatRupiah(i.unitPrice * i.quantity)}</td>
        </tr>`,
    )
    .join("");
}

/** #10: plan invoice + payment link → the merchant (best-effort). */
export async function notifyPlanInvoice(params: {
  env: Env;
  email: string;
  plan: "pro" | "commerce";
  cycle: "monthly" | "annual";
  amount: number;
  invoiceUrl: string;
}): Promise<void> {
  const { env, email, plan, cycle, amount, invoiceUrl } = params;
  try {
    const label = plan === "pro" ? "Pro" : "Commerce";
    const cycleLabel = cycle === "annual" ? "tahunan" : "bulanan";
    const html = `
      <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:#1c1917;margin:0 0 12px">Invoice langganan Tokko ${label} (${cycleLabel})</h2>
        <p style="color:#57534b;font-size:15px;line-height:1.6;margin:0 0 20px">
          Total tagihan <strong>${formatRupiah(amount)}</strong>. Selesaikan pembayaran lewat tautan di bawah.
        </p>
        <a href="${invoiceUrl}" style="display:inline-block;background:#f97316;color:#fff;text-decoration:none;font-weight:600;padding:12px 24px;border-radius:9999px">
          Bayar sekarang
        </a>
        <p style="color:#a8a29a;font-size:12px;margin:20px 0 0">Atau buka: ${invoiceUrl}</p>
      </div>`;
    await new ResendEmailer(env).send({
      to: email,
      subject: `Invoice langganan Tokko ${label} — ${formatRupiah(amount)}`,
      html,
    });
  } catch (e) {
    console.error("[notify] plan invoice email failed:", e);
  }
}

export interface NotifyOrderPaymentParams {
  db: DbClient;
  env: Env;
  payment: Payment;
  order: Order;
}

/** #5 payment-received → store owner, and #6 invoice → customer. */
export async function notifyOrderPayment(params: NotifyOrderPaymentParams): Promise<void> {
  const { db, env, payment, order } = params;
  try {
    const storeRow = await db.select().from(stores).where(eq(stores.id, order.storeId as string)).get();
    if (!storeRow) return;

    // --- #5 merchant: payment diterima -------------------------------------
    const owner = await db.select({ email: user.email }).from(user).where(eq(user.id, storeRow.ownerId)).get();
    if (owner?.email) {
      const dashboardUrl = `${env.FRONTEND_URL ?? "http://localhost:3000"}/dashboard/orders`;
      const merchantHtml = `
        <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px">
          <h2 style="color:#1c1917;margin:0 0 6px">✅ Pembayaran diterima</h2>
          <p style="color:#57534b;font-size:14px;margin:0 0 16px">
            Pembeli <strong>${order.customerName}</strong> sudah membayar pesanan <strong>${order.orderCode}</strong> senilai <strong>${formatRupiah(payment.amount)}</strong>.
          </p>
          <a href="${dashboardUrl}" style="display:inline-block;background:#f97316;color:#fff;text-decoration:none;font-weight:600;padding:12px 24px;border-radius:9999px">
            Lihat di dashboard
          </a>
        </div>`;
      await new ResendEmailer(env).send({
        to: owner.email,
        subject: `Pembayaran diterima ${order.orderCode} — ${formatRupiah(payment.amount)}`,
        html: merchantHtml,
      });
    }

    // --- #6 invoice → customer (only when they left an email) ---------------
    if (payment.customerEmail) {
      const wa = storeRow.whatsappNumber ? `https://wa.me/${storeRow.whatsappNumber.replace(/\D/g, "")}` : null;
      const invoiceHtml = `
        <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px">
          <h2 style="color:#1c1917;margin:0 0 6px">🧾 Struk pesanan ${order.orderCode}</h2>
          <p style="color:#57534b;font-size:14px;margin:0 0 16px">
            Terima kasih! Pembayaran kamu untuk pesanan di <strong>${storeRow.name}</strong> sudah kami terima.
          </p>
          <div style="background:#faf9f7;border:1px solid #eee;border-radius:12px;padding:14px 16px;margin-bottom:16px">
            <div style="font-size:13px;color:#78716c">Kode pesanan</div>
            <div style="font-size:16px;font-weight:700;color:#1c1917">${order.orderCode}</div>
            <div style="font-size:13px;color:#78716c;margin-top:8px">Dibayar</div>
            <div style="font-size:14px;color:#1c1917">${formatRupiah(payment.amount)} — ${payment.paidAt ? new Date(payment.paidAt).toLocaleString("id-ID") : "saat ini"}</div>
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:13px;color:#1c1917">
            <thead>
              <tr style="text-align:left;color:#78716c">
                <th style="padding:8px 12px;border-bottom:1px solid #eee">Item</th>
                <th style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center">Qty</th>
                <th style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right">Harga</th>
              </tr>
            </thead>
            <tbody>${itemsHtml(order)}</tbody>
          </table>
          <div style="display:flex;justify-content:space-between;padding:12px 12px 0;font-size:14px;font-weight:700;color:#1c1917">
            <span>Total dibayar</span>
            <span>${formatRupiah(payment.amount)}</span>
          </div>
          ${wa ? `<p style="font-size:12px;color:#78716c;margin:16px 12px 0">Butuh bantuan? Hubungi ${storeRow.name} via <a href="${wa}" style="color:#f97316">WhatsApp</a>.</p>` : ""}
        </div>`;
      await new ResendEmailer(env).send({
        to: payment.customerEmail,
        subject: `Struk pesanan ${order.orderCode} — ${storeRow.name}`,
        html: invoiceHtml,
      });
    }
  } catch (e) {
    // Never let a notification break the webhook flow.
    console.error("[notify] failed to notify payment:", e);
  }
}
