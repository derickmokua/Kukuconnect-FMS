import type { FarmerOrder } from "./orders";
import { formatMoney, mpesaTillHint } from "./orders";

export type NotifyEvent =
  | "order_received"
  | "payment_confirmed"
  | "ready_pickup"
  | "cancelled"
  | "staff_new_order";

export interface NotifyPrefs {
  /** Open WhatsApp deep-link after status changes (works without AT keys) */
  autoWhatsApp: boolean;
  /** Try Africa's Talking SMS when server keys are configured */
  trySms: boolean;
  /** Also alert staff phone when a new public order arrives */
  alertStaffOnNewOrder: boolean;
}

export const DEFAULT_NOTIFY_PREFS: NotifyPrefs = {
  autoWhatsApp: true,
  trySms: true,
  alertStaffOnNewOrder: true,
};

export const NOTIFY_PREFS_KEY = "kukuconnect-notify-prefs";

/** Normalize Kenyan numbers to 2547XXXXXXXX for wa.me / AT */
export function normalizeKenyaPhone(raw: string): string | null {
  let phone = raw.replace(/[^\d+]/g, "").replace(/^\+/, "");
  if (!phone) return null;
  if (phone.startsWith("0") && phone.length >= 10) {
    phone = `254${phone.slice(1)}`;
  }
  if (phone.startsWith("7") && phone.length === 9) {
    phone = `254${phone}`;
  }
  if (phone.startsWith("1") && phone.length === 9) {
    phone = `254${phone}`;
  }
  // 254 + 9 digits
  if (!/^254\d{9}$/.test(phone)) return null;
  return phone;
}

export function itemsSummary(order: FarmerOrder): string {
  return order.items.map((i) => `${i.name} x${i.qty}`).join(", ");
}

export function buildMessage(
  event: NotifyEvent,
  order: FarmerOrder
): string {
  const till = mpesaTillHint();
  const items = itemsSummary(order);
  const name = order.customerName || "farmer";
  const total = formatMoney(order.total);

  switch (event) {
    case "order_received":
      return (
        `Habari ${name}! Order yako ya KukuConnect imepokelewa.\n` +
        `ID: ${order.id}\n` +
        `${items}\n` +
        `Jumla: ${total}\n` +
        `Lipa M-Pesa Till/Paybill: ${till}\n` +
        `Baada ya kulipa, shika ujumbe. Tutathibitisha. Asante! — KukuConnect Kitui`
      );
    case "payment_confirmed":
      return (
        `Habari ${name}! Malipo yako yamethibitishwa.\n` +
        `Order: ${order.id}\n` +
        `${items}\n` +
        `Jumla: ${total}` +
        (order.paymentRef ? `\nRef: ${order.paymentRef}` : "") +
        `\nTutakuarifu ukiwa tayari kuchukua. Asante! — KukuConnect`
      );
    case "ready_pickup":
      return (
        `Habari ${name}! Kuku zako tayari.\n` +
        `Order: ${order.id}\n` +
        `${items}\n` +
        `Tafadhali fika kuchukua / panga delivery. — KukuConnect Kitui`
      );
    case "cancelled":
      return (
        `Habari ${name}. Order ${order.id} imefutwa.\n` +
        `Wasiliana nasi kama unahitaji kusaidiwa. — KukuConnect Kitui`
      );
    case "staff_new_order":
      return (
        `NEW ORDER KukuConnect\n` +
        `${name} · ${order.customerPhone}\n` +
        `${items}\n` +
        `Total ${total}\n` +
        `ID ${order.id}` +
        (order.location ? `\n@ ${order.location}` : "")
      );
    default:
      return `KukuConnect update for order ${order.id}`;
  }
}

export function whatsAppUrl(phoneRaw: string, message: string): string | null {
  const phone = normalizeKenyaPhone(phoneRaw);
  if (!phone) return null;
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

export function orderWhatsAppUrl(
  order: FarmerOrder,
  event: NotifyEvent
): string | null {
  return whatsAppUrl(order.customerPhone, buildMessage(event, order));
}

export function eventLabel(event: NotifyEvent): string {
  const map: Record<NotifyEvent, string> = {
    order_received: "Order received + pay instructions",
    payment_confirmed: "Payment confirmed",
    ready_pickup: "Chicks ready / pickup",
    cancelled: "Order cancelled",
    staff_new_order: "Staff: new order alert",
  };
  return map[event];
}
