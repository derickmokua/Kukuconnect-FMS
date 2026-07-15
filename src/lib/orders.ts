import { loadJson, saveJson } from "./storage";
import { ITEM_IDS } from "./inventory";

export const ORDERS_STORAGE_KEY = "kukuconnect-farmer-orders";

export type OrderStatus = "pending" | "paid" | "fulfilled" | "cancelled";
export type Breed = "kuroiler" | "rainbow_rooster";
export type ChickAge = "day_old" | "week_1" | "week_2" | "week_3" | "week_4";
export type OrderSource = "web" | "admin" | "whatsapp" | "phone";

export interface OrderLine {
  breed: Breed;
  age: ChickAge;
  itemId: string;
  name: string;
  qty: number;
  unitPrice: number;
}

export interface FarmerOrder {
  id: string;
  createdAt: string;
  customerName: string;
  customerPhone: string;
  location: string;
  notes: string;
  items: OrderLine[];
  total: number;
  status: OrderStatus;
  paymentRef: string;
  paidAt: string | null;
  fulfilledAt: string | null;
  source: OrderSource;
}

export interface OrderProduct {
  id: string;
  breed: Breed;
  age: ChickAge;
  itemId: string;
  name: string;
  unitPrice: number;
  blurb: string;
}

/**
 * Sellable catalogue for the public order form (app.kukuconnect.co.ke/order).
 * Prices match kukuconnect.co.ke GrowthTimeline chick stages:
 * Day Old 110 · 1 Week 130 · 2 Weeks 160 · 3 Weeks 190 · 4 Weeks 250
 */
export const ORDER_PRODUCTS: OrderProduct[] = [
  {
    id: "day-old-chicks",
    breed: "kuroiler",
    age: "day_old",
    itemId: ITEM_IDS.dayOld,
    name: "Day-old Chicks",
    unitPrice: 110,
    blurb: "Freshly hatched · requires brooder heat & care",
  },
  {
    id: "1-week-chicks",
    breed: "kuroiler",
    age: "week_1",
    itemId: ITEM_IDS.week1,
    name: "1-week-old Chicks",
    unitPrice: 130,
    blurb: "Active and alert · starter feed",
  },
  {
    id: "2-weeks-chicks",
    breed: "kuroiler",
    age: "week_2",
    itemId: ITEM_IDS.week2,
    name: "2-weeks-old Chicks",
    unitPrice: 160,
    blurb: "Strong immunity · past high early risk",
  },
  {
    id: "3-weeks-chicks",
    breed: "kuroiler",
    age: "week_3",
    itemId: ITEM_IDS.week3,
    name: "3-weeks-old Chicks",
    unitPrice: 190,
    blurb: "Feathering well · Newcastle vaccinated",
  },
  {
    id: "4-weeks-chicks",
    breed: "kuroiler",
    age: "week_4",
    itemId: ITEM_IDS.month1,
    name: "4-weeks-old (1 Month) Chicks",
    unitPrice: 250,
    blurb: "Hardened · ready for the outside coop",
  },
];

export function breedLabel(breed: Breed): string {
  return breed === "kuroiler" ? "Kuroiler" : "Rainbow Rooster";
}

export function ageLabel(age: ChickAge): string {
  const labels: Record<ChickAge, string> = {
    day_old: "Day-old",
    week_1: "1 week",
    week_2: "2 weeks",
    week_3: "3 weeks",
    week_4: "4 weeks (1 month)",
  };
  return labels[age];
}

export function statusLabel(status: OrderStatus): string {
  const map: Record<OrderStatus, string> = {
    pending: "Pending payment",
    paid: "Paid",
    fulfilled: "Fulfilled",
    cancelled: "Cancelled",
  };
  return map[status];
}

export function loadOrdersLocal(): FarmerOrder[] {
  return loadJson<FarmerOrder[]>(ORDERS_STORAGE_KEY, []);
}

export function saveOrdersLocal(orders: FarmerOrder[]): void {
  saveJson(ORDERS_STORAGE_KEY, orders.slice(0, 1000));
}

export function createOrder(input: {
  customerName: string;
  customerPhone: string;
  location?: string;
  notes?: string;
  items: OrderLine[];
  source?: OrderSource;
}): FarmerOrder {
  const items = input.items.filter((i) => i.qty > 0);
  const total = items.reduce((s, i) => s + i.qty * i.unitPrice, 0);
  return {
    id: `ord-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    createdAt: new Date().toISOString(),
    customerName: input.customerName.trim(),
    customerPhone: input.customerPhone.trim(),
    location: input.location?.trim() ?? "",
    notes: input.notes?.trim() ?? "",
    items,
    total,
    status: "pending",
    paymentRef: "",
    paidAt: null,
    fulfilledAt: null,
    source: input.source ?? "web",
  };
}

export function lineFromProduct(
  product: OrderProduct,
  qty: number
): OrderLine {
  return {
    breed: product.breed,
    age: product.age,
    itemId: product.itemId,
    name: product.name,
    qty: Math.max(0, Math.floor(qty)),
    unitPrice: product.unitPrice,
  };
}

export function markPaid(
  order: FarmerOrder,
  paymentRef?: string
): FarmerOrder {
  return {
    ...order,
    status: "paid",
    paymentRef: paymentRef?.trim() || order.paymentRef,
    paidAt: new Date().toISOString(),
  };
}

export function markFulfilled(order: FarmerOrder): FarmerOrder {
  return {
    ...order,
    status: "fulfilled",
    fulfilledAt: new Date().toISOString(),
  };
}

export function markCancelled(order: FarmerOrder): FarmerOrder {
  return {
    ...order,
    status: "cancelled",
  };
}

export function pendingOrders(orders: FarmerOrder[]): FarmerOrder[] {
  return orders.filter((o) => o.status === "pending");
}

export function formatMoney(amount: number): string {
  return `KSh ${amount.toLocaleString()}`;
}

/** WhatsApp deep-link for staff to message farmer after order */
export function farmerWhatsAppUrl(order: FarmerOrder, message?: string): string {
  const phone = order.customerPhone.replace(/[^\d+]/g, "").replace(/^\+/, "");
  let normalized = phone.startsWith("0")
    ? `254${phone.slice(1)}`
    : phone;
  if (normalized.startsWith("7") && normalized.length === 9) {
    normalized = `254${normalized}`;
  }
  const defaultMsg =
    message ??
    `Habari ${order.customerName}, your KukuConnect order ${order.id} total ${formatMoney(order.total)} is being processed. Asante!`;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(defaultMsg)}`;
}

export function mpesaTillHint(): string {
  return process.env.NEXT_PUBLIC_MPESA_TILL || "YOUR TILL / PAYBILL";
}
