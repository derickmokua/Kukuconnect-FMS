import { loadJson, saveJson } from "./storage";
import { ITEM_IDS } from "./inventory";

export const ORDERS_STORAGE_KEY = "kukuconnect-farmer-orders";

export type OrderStatus = "pending" | "paid" | "fulfilled" | "cancelled";
export type Breed = "kuroiler" | "rainbow_rooster";
export type ChickAge = "day_old" | "week_3";
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

/** Sellable catalogue for rural Kitui farmers */
export const ORDER_PRODUCTS: OrderProduct[] = [
  {
    id: "day-old-kuroiler",
    breed: "kuroiler",
    age: "day_old",
    itemId: ITEM_IDS.dayOld,
    name: "Day-old Kuroiler",
    unitPrice: 150,
    blurb: "Strong dual-purpose · ready after hatch",
  },
  {
    id: "day-old-rainbow",
    breed: "rainbow_rooster",
    age: "day_old",
    itemId: ITEM_IDS.dayOld,
    name: "Day-old Rainbow Rooster",
    unitPrice: 150,
    blurb: "Hardy layers/broilers for villages",
  },
  {
    id: "week3-kuroiler",
    breed: "kuroiler",
    age: "week_3",
    itemId: ITEM_IDS.week3,
    name: "3-week Kuroiler",
    unitPrice: 350,
    blurb: "Vaccinated window · lower early mortality",
  },
  {
    id: "week3-rainbow",
    breed: "rainbow_rooster",
    age: "week_3",
    itemId: ITEM_IDS.week3,
    name: "3-week Rainbow Rooster",
    unitPrice: 350,
    blurb: "Grown past fragile first weeks",
  },
];

export function breedLabel(breed: Breed): string {
  return breed === "kuroiler" ? "Kuroiler" : "Rainbow Rooster";
}

export function ageLabel(age: ChickAge): string {
  return age === "day_old" ? "Day-old" : "3 weeks";
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
