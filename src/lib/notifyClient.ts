import type { FarmerOrder } from "./orders";
import {
  type NotifyEvent,
  type NotifyPrefs,
  DEFAULT_NOTIFY_PREFS,
  NOTIFY_PREFS_KEY,
  buildMessage,
  eventLabel,
  normalizeKenyaPhone,
  orderWhatsAppUrl,
  whatsAppUrl,
} from "./notifications";
import { loadJson, saveJson } from "./storage";

export function loadNotifyPrefs(): NotifyPrefs {
  return loadJson<NotifyPrefs>(NOTIFY_PREFS_KEY, DEFAULT_NOTIFY_PREFS);
}

export function saveNotifyPrefs(prefs: NotifyPrefs): void {
  saveJson(NOTIFY_PREFS_KEY, prefs);
}

export interface NotifyResult {
  event: NotifyEvent;
  whatsappOpened: boolean;
  whatsappUrl: string | null;
  smsSent: boolean;
  smsSkippedReason?: string;
  smsError?: string;
  message: string;
}

/** Open WhatsApp chat with template (zero API cost — works offline/data). */
export function openWhatsApp(
  phone: string,
  message: string
): { opened: boolean; url: string | null } {
  const url = whatsAppUrl(phone, message);
  if (!url || typeof window === "undefined") {
    return { opened: false, url };
  }
  window.open(url, "_blank", "noopener,noreferrer");
  return { opened: true, url };
}

export function openOrderWhatsApp(
  order: FarmerOrder,
  event: NotifyEvent
): { opened: boolean; url: string | null; message: string } {
  const message = buildMessage(event, order);
  const url = orderWhatsAppUrl(order, event);
  if (!url || typeof window === "undefined") {
    return { opened: false, url, message };
  }
  window.open(url, "_blank", "noopener,noreferrer");
  return { opened: true, url, message };
}

/** Call server route → Africa's Talking when configured. */
export async function sendSmsApi(
  phone: string,
  message: string
): Promise<{ ok: boolean; skipped?: boolean; reason?: string; error?: string }> {
  const normalized = normalizeKenyaPhone(phone);
  if (!normalized) {
    return { ok: false, error: "Invalid phone number" };
  }

  try {
    const res = await fetch("/api/notify/sms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: normalized, message }),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      skipped?: boolean;
      reason?: string;
      error?: string;
    };
    if (!res.ok) {
      return {
        ok: false,
        skipped: data.skipped,
        reason: data.reason,
        error: data.error ?? `HTTP ${res.status}`,
      };
    }
    return {
      ok: Boolean(data.ok),
      skipped: data.skipped,
      reason: data.reason,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "SMS request failed",
    };
  }
}

/**
 * Full notify: optional WhatsApp open + optional SMS.
 * Designed for rural ops — WhatsApp-first, SMS when AT keys exist.
 */
export async function notifyFarmer(
  order: FarmerOrder,
  event: NotifyEvent,
  options?: Partial<NotifyPrefs> & { forceWhatsApp?: boolean; forceSms?: boolean }
): Promise<NotifyResult> {
  const prefs = { ...loadNotifyPrefs(), ...options };
  const message = buildMessage(event, order);
  const result: NotifyResult = {
    event,
    whatsappOpened: false,
    whatsappUrl: orderWhatsAppUrl(order, event),
    smsSent: false,
    message,
  };

  if (prefs.autoWhatsApp || options?.forceWhatsApp) {
    const wa = openOrderWhatsApp(order, event);
    result.whatsappOpened = wa.opened;
    result.whatsappUrl = wa.url;
  }

  if (prefs.trySms || options?.forceSms) {
    const sms = await sendSmsApi(order.customerPhone, message);
    if (sms.ok && !sms.skipped) {
      result.smsSent = true;
    } else {
      result.smsSkippedReason = sms.reason ?? sms.error;
      if (sms.error && !sms.skipped) result.smsError = sms.error;
    }
  }

  return result;
}

export function getStaffPhone(): string {
  return (
    process.env.NEXT_PUBLIC_STAFF_PHONE ||
    process.env.NEXT_PUBLIC_KUKUCONNECT_STAFF_PHONE ||
    ""
  );
}

/**
 * Alert staff about a new order.
 * SMS goes server-side (Africa's Talking). WhatsApp is not auto-opened on the
 * farmer's phone (confusing) — use staffWhatsAppUrl() for a tappable link.
 */
export async function notifyStaffNewOrder(
  order: FarmerOrder
): Promise<NotifyResult | null> {
  const prefs = loadNotifyPrefs();
  if (!prefs.alertStaffOnNewOrder) return null;

  const staffPhone = getStaffPhone();
  if (!staffPhone) return null;

  const message = buildMessage("staff_new_order", order);
  const result: NotifyResult = {
    event: "staff_new_order",
    whatsappOpened: false,
    whatsappUrl: whatsAppUrl(staffPhone, message),
    smsSent: false,
    message,
  };

  if (prefs.trySms) {
    const sms = await sendSmsApi(staffPhone, message);
    if (sms.ok && !sms.skipped) result.smsSent = true;
    else result.smsSkippedReason = sms.reason ?? sms.error;
  }

  return result;
}

export function staffWhatsAppUrl(order: FarmerOrder): string | null {
  const staffPhone = getStaffPhone();
  if (!staffPhone) return null;
  return whatsAppUrl(staffPhone, buildMessage("staff_new_order", order));
}

export function describeNotifyResult(r: NotifyResult): string {
  const parts = [eventLabel(r.event)];
  if (r.whatsappOpened) parts.push("WhatsApp opened");
  else if (r.whatsappUrl) parts.push("WhatsApp ready (blocked popup?)");
  if (r.smsSent) parts.push("SMS sent");
  else if (r.smsSkippedReason) parts.push(`SMS: ${r.smsSkippedReason}`);
  else if (r.smsError) parts.push(`SMS error: ${r.smsError}`);
  return parts.join(" · ");
}

export { eventLabel, buildMessage };
