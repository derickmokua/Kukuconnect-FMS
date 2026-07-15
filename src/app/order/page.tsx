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

type Step = 1 | 2 | 3;

/**
 * Public farmer order form — app.kukuconnect.co.ke/order
 * No staff chrome. Simple steps for low-data mobile.
 */
export default function PublicOrderPage() {
  const [step, setStep] = useState<Step>(1);
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
  const birdCount = lines.reduce((s, l) => s + l.qty, 0);
  const till = mpesaTillHint();

  const setProductQty = (id: string, next: number) => {
    const n = Math.max(0, Math.min(5000, Math.floor(next) || 0));
    setQty((prev) => ({ ...prev, [id]: n }));
  };

  const bump = (id: string, delta: number) => {
    setProductQty(id, (qty[id] || 0) + delta);
  };

  const goDetails = () => {
    setError("");
    if (lines.length === 0) {
      setError("Chagua angalau kuku moja / Select at least one product.");
      return;
    }
    setStep(2);
  };

  const goConfirm = () => {
    setError("");
    if (!name.trim() || !phone.trim()) {
      setError("Jina na nambari ya simu zinahitajika / Name and phone required.");
      return;
    }
    setStep(3);
  };

  const onSubmit = async (e?: FormEvent) => {
    e?.preventDefault();
    setError("");
    if (!name.trim() || !phone.trim()) {
      setError("Jina na nambari ya simu zinahitajika / Name and phone required.");
      setStep(2);
      return;
    }
    if (lines.length === 0) {
      setError("Chagua angalau kuku moja / Select at least one product.");
      setStep(1);
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
    const waStaff = staffWhatsAppUrl(doneOrder);

    return (
      <div className="space-y-5 py-2 pb-8">
        <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 space-y-4">
          <p className="text-emerald-800 text-xs font-bold uppercase tracking-widest">
            Order received
          </p>
          <h1 className="text-2xl font-bold text-on-surface">
            Asante, {doneOrder.customerName}!
          </h1>
          <p className="text-sm text-on-surface-variant">
            Order ID:{" "}
            <span className="font-mono font-semibold text-on-surface">
              {doneOrder.id}
            </span>
          </p>
          <p className="text-3xl font-extrabold text-primary">
            {formatMoney(doneOrder.total)}
          </p>

          <ul className="text-sm text-on-surface space-y-1 border-t border-emerald-200/80 pt-3">
            {doneOrder.items.map((l) => (
              <li key={`${l.name}-${l.qty}`} className="flex justify-between gap-2">
                <span>
                  {l.name} × {l.qty}
                </span>
                <span className="font-medium">
                  {formatMoney(l.qty * l.unitPrice)}
                </span>
              </li>
            ))}
          </ul>

          <div className="bg-white rounded-2xl p-4 text-sm space-y-2 border border-outline-variant">
            <p className="font-bold text-on-surface">Lipa na M-Pesa</p>
            <p>
              Till / Paybill:{" "}
              <span className="text-primary font-bold text-base">{till}</span>
            </p>
            <p className="text-on-surface-variant">
              After paying, keep the M-Pesa message. We will confirm your order.
            </p>
            <p className="text-on-surface-variant">
              Baada ya kulipa, shika ujumbe wa M-Pesa. Tutawasiliana nawe.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            {orderWhatsAppUrl(doneOrder, "order_received") && (
              <button
                type="button"
                onClick={() => openOrderWhatsApp(doneOrder, "order_received")}
                className="w-full min-h-12 bg-tertiary-container text-white font-semibold py-3.5 rounded-2xl touch-manipulation"
              >
                Save payment info on WhatsApp
              </button>
            )}
            {waStaff && (
              <a
                href={waStaff}
                target="_blank"
                rel="noreferrer"
                className="w-full text-center min-h-12 flex items-center justify-center bg-surface-container-highest text-on-surface font-medium py-3.5 rounded-2xl touch-manipulation"
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
            className="text-sm text-primary font-medium hover:underline"
            onClick={() => {
              setDoneOrder(null);
              setNotifyNote("");
              setStep(1);
              setQty(
                Object.fromEntries(ORDER_PRODUCTS.map((p) => [p.id, 0]))
              );
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
    <div className="space-y-5 py-1 pb-28">
      <header>
        <p className="text-primary text-xs font-bold uppercase tracking-widest">
          KukuConnect · Kitui
        </p>
        <h1 className="text-2xl sm:text-3xl font-bold text-on-surface mt-1">
          Order chicks
        </h1>
        <p className="text-on-surface-variant text-sm mt-1.5">
          Day-old &amp; 3-week · Kuroiler &amp; Rainbow Rooster
        </p>
      </header>

      {/* Step indicator */}
      <nav
        className="flex items-center gap-2 text-xs font-semibold"
        aria-label="Order steps"
      >
        {(
          [
            { n: 1 as Step, label: "Chicks" },
            { n: 2 as Step, label: "Details" },
            { n: 3 as Step, label: "Confirm" },
          ] as const
        ).map((s, i) => (
          <div key={s.n} className="flex items-center gap-2 min-w-0">
            {i > 0 && (
              <span className="text-outline-variant hidden xs:inline">/</span>
            )}
            <button
              type="button"
              onClick={() => {
                if (s.n < step) setStep(s.n);
              }}
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 transition-colors ${
                step === s.n
                  ? "bg-primary text-white"
                  : step > s.n
                    ? "bg-primary-fixed text-primary"
                    : "bg-surface-container text-on-surface-variant"
              }`}
            >
              <span
                className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] ${
                  step === s.n
                    ? "bg-white/20"
                    : step > s.n
                      ? "bg-primary/15"
                      : "bg-white"
                }`}
              >
                {s.n}
              </span>
              <span className="truncate">{s.label}</span>
            </button>
          </div>
        ))}
      </nav>

      {error && (
        <p
          className="text-sm text-error bg-error-container/40 border border-error/30 rounded-xl px-3 py-2.5"
          role="alert"
        >
          {error}
        </p>
      )}

      {/* Step 1 — products */}
      {step === 1 && (
        <section className="space-y-3" aria-labelledby="step-chicks">
          <h2 id="step-chicks" className="sr-only">
            Choose chicks
          </h2>
          {ORDER_PRODUCTS.map((p) => {
            const q = qty[p.id] || 0;
            return (
              <div
                key={p.id}
                className={`farm-card border rounded-2xl p-4 transition-colors ${
                  q > 0
                    ? "border-primary/40 bg-primary-fixed/20"
                    : "border-outline-variant"
                }`}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-on-surface">{p.name}</p>
                    <p className="text-xs text-on-surface-variant mt-0.5">
                      {p.blurb}
                    </p>
                    <p className="text-primary font-bold text-base mt-1.5">
                      {formatMoney(p.unitPrice)}{" "}
                      <span className="text-sm font-medium text-on-surface-variant">
                        each
                      </span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                    <button
                      type="button"
                      aria-label={`Fewer ${p.name}`}
                      disabled={q <= 0}
                      onClick={() => bump(p.id, -1)}
                      className="w-11 h-11 rounded-xl border border-outline-variant bg-surface-container-lowest text-on-surface text-xl font-bold disabled:opacity-40 touch-manipulation active:scale-95"
                    >
                      −
                    </button>
                    <input
                      type="number"
                      min={0}
                      max={5000}
                      inputMode="numeric"
                      aria-label={`Quantity of ${p.name}`}
                      className="w-16 h-11 bg-surface-container-lowest border border-outline-variant rounded-xl text-center text-on-surface text-base font-semibold"
                      value={q || ""}
                      placeholder="0"
                      onChange={(e) =>
                        setProductQty(p.id, Number(e.target.value))
                      }
                    />
                    <button
                      type="button"
                      aria-label={`More ${p.name}`}
                      onClick={() => bump(p.id, 1)}
                      className="w-11 h-11 rounded-xl border border-outline-variant bg-surface-container-lowest text-on-surface text-xl font-bold touch-manipulation active:scale-95"
                    >
                      +
                    </button>
                  </div>
                </div>
                {q > 0 && (
                  <p className="text-xs text-on-surface-variant mt-2 text-right">
                    Subtotal {formatMoney(q * p.unitPrice)}
                  </p>
                )}
              </div>
            );
          })}
        </section>
      )}

      {/* Step 2 — details */}
      {step === 2 && (
        <section className="space-y-4" aria-labelledby="step-details">
          <h2 id="step-details" className="text-lg font-bold text-on-surface">
            Your details
          </h2>
          <div className="farm-card border border-outline-variant rounded-2xl p-4 space-y-3">
            <label className="block space-y-1">
              <span className="text-sm font-medium text-on-surface-variant">
                Your name / Jina *
              </span>
              <input
                required
                className="w-full min-h-12 bg-surface-container-lowest border border-outline-variant p-3 rounded-xl text-on-surface text-base"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                enterKeyHint="next"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-medium text-on-surface-variant">
                Phone (M-Pesa / WhatsApp) *
              </span>
              <input
                required
                type="tel"
                inputMode="tel"
                className="w-full min-h-12 bg-surface-container-lowest border border-outline-variant p-3 rounded-xl text-on-surface text-base"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="07XXXXXXXX"
                autoComplete="tel"
                enterKeyHint="next"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-medium text-on-surface-variant">
                Location (village / market)
              </span>
              <input
                className="w-full min-h-12 bg-surface-container-lowest border border-outline-variant p-3 rounded-xl text-on-surface text-base"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. Kitui town, Mwingi…"
                enterKeyHint="next"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-medium text-on-surface-variant">
                Notes (optional)
              </span>
              <input
                className="w-full min-h-12 bg-surface-container-lowest border border-outline-variant p-3 rounded-xl text-on-surface text-base"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Pickup date, group name…"
                enterKeyHint="done"
              />
            </label>
          </div>
          <button
            type="button"
            onClick={() => setStep(1)}
            className="text-sm text-primary font-medium hover:underline"
          >
            ← Change chicks
          </button>
        </section>
      )}

      {/* Step 3 — confirm */}
      {step === 3 && (
        <section className="space-y-4" aria-labelledby="step-confirm">
          <h2 id="step-confirm" className="text-lg font-bold text-on-surface">
            Confirm order
          </h2>
          <div className="farm-card border border-outline-variant rounded-2xl p-4 space-y-3 text-sm">
            <div>
              <p className="text-on-surface-variant text-xs font-medium uppercase tracking-wide">
                Birds
              </p>
              <ul className="mt-1 space-y-1">
                {lines.map((l) => (
                  <li
                    key={l.name}
                    className="flex justify-between gap-2 text-on-surface"
                  >
                    <span>
                      {l.name} × {l.qty}
                    </span>
                    <span className="font-semibold">
                      {formatMoney(l.qty * l.unitPrice)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="border-t border-outline-variant pt-3 space-y-1">
              <p>
                <span className="text-on-surface-variant">Name: </span>
                <span className="font-medium text-on-surface">{name}</span>
              </p>
              <p>
                <span className="text-on-surface-variant">Phone: </span>
                <span className="font-medium text-on-surface">{phone}</span>
              </p>
              {location ? (
                <p>
                  <span className="text-on-surface-variant">Location: </span>
                  <span className="font-medium text-on-surface">{location}</span>
                </p>
              ) : null}
              {notes ? (
                <p>
                  <span className="text-on-surface-variant">Notes: </span>
                  <span className="font-medium text-on-surface">{notes}</span>
                </p>
              ) : null}
            </div>
            <p className="text-xs text-on-surface-variant border-t border-outline-variant pt-3">
              Pay after ordering · Till {till}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setStep(2)}
            className="text-sm text-primary font-medium hover:underline"
          >
            ← Edit details
          </button>
        </section>
      )}

      {/* Sticky action bar */}
      <div className="fixed bottom-0 inset-x-0 z-40 border-t border-outline-variant/80 bg-white/95 backdrop-blur-md safe-bottom shadow-[0_-4px_24px_rgba(0,0,0,0.06)]">
        <div className="max-w-xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-on-surface-variant">
              {birdCount > 0
                ? `${birdCount} bird${birdCount === 1 ? "" : "s"}`
                : "No chicks yet"}
            </p>
            <p className="text-xl font-extrabold text-on-surface truncate">
              {formatMoney(total)}
            </p>
          </div>
          {step === 1 && (
            <button
              type="button"
              onClick={goDetails}
              className="shrink-0 min-h-12 px-6 bg-primary text-white font-semibold rounded-2xl touch-manipulation disabled:opacity-50"
              disabled={birdCount === 0}
            >
              Continue
            </button>
          )}
          {step === 2 && (
            <button
              type="button"
              onClick={goConfirm}
              className="shrink-0 min-h-12 px-6 bg-primary text-white font-semibold rounded-2xl touch-manipulation"
            >
              Review
            </button>
          )}
          {step === 3 && (
            <button
              type="button"
              onClick={() => onSubmit()}
              disabled={submitting}
              className="shrink-0 min-h-12 px-6 bg-tertiary-container text-white font-semibold rounded-2xl touch-manipulation disabled:opacity-60"
            >
              {submitting ? "Sending…" : "Place order"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
