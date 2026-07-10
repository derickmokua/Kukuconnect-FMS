"use client";

import { FormEvent, useMemo, useState } from "react";
import {
  type FarmerOrder,
  ORDER_PRODUCTS,
  createOrder,
  formatMoney,
  lineFromProduct,
  mpesaTillHint,
} from "@/lib/orders";
import { insertOrder } from "@/lib/data/ordersRepo";
import {
  notifyFarmer,
  notifyStaffNewOrder,
  openOrderWhatsApp,
  staffWhatsAppUrl,
} from "@/lib/notifyClient";
import { orderWhatsAppUrl } from "@/lib/notifications";

/**
 * Public, low-data farmer order form.
 * Share: kukuconnect.co.ke/order (or localhost:3000/order)
 */
export default function PublicOrderPage() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [qty, setQty] = useState<Record<string, number>>(() =>
    Object.fromEntries(ORDER_PRODUCTS.map((p) => [p.id, 0]))
  );
  const [submitting, setSubmitting] = useState(false);
  const [doneOrder, setDoneOrder] = useState<FarmerOrder | null>(null);
  const [notifyNote, setNotifyNote] = useState("");
  const [error, setError] = useState("");

  const lines = useMemo(
    () =>
      ORDER_PRODUCTS.map((p) => lineFromProduct(p, qty[p.id] || 0)).filter(
        (l) => l.qty > 0
      ),
    [qty]
  );
  const total = lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  const till = mpesaTillHint();

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (!name.trim() || !phone.trim()) {
      setError("Jina na nambari ya simu zinahitajika / Name and phone required.");
      return;
    }
    if (lines.length === 0) {
      setError("Chagua angalau kuku moja / Select at least one product.");
      return;
    }
    setSubmitting(true);
    try {
      const order = createOrder({
        customerName: name,
        customerPhone: phone,
        location,
        notes,
        items: lines,
        source: "web",
      });
      await insertOrder(order);
      setDoneOrder(order);

      // SMS farmer payment instructions (if AT configured); no forced WA popup
      const farmerResult = await notifyFarmer(order, "order_received", {
        autoWhatsApp: false,
        trySms: true,
      });
      const staffResult = await notifyStaffNewOrder(order);

      const notesOut: string[] = [];
      if (farmerResult.smsSent) notesOut.push("SMS sent to your phone");
      else if (farmerResult.smsSkippedReason)
        notesOut.push("SMS optional — use WhatsApp below");
      if (staffResult?.smsSent) notesOut.push("Staff alerted by SMS");
      setNotifyNote(notesOut.join(" · "));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Order failed. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (doneOrder) {
    const waFarmer = orderWhatsAppUrl(doneOrder, "order_received");
    const waStaff = staffWhatsAppUrl(doneOrder);

    return (
      <div className="max-w-lg mx-auto space-y-6 py-4">
        <div className="rounded-3xl border border-emerald-800 bg-emerald-950/40 p-6 space-y-3">
          <p className="text-tertiary-container text-sm font-medium uppercase tracking-wide">
            Order received
          </p>
          <h1 className="text-2xl font-bold text-on-surface">
            Asante, {doneOrder.customerName}!
          </h1>
          <p className="text-on-surface text-sm">
            Order ID:{" "}
            <span className="text-on-surface font-mono">{doneOrder.id}</span>
          </p>
          <p className="text-3xl font-bold text-on-surface">
            {formatMoney(doneOrder.total)}
          </p>
          <div className="bg-background/60 rounded-2xl p-4 text-sm text-on-surface space-y-2 border border-outline-variant">
            <p className="font-medium text-on-surface">Lipa na M-Pesa</p>
            <p>
              Till / Paybill:{" "}
              <span className="text-tertiary-container font-semibold">{till}</span>
            </p>
            <p>
              After paying, keep the M-Pesa message. KukuConnect will confirm.
            </p>
            <p className="text-on-surface-variant">
              Baada ya kulipa, shika ujumbe wa M-Pesa. Tutawasiliana nawe.
            </p>
          </div>

          <div className="flex flex-col gap-2 pt-1">
            {waFarmer && (
              <button
                type="button"
                onClick={() => openOrderWhatsApp(doneOrder, "order_received")}
                className="w-full bg-tertiary-container text-on-primary hover:opacity-90 text-on-surface font-semibold py-3 rounded-2xl"
              >
                Save payment info on WhatsApp
              </button>
            )}
            {waStaff && (
              <a
                href={waStaff}
                target="_blank"
                rel="noreferrer"
                className="w-full text-center bg-surface-container-highest hover:bg-surface-container-high text-on-surface py-3 rounded-2xl text-sm"
              >
                Message KukuConnect on WhatsApp
              </a>
            )}
          </div>

          {notifyNote && (
            <p className="text-xs text-on-surface-variant">{notifyNote}</p>
          )}

          <button
            type="button"
            className="text-sm text-secondary hover:underline"
            onClick={() => {
              setDoneOrder(null);
              setNotifyNote("");
              setQty(Object.fromEntries(ORDER_PRODUCTS.map((p) => [p.id, 0])));
              setNotes("");
            }}
          >
            Place another order
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto space-y-6 py-2">
      <div>
        <p className="text-tertiary-container text-xs font-semibold uppercase tracking-widest">
          KukuConnect · Kitui
        </p>
        <h1 className="text-3xl font-bold text-on-surface mt-1">Order chicks</h1>
        <p className="text-on-surface-variant text-sm mt-2">
          Day-old & 3-week · Kuroiler & Rainbow Rooster · Low data form
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-5">
        <section className="space-y-3">
          {ORDER_PRODUCTS.map((p) => (
            <label
              key={p.id}
              className="flex items-center gap-3 farm-card border border-outline-variant rounded-2xl p-4"
            >
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-on-surface text-sm sm:text-base">
                  {p.name}
                </p>
                <p className="text-xs text-on-surface-variant mt-0.5">{p.blurb}</p>
                <p className="text-tertiary-container text-sm mt-1">
                  {formatMoney(p.unitPrice)} each
                </p>
              </div>
              <input
                type="number"
                min={0}
                max={5000}
                inputMode="numeric"
                className="w-20 bg-surface-container-lowest border border-outline-variant rounded-xl p-3 text-center text-on-surface"
                value={qty[p.id] || ""}
                placeholder="0"
                onChange={(e) =>
                  setQty((prev) => ({
                    ...prev,
                    [p.id]: Number(e.target.value) || 0,
                  }))
                }
              />
            </label>
          ))}
        </section>

        <div className="farm-card border border-outline-variant rounded-2xl p-4 space-y-3">
          <label className="block space-y-1">
            <span className="text-sm text-on-surface-variant">Your name / Jina</span>
            <input
              required
              className="w-full bg-surface-container-lowest border border-outline-variant p-3 rounded-xl text-on-surface"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm text-on-surface-variant">
              Phone (M-Pesa / WhatsApp)
            </span>
            <input
              required
              type="tel"
              inputMode="tel"
              className="w-full bg-surface-container-lowest border border-outline-variant p-3 rounded-xl text-on-surface"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="07XXXXXXXX"
              autoComplete="tel"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm text-on-surface-variant">
              Location (village / market)
            </span>
            <input
              className="w-full bg-surface-container-lowest border border-outline-variant p-3 rounded-xl text-on-surface"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. Kitui town, Mwingi…"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm text-on-surface-variant">Notes (optional)</span>
            <input
              className="w-full bg-surface-container-lowest border border-outline-variant p-3 rounded-xl text-on-surface"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Pickup date, group name…"
            />
          </label>
        </div>

        <div className="text-center space-y-3">
          <p className="text-2xl font-bold text-on-surface">
            Total: {formatMoney(total)}
          </p>
          <p className="text-xs text-on-surface-variant">
            Pay after ordering · Till {till}
          </p>
          {error && (
            <p className="text-sm text-error bg-red-950/40 border border-red-900/40 rounded-xl px-3 py-2">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-tertiary-container text-on-primary hover:opacity-90 disabled:opacity-60 text-on-surface font-semibold py-4 rounded-2xl text-lg"
          >
            {submitting ? "Sending…" : "Place order"}
          </button>
        </div>
      </form>

      <p className="text-center text-xs text-on-surface-variant pb-8">
        Staff login:{" "}
        <a href="/login" className="text-on-surface-variant underline">
          /login
        </a>
      </p>
    </div>
  );
}
