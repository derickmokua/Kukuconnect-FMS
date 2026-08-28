"use client";

import { FormEvent, useMemo, useState, useEffect } from "react";
import {
  type FarmerOrder,
  ORDER_PRODUCTS,
  createOrder,
  formatMoney,
  lineFromProduct,
  mpesaTillHint,
} from "@/lib/orders";
import { loadItems } from "@/lib/inventory";
import { insertOrder } from "@/lib/data/ordersRepo";
import {
  notifyFarmer,
  notifyStaffNewOrder,
  openOrderWhatsApp,
  staffWhatsAppUrl,
} from "@/lib/notifyClient";
import { orderWhatsAppUrl } from "@/lib/notifications";

type Step = 1 | 2 | 3;

// Icons
const CheckIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
    <polyline points="20 6 9 17 4 12"></polyline>
  </svg>
);

const CheckCircleIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-16 h-16 text-emerald-500">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
    <polyline points="22 4 12 14.01 9 11.01"></polyline>
  </svg>
);

const UserIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 opacity-60">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
    <circle cx="12" cy="7" r="4"></circle>
  </svg>
);

const PhoneIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 opacity-60">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
  </svg>
);

const MapPinIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 opacity-60">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
    <circle cx="12" cy="10" r="3"></circle>
  </svg>
);


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

  const [phoneTouched, setPhoneTouched] = useState(false);
  const [cartLoaded, setCartLoaded] = useState(false);
  const [stockLevels, setStockLevels] = useState<Record<string, number>>({});

  // Validation
  const isPhoneValid = phone.trim() === "" ? false : /^(?:254|\+254|0)?([17]\d{8})$/.test(phone.replace(/\s+/g, ''));

  // Load cart and inventory on mount
  useEffect(() => {
    // Load inventory
    const items = loadItems();
    const levels: Record<string, number> = {};
    items.forEach(i => levels[i.id] = i.quantity);
    setStockLevels(levels);

    // Load cart
    try {
      const saved = localStorage.getItem("kukuconnect-cart");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.qty) setQty(parsed.qty);
        if (parsed.name) setName(parsed.name);
        if (parsed.phone) setPhone(parsed.phone);
        if (parsed.location) setLocation(parsed.location);
        if (parsed.notes) setNotes(parsed.notes);
      }
    } catch (e) {
      // Ignore errors
    } finally {
      setCartLoaded(true);
    }
  }, []);

  // Save cart on change
  useEffect(() => {
    if (cartLoaded && !doneOrder) {
      localStorage.setItem(
        "kukuconnect-cart",
        JSON.stringify({ qty, name, phone, location, notes })
      );
    }
  }, [cartLoaded, doneOrder, qty, name, phone, location, notes]);

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
    const p = ORDER_PRODUCTS.find(x => x.id === id);
    if (!p) return;
    const maxStock = stockLevels[p.itemId] ?? 0;
    const n = Math.max(0, Math.min(maxStock, Math.floor(next) || 0));
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
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setStep(2);
  };

  const goConfirm = () => {
    setError("");
    setPhoneTouched(true);
    if (!name.trim() || !phone.trim() || !isPhoneValid) {
      setError("Jina na nambari ya simu sahihi zinahitajika / Name and valid phone required.");
      return;
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setStep(3);
  };

  const onSubmit = async (e?: FormEvent) => {
    e?.preventDefault();
    setError("");
    setPhoneTouched(true);
    if (!name.trim() || !phone.trim() || !isPhoneValid) {
      setError("Jina na nambari ya simu sahihi zinahitajika / Name and valid phone required.");
      setStep(2);
      return;
    }
    if (lines.length === 0) {
      setError("Chagua angalau kuku moja / Select at least one product.");
      setStep(1);
      return;
    }
    
    // Final stock validation before saving
    const currentStock = loadItems();
    for (const line of lines) {
      const inventoryItem = currentStock.find(i => i.id === line.itemId);
      if (!inventoryItem || inventoryItem.quantity < line.qty) {
        setError(`Sorry, ${line.name} only has ${inventoryItem?.quantity || 0} in stock right now.`);
        setStep(1);
        return;
      }
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
      localStorage.removeItem("kukuconnect-cart"); // Clear cart on success

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
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Order failed. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (doneOrder) {
    const waStaff = staffWhatsAppUrl(doneOrder);

    return (
      <div className="max-w-xl mx-auto px-4 py-8 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="flex flex-col items-center text-center space-y-4">
          <CheckCircleIcon />
          <h1 className="text-3xl font-bold text-on-surface">Order Received!</h1>
          <p className="text-on-surface-variant text-lg">
            Asante, <span className="font-semibold text-on-surface">{doneOrder.customerName}</span>. Your chicks are reserved.
          </p>
        </div>

        <div className="bg-white rounded-3xl p-6 shadow-sm border border-outline-variant space-y-6">
          <div className="flex justify-between items-center pb-4 border-b border-outline-variant">
            <span className="text-on-surface-variant">Order ID</span>
            <span className="font-mono font-semibold text-on-surface">{doneOrder.id}</span>
          </div>

          <div className="space-y-3">
            {doneOrder.items.map((l) => (
              <div key={`${l.name}-${l.qty}`} className="flex justify-between items-center text-on-surface">
                <span className="font-medium">
                  {l.qty} × {l.name}
                </span>
                <span>{formatMoney(l.qty * l.unitPrice)}</span>
              </div>
            ))}
          </div>

          <div className="pt-4 border-t border-outline-variant flex justify-between items-center">
            <span className="text-on-surface-variant font-medium">Total to pay</span>
            <span className="text-2xl font-extrabold text-primary">{formatMoney(doneOrder.total)}</span>
          </div>
        </div>

        <div className="bg-emerald-50 rounded-3xl p-6 border border-emerald-100 space-y-3">
          <p className="font-bold text-emerald-900 flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
            </svg>
            Lipa na M-Pesa
          </p>
          <div className="bg-white/60 rounded-xl p-3 flex justify-between items-center">
            <span className="text-emerald-800">Till / Paybill</span>
            <span className="text-emerald-900 font-bold text-lg tracking-wider">{till}</span>
          </div>
          <p className="text-emerald-800/80 text-sm">
            After paying, keep the M-Pesa message. We will confirm your order.
          </p>
        </div>

        <div className="space-y-3">
          {orderWhatsAppUrl(doneOrder, "order_received") && (
            <button
              type="button"
              onClick={() => openOrderWhatsApp(doneOrder, "order_received")}
              className="w-full h-14 bg-[#25D366] text-white font-semibold rounded-2xl touch-manipulation hover:bg-[#20bd5a] transition-colors flex items-center justify-center gap-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 00-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
              Save info to WhatsApp
            </button>
          )}
          {waStaff && (
            <a
              href={waStaff}
              target="_blank"
              rel="noreferrer"
              className="w-full h-14 bg-surface-container-highest text-on-surface font-semibold rounded-2xl touch-manipulation hover:bg-surface-container transition-colors flex items-center justify-center gap-2"
            >
              Message us for help
            </a>
          )}
        </div>

        {notifyNote && (
          <p className="text-center text-sm text-on-surface-variant opacity-70">
            {notifyNote}
          </p>
        )}

        <div className="pt-8 text-center">
          <button
            type="button"
            className="text-primary font-semibold hover:underline"
            onClick={() => {
              setDoneOrder(null);
              setNotifyNote("");
              setStep(1);
              setQty(Object.fromEntries(ORDER_PRODUCTS.map((p) => [p.id, 0])));
              setNotes("");
              setPhoneTouched(false);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          >
            Place another order
          </button>
        </div>
      </div>
    );
  }

  const steps = [
    { n: 1 as Step, label: "Choose chicks" },
    { n: 2 as Step, label: "Your details" },
    { n: 3 as Step, label: "Review" },
  ];

  return (
    <div className="max-w-xl mx-auto min-h-screen bg-surface flex flex-col">
      <div className="px-4 py-6 space-y-6 flex-1 pb-32">
        {/* Progress Component */}
        <nav aria-label="Progress" className="mb-8">
          <div className="flex items-center justify-between relative">
            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-full h-0.5 bg-surface-container -z-10 rounded-full"></div>
            {steps.map((s) => {
              const isCompleted = step > s.n;
              const isCurrent = step === s.n;
              return (
                <div key={s.n} className="flex flex-col items-center gap-2 bg-surface px-1">
                  <button
                    type="button"
                    disabled={s.n > step}
                    onClick={() => {
                      if (s.n < step) setStep(s.n);
                    }}
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                      isCompleted
                        ? "bg-primary text-white"
                        : isCurrent
                          ? "bg-primary text-white ring-4 ring-primary/20"
                          : "bg-surface-container text-on-surface-variant"
                    }`}
                  >
                    {isCompleted ? <CheckIcon /> : s.n}
                  </button>
                  <span className={`text-[11px] font-semibold uppercase tracking-wider ${isCurrent ? 'text-primary' : isCompleted ? 'text-on-surface' : 'text-on-surface-variant'}`}>
                    {s.label}
                  </span>
                </div>
              );
            })}
          </div>
        </nav>

        {error && (
          <div className="bg-error-container/50 border border-error/20 text-error rounded-2xl p-4 text-sm font-medium animate-in fade-in slide-in-from-top-2">
            {error}
          </div>
        )}

        {/* Step 1 — products */}
        {step === 1 && (
          <section className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
            <header className="space-y-1">
              <h2 className="text-2xl font-extrabold text-on-surface">
                What are you looking for?
              </h2>
              <p className="text-on-surface-variant text-base">
                Select the chicks you want to order today.
              </p>
            </header>
            
            <div className="space-y-4">
              {ORDER_PRODUCTS.map((p) => {
                const q = qty[p.id] || 0;
                const isSelected = q > 0;
                const itemStock = stockLevels[p.itemId] ?? 0;
                const isOutOfStock = itemStock <= 0;
                
                return (
                  <div
                    key={p.id}
                    className={`relative overflow-hidden transition-all duration-300 rounded-3xl border-2 ${
                      isOutOfStock ? "opacity-60 grayscale-[50%] border-outline-variant/50 bg-surface" :
                      isSelected
                        ? "border-primary bg-primary/5 shadow-md shadow-primary/5"
                        : "border-outline-variant bg-surface"
                    }`}
                  >
                    {/* Selected Check Indicator */}
                    {isSelected && !isOutOfStock && (
                      <div className="absolute top-0 right-0 bg-primary text-white p-1 rounded-bl-xl z-10">
                        <CheckIcon />
                      </div>
                    )}
                    
                    <div className="p-5 flex flex-col sm:flex-row gap-5">
                      <div className="flex-1 space-y-3">
                        <div className="flex gap-4 items-start">
                          <div className={`w-20 h-20 rounded-2xl overflow-hidden shrink-0 border border-outline-variant/30 ${isSelected && !isOutOfStock ? 'shadow-sm' : ''}`}>
                            {p.imageUrl ? (
                              <img src={p.imageUrl} alt={p.name} className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center bg-surface-container-lowest text-3xl">
                                {p.age === 'egg' ? '🥚' : '🐔'}
                              </div>
                            )}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="font-bold text-lg text-on-surface leading-tight">{p.name}</h3>
                              {isOutOfStock && (
                                <span className="px-2 py-0.5 bg-error/10 text-error text-[10px] font-bold uppercase tracking-wider rounded-md whitespace-nowrap">
                                  Out of Stock
                                </span>
                              )}
                            </div>
                            <div className="inline-block px-2 py-0.5 mt-1.5 bg-surface-container rounded-md text-xs font-semibold text-on-surface-variant uppercase tracking-wider">
                              {p.blurb}
                            </div>
                          </div>
                        </div>
                        
                        <div className="pt-2">
                          <span className="text-2xl font-extrabold text-primary">{formatMoney(p.unitPrice)}</span>
                          <span className="text-sm font-medium text-on-surface-variant ml-1">/ chick</span>
                        </div>
                      </div>

                      <div className={`flex flex-col justify-end items-center sm:items-end gap-3 pt-4 sm:pt-0 border-t sm:border-t-0 border-outline-variant/50 ${isOutOfStock ? 'pointer-events-none opacity-50' : ''}`}>
                        <div className="flex items-center gap-2 bg-white rounded-2xl p-1.5 shadow-sm border border-outline-variant/50">
                          <button
                            type="button"
                            onClick={() => bump(p.id, -1)}
                            disabled={q <= 0 || isOutOfStock}
                            className="w-12 h-12 rounded-xl bg-surface-container-lowest text-on-surface text-2xl font-medium disabled:opacity-30 touch-manipulation active:scale-95 transition-transform flex items-center justify-center"
                          >
                            −
                          </button>
                          <div className="flex flex-col items-center w-14">
                            <span className="block text-[10px] font-bold text-on-surface-variant uppercase mb-0.5">Qty</span>
                            <input
                              type="number"
                              min={0}
                              max={itemStock}
                              disabled={isOutOfStock}
                              inputMode="numeric"
                              aria-label={`Quantity of ${p.name}`}
                              className="w-full h-8 bg-transparent text-center text-xl font-bold text-on-surface leading-none outline-none appearance-none p-0 focus:ring-0 focus:bg-primary/5 rounded-md transition-colors"
                              style={{ MozAppearance: 'textfield' }}
                              value={q || ""}
                              placeholder="0"
                              onChange={(e) =>
                                setProductQty(p.id, Number(e.target.value))
                              }
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => bump(p.id, 1)}
                            disabled={q >= itemStock || isOutOfStock}
                            className="w-12 h-12 rounded-xl bg-primary/10 text-primary text-2xl font-medium touch-manipulation active:scale-95 transition-transform flex items-center justify-center disabled:opacity-30 disabled:active:scale-100"
                          >
                            +
                          </button>
                        </div>
                        
                        <div className={`text-sm font-semibold transition-opacity duration-300 ${isSelected ? 'opacity-100' : 'opacity-0'}`}>
                          Subtotal: <span className="text-primary">{formatMoney(q * p.unitPrice)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Step 2 — details */}
        {step === 2 && (
          <section className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
            <header className="space-y-1">
              <h2 className="text-2xl font-extrabold text-on-surface">
                Tell us where to find you
              </h2>
              <p className="text-on-surface-variant text-base">
                Just a few details so we can confirm your order.
              </p>
            </header>

            <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); goConfirm(); }}>
              {/* Datalist for Kenyan towns */}
              <datalist id="kenya-towns">
                <option value="Kitui" />
                <option value="Mwingi" />
                <option value="Mutomo" />
                <option value="Machakos" />
                <option value="Nairobi" />
                <option value="Mombasa" />
                <option value="Nakuru" />
                <option value="Eldoret" />
                <option value="Kisumu" />
                <option value="Thika" />
                <option value="Embu" />
                <option value="Meru" />
              </datalist>

              <div className="space-y-4">
                <h3 className="text-sm font-bold uppercase tracking-widest text-on-surface-variant pl-1">Personal Details</h3>
                <div className="bg-white border border-outline-variant rounded-3xl p-2 shadow-sm space-y-2">
                  <div className="relative group">
                    <div className="absolute inset-y-0 top-2 left-4 flex items-center pointer-events-none text-on-surface-variant group-focus-within:text-primary transition-colors z-10 h-10">
                      <UserIcon />
                    </div>
                    <input
                      id="input-name"
                      required
                      className="peer w-full h-14 pt-4 pb-1 pl-12 pr-4 bg-transparent rounded-2xl outline-none focus:bg-primary/5 transition-colors text-on-surface font-medium placeholder-transparent"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Full name"
                      autoComplete="name"
                      enterKeyHint="next"
                    />
                    <label 
                      htmlFor="input-name"
                      className="absolute left-12 top-4 -translate-y-1/2 text-on-surface-variant/70 text-base transition-all duration-200 pointer-events-none 
                                 peer-focus:top-3 peer-focus:text-[10px] peer-focus:text-primary font-medium
                                 peer-[:not(:placeholder-shown)]:top-3 peer-[:not(:placeholder-shown)]:text-[10px]"
                    >
                      Full name
                    </label>
                  </div>
                  
                  <div className="h-px bg-outline-variant/50 mx-4" />
                  
                  <div className="relative group">
                    <div className={`absolute inset-y-0 top-2 left-4 flex items-center pointer-events-none transition-colors z-10 h-10 ${phoneTouched && !isPhoneValid && phone.length > 0 ? 'text-error' : 'text-on-surface-variant group-focus-within:text-primary'}`}>
                      <PhoneIcon />
                    </div>
                    <input
                      id="input-phone"
                      required
                      type="tel"
                      inputMode="tel"
                      className={`peer w-full h-14 pt-4 pb-1 pl-12 pr-10 bg-transparent rounded-2xl outline-none focus:bg-primary/5 transition-colors text-on-surface font-medium placeholder-transparent ${phoneTouched && !isPhoneValid && phone.length > 0 ? 'border border-error/50 bg-error/5' : ''}`}
                      value={phone}
                      onChange={(e) => {
                        setPhone(e.target.value);
                      }}
                      onBlur={() => setPhoneTouched(true)}
                      placeholder="Phone number"
                      autoComplete="tel"
                      enterKeyHint="next"
                    />
                    <label 
                      htmlFor="input-phone"
                      className={`absolute left-12 top-4 -translate-y-1/2 text-base transition-all duration-200 pointer-events-none 
                                 peer-focus:top-3 peer-focus:text-[10px] font-medium
                                 peer-[:not(:placeholder-shown)]:top-3 peer-[:not(:placeholder-shown)]:text-[10px]
                                 ${phoneTouched && !isPhoneValid && phone.length > 0 ? 'text-error' : 'text-on-surface-variant/70 peer-focus:text-primary'}`}
                    >
                      Phone (M-Pesa / WhatsApp)
                    </label>
                    {phone.length > 0 && isPhoneValid && (
                      <div className="absolute inset-y-0 top-2 right-4 flex items-center pointer-events-none text-emerald-500 h-10 animate-in zoom-in">
                        <CheckIcon />
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-sm font-bold uppercase tracking-widest text-on-surface-variant pl-1">Location</h3>
                <div className="bg-white border border-outline-variant rounded-3xl p-2 shadow-sm">
                  <div className="relative group">
                    <div className="absolute inset-y-0 top-2 left-4 flex items-center pointer-events-none text-on-surface-variant group-focus-within:text-primary transition-colors z-10 h-10">
                      <MapPinIcon />
                    </div>
                    <input
                      id="input-location"
                      list="kenya-towns"
                      className="peer w-full h-14 pt-4 pb-1 pl-12 pr-4 bg-transparent rounded-2xl outline-none focus:bg-primary/5 transition-colors text-on-surface font-medium placeholder-transparent"
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      placeholder="Village, town, or market"
                      enterKeyHint="next"
                    />
                    <label 
                      htmlFor="input-location"
                      className="absolute left-12 top-4 -translate-y-1/2 text-on-surface-variant/70 text-base transition-all duration-200 pointer-events-none 
                                 peer-focus:top-3 peer-focus:text-[10px] peer-focus:text-primary font-medium
                                 peer-[:not(:placeholder-shown)]:top-3 peer-[:not(:placeholder-shown)]:text-[10px]"
                    >
                      Village, town, or market
                    </label>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-sm font-bold uppercase tracking-widest text-on-surface-variant pl-1">Optional</h3>
                <div className="bg-white border border-outline-variant rounded-3xl p-2 shadow-sm">
                  <div className="relative group">
                    <textarea
                      id="input-notes"
                      className="peer w-full min-h-[100px] pt-6 pb-2 px-4 bg-transparent rounded-2xl outline-none focus:bg-primary/5 transition-colors text-on-surface font-medium placeholder-transparent resize-y"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Any additional notes?"
                      enterKeyHint="done"
                    />
                    <label 
                      htmlFor="input-notes"
                      className="absolute left-4 top-4 -translate-y-1/2 text-on-surface-variant/70 text-base transition-all duration-200 pointer-events-none 
                                 peer-focus:top-3 peer-focus:text-[10px] peer-focus:text-primary font-medium
                                 peer-[:not(:placeholder-shown)]:top-3 peer-[:not(:placeholder-shown)]:text-[10px]"
                    >
                      Any additional notes?
                    </label>
                  </div>
                </div>
              </div>
              
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => { window.scrollTo({ top: 0, behavior: 'smooth' }); setStep(1); }}
                  className="h-14 px-6 bg-surface-container-highest text-on-surface font-semibold rounded-2xl touch-manipulation active:scale-95 transition-transform"
                >
                  Back
                </button>
                <button
                  type="submit"
                  className="flex-1 h-14 bg-primary text-white font-semibold rounded-2xl touch-manipulation active:scale-95 transition-transform shadow-md shadow-primary/20"
                >
                  Continue to review
                </button>
              </div>
            </form>
          </section>
        )}

        {/* Step 3 — confirm */}
        {step === 3 && (
          <section className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
            <header className="space-y-1">
              <h2 className="text-2xl font-extrabold text-on-surface">
                Review your order
              </h2>
              <p className="text-on-surface-variant text-base">
                Almost done — check everything looks right.
              </p>
            </header>

            <div className="bg-white border border-outline-variant rounded-3xl overflow-hidden shadow-sm">
              <div className="p-6 space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">Products</h3>
                <div className="space-y-3">
                  {lines.map((l) => (
                    <div key={l.name} className="flex justify-between items-center text-on-surface">
                      <div className="flex items-center gap-3">
                        <span className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm">
                          {l.qty}
                        </span>
                        <span className="font-medium">{l.name}</span>
                      </div>
                      <span className="font-semibold">{formatMoney(l.qty * l.unitPrice)}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-surface-container-lowest p-6 border-t border-outline-variant space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-widest text-on-surface-variant flex justify-between items-center">
                  Your Details
                  <button onClick={() => setStep(2)} className="text-primary normal-case font-semibold hover:underline">Edit</button>
                </h3>
                <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-sm">
                  <div className="space-y-1">
                    <p className="text-on-surface-variant">Name</p>
                    <p className="font-semibold text-on-surface">{name}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-on-surface-variant">Phone</p>
                    <p className="font-semibold text-on-surface">{phone}</p>
                  </div>
                  {location && (
                    <div className="space-y-1 col-span-2">
                      <p className="text-on-surface-variant">Location</p>
                      <p className="font-semibold text-on-surface">{location}</p>
                    </div>
                  )}
                  {notes && (
                    <div className="space-y-1 col-span-2">
                      <p className="text-on-surface-variant">Notes</p>
                      <p className="font-semibold text-on-surface">{notes}</p>
                    </div>
                  )}
                </div>
              </div>
              
              <div className="p-6 border-t border-outline-variant bg-primary/5">
                <div className="flex justify-between items-end">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-widest text-primary/80 mb-1">Order Total</p>
                    <p className="text-sm font-medium text-on-surface-variant">{birdCount} birds</p>
                  </div>
                  <p className="text-3xl font-extrabold text-primary">{formatMoney(total)}</p>
                </div>
              </div>
            </div>

            {/* Trust Badges */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-emerald-50/50 border border-emerald-100 rounded-2xl p-4 flex flex-col items-center text-center gap-2">
                <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
                </div>
                <div>
                  <h4 className="text-xs font-bold text-emerald-900">Guaranteed Quality</h4>
                  <p className="text-[10px] text-emerald-800/80">Healthy, vaccinated birds</p>
                </div>
              </div>
              <div className="bg-primary/5 border border-primary/10 rounded-2xl p-4 flex flex-col items-center text-center gap-2">
                <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
                  </svg>
                </div>
                <div>
                  <h4 className="text-xs font-bold text-primary">Secure Checkout</h4>
                  <p className="text-[10px] text-on-surface-variant">Pay safely via M-Pesa</p>
                </div>
              </div>
            </div>

            <div className="space-y-4 pb-8">
              <p className="text-center text-sm text-on-surface-variant">
                After placing your order, KukuConnect will confirm availability and contact you.
              </p>
              <button
                type="button"
                onClick={onSubmit}
                disabled={submitting}
                className="w-full h-16 bg-primary text-white text-lg font-bold rounded-2xl touch-manipulation active:scale-95 transition-transform shadow-lg shadow-primary/30 flex items-center justify-center gap-2 disabled:opacity-70 disabled:scale-100"
              >
                {submitting ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-2 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Placing your order...
                  </>
                ) : (
                  "Place my order →"
                )}
              </button>
            </div>
          </section>
        )}
      </div>

      {/* Sticky action bar (Step 1 only) */}
      {step === 1 && (
        <div className="fixed bottom-0 inset-x-0 z-40 bg-white/90 backdrop-blur-xl border-t border-outline-variant/50 safe-bottom shadow-[0_-8px_30px_rgba(0,0,0,0.04)] animate-in slide-in-from-bottom-full">
          <div className="max-w-xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
            <div className="flex-1">
              <p className="text-sm font-semibold text-on-surface-variant mb-0.5">
                {birdCount > 0 ? `${birdCount} chicks selected` : "No chicks selected"}
              </p>
              <p className="text-xl font-extrabold text-on-surface leading-none">
                {formatMoney(total)}
              </p>
            </div>
            <button
              type="button"
              onClick={goDetails}
              className="h-14 px-8 bg-primary text-white font-bold rounded-2xl touch-manipulation disabled:opacity-40 disabled:scale-100 active:scale-95 transition-transform shadow-md shadow-primary/20"
              disabled={birdCount === 0}
            >
              Continue →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
