import { loadJson, saveJson } from "./storage";
import { type FarmerOrder } from "./orders";
import { loadOrdersLocal } from "./orders";
import { type Sale, loadSales } from "./sales";
import { todayIsoLocal } from "./brooder";

export const CRM_META_STORAGE_KEY = "kukuconnect-crm-metadata";
export const CRM_FOLLOWUPS_STORAGE_KEY = "kukuconnect-crm-followups-status";

export interface CustomerProfile {
  id: string; // Normalized phone number e.g. 254712345678
  name: string;
  phone: string;
  location: string;
  totalSpend: number;
  totalOrdersCount: number;
  firstSeenDate: string;
  lastSeenDate: string;
  tags: string[];
  notes: string;
  orderIds: string[];
  saleIds: string[];
  totalChicksBought: number;
  favoriteProducts: string[];
}

export type FollowUpMilestoneType =
  | "day3_brooder_check"
  | "day14_booster_feed"
  | "day30_growth_reorder";

export interface FollowUpTask {
  id: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  sourceType: "order" | "sale";
  sourceId: string;
  purchaseDate: string;
  dueDate: string;
  milestone: FollowUpMilestoneType;
  title: string;
  description: string;
  chickSummary: string;
  status: "pending" | "sent" | "dismissed";
  sentAt?: string;
}

export interface CrmMetadata {
  [customerId: string]: {
    tags?: string[];
    notes?: string;
  };
}

export interface FollowUpStatusMap {
  [taskId: string]: {
    status: "sent" | "dismissed";
    updatedAt: string;
  };
}

export function normalizePhoneKey(phone: string): string {
  let cleaned = phone.replace(/[^\d+]/g, "").trim();
  if (cleaned.startsWith("+")) cleaned = cleaned.slice(1);
  if (cleaned.startsWith("0")) cleaned = "254" + cleaned.slice(1);
  if (cleaned.startsWith("7") || cleaned.startsWith("1")) cleaned = "254" + cleaned;
  return cleaned;
}

export function loadCrmMetaLocal(): CrmMetadata {
  return loadJson<CrmMetadata>(CRM_META_STORAGE_KEY, {});
}

export function saveCrmMetaLocal(meta: CrmMetadata): void {
  saveJson(CRM_META_STORAGE_KEY, meta);
}

export function loadFollowUpStatusLocal(): FollowUpStatusMap {
  return loadJson<FollowUpStatusMap>(CRM_FOLLOWUPS_STORAGE_KEY, {});
}

export function saveFollowUpStatusLocal(map: FollowUpStatusMap): void {
  saveJson(CRM_FOLLOWUPS_STORAGE_KEY, map);
}

export function updateCustomerMeta(
  customerId: string,
  patch: { tags?: string[]; notes?: string }
): CrmMetadata {
  const meta = loadCrmMetaLocal();
  meta[customerId] = {
    ...meta[customerId],
    ...patch,
  };
  saveCrmMetaLocal(meta);
  return meta;
}

/**
 * Aggregates all customers from orders and walk-in sales.
 */
export function buildCustomerDirectory(
  orders?: FarmerOrder[],
  sales?: Sale[]
): CustomerProfile[] {
  const allOrders = orders ?? loadOrdersLocal();
  const allSales = sales ?? loadSales();
  const meta = loadCrmMetaLocal();

  const customerMap = new Map<string, {
    name: string;
    phone: string;
    location: string;
    spend: number;
    dates: string[];
    orderIds: string[];
    saleIds: string[];
    productCounts: Map<string, number>;
    chickCount: number;
  }>();

  // Process orders
  for (const o of allOrders) {
    if (!o.customerPhone) continue;
    const key = normalizePhoneKey(o.customerPhone);
    if (!key) continue;

    const existing = customerMap.get(key) ?? {
      name: o.customerName || "Farmer",
      phone: o.customerPhone,
      location: o.location || "",
      spend: 0,
      dates: [],
      orderIds: [],
      saleIds: [],
      productCounts: new Map<string, number>(),
      chickCount: 0,
    };

    if (o.customerName && (!existing.name || existing.name === "Farmer")) {
      existing.name = o.customerName;
    }
    if (o.location && !existing.location) {
      existing.location = o.location;
    }
    existing.spend += o.total || 0;
    existing.dates.push(o.createdAt.slice(0, 10));
    existing.orderIds.push(o.id);

    for (const item of o.items || []) {
      existing.chickCount += item.qty || 0;
      existing.productCounts.set(
        item.name,
        (existing.productCounts.get(item.name) ?? 0) + item.qty
      );
    }

    customerMap.set(key, existing);
  }

  // Process walk-in sales
  for (const s of allSales) {
    if (!s.customerPhone && !s.customerName) continue;
    const key = s.customerPhone ? normalizePhoneKey(s.customerPhone) : `walkin-${s.id}`;
    if (!key) continue;

    const existing = customerMap.get(key) ?? {
      name: s.customerName || "Walk-in Farmer",
      phone: s.customerPhone || "N/A",
      location: "",
      spend: 0,
      dates: [],
      orderIds: [],
      saleIds: [],
      productCounts: new Map<string, number>(),
      chickCount: 0,
    };

    if (s.customerName && (!existing.name || existing.name === "Walk-in Farmer")) {
      existing.name = s.customerName;
    }
    existing.spend += s.total || 0;
    existing.dates.push(s.createdAt.slice(0, 10));
    existing.saleIds.push(s.id);

    for (const item of s.items || []) {
      existing.chickCount += item.qty || 0;
      existing.productCounts.set(
        item.name,
        (existing.productCounts.get(item.name) ?? 0) + item.qty
      );
    }

    customerMap.set(key, existing);
  }

  const profiles: CustomerProfile[] = [];

  for (const [id, c] of customerMap.entries()) {
    c.dates.sort();
    const firstSeenDate = c.dates[0] || todayIsoLocal();
    const lastSeenDate = c.dates[c.dates.length - 1] || todayIsoLocal();

    const sortedProducts = Array.from(c.productCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name);

    const userMeta = meta[id] || {};
    const autoTags: string[] = [];
    if (c.orderIds.length + c.saleIds.length >= 3) autoTags.push("Repeat Customer");
    if (c.spend >= 15000) autoTags.push("VIP / High Value");
    if (c.chickCount >= 100) autoTags.push("Commercial Brooder");

    const mergedTags = Array.from(new Set([...autoTags, ...(userMeta.tags || [])]));

    profiles.push({
      id,
      name: c.name,
      phone: c.phone,
      location: c.location,
      totalSpend: c.spend,
      totalOrdersCount: c.orderIds.length + c.saleIds.length,
      firstSeenDate,
      lastSeenDate,
      tags: mergedTags,
      notes: userMeta.notes || "",
      orderIds: c.orderIds,
      saleIds: c.saleIds,
      totalChicksBought: c.chickCount,
      favoriteProducts: sortedProducts.slice(0, 3),
    });
  }

  // Sort by last active / highest spend
  return profiles.sort((a, b) => b.totalSpend - a.totalSpend);
}

function addDaysToDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.slice(0, 10).split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * Builds automated post-sale follow-up tasks (Day 3, Day 14, Day 30)
 */
export function buildFollowUpTasks(
  orders?: FarmerOrder[],
  sales?: Sale[],
  today = todayIsoLocal()
): FollowUpTask[] {
  const allOrders = orders ?? loadOrdersLocal();
  const allSales = sales ?? loadSales();
  const statusMap = loadFollowUpStatusLocal();
  const tasks: FollowUpTask[] = [];

  // Helper to add 3 milestones for a purchase
  const processPurchase = (input: {
    sourceType: "order" | "sale";
    sourceId: string;
    customerName: string;
    customerPhone: string;
    purchaseDate: string;
    chickSummary: string;
  }) => {
    if (!input.customerPhone || input.customerPhone === "N/A") return;
    const phoneKey = normalizePhoneKey(input.customerPhone);
    const dateStr = input.purchaseDate.slice(0, 10);

    const milestones: {
      type: FollowUpMilestoneType;
      days: number;
      title: string;
      description: string;
    }[] = [
      {
        type: "day3_brooder_check",
        days: 3,
        title: "Day 3 Brooder & Heat Check-in",
        description: "Verify brooding temperature, early feed intake, and anti-stress vitamin provision.",
      },
      {
        type: "day14_booster_feed",
        days: 14,
        title: "Day 14 Vaccine & Feed Reminder",
        description: "Reminder for Gumboro (IBD) booster dose and starter/grower feed restocking.",
      },
      {
        type: "day30_growth_reorder",
        days: 30,
        title: "Day 30 Hardening & Next Batch Booking",
        description: "1-month growth milestone check and invite for next hatch pre-orders.",
      },
    ];

    for (const m of milestones) {
      const taskId = `fu-${input.sourceType}-${input.sourceId}-${m.type}`;
      const dueDate = addDaysToDate(dateStr, m.days);
      const statusEntry = statusMap[taskId];
      const status = statusEntry ? statusEntry.status : "pending";

      tasks.push({
        id: taskId,
        customerId: phoneKey,
        customerName: input.customerName || "Farmer",
        customerPhone: input.customerPhone,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        purchaseDate: dateStr,
        dueDate,
        milestone: m.type,
        title: m.title,
        description: m.description,
        chickSummary: input.chickSummary,
        status,
        sentAt: statusEntry?.updatedAt,
      });
    }
  };

  for (const o of allOrders) {
    const summary = o.items.map((i) => `${i.qty}× ${i.name}`).join(", ");
    processPurchase({
      sourceType: "order",
      sourceId: o.id,
      customerName: o.customerName,
      customerPhone: o.customerPhone,
      purchaseDate: o.createdAt,
      chickSummary: summary,
    });
  }

  for (const s of allSales) {
    const summary = s.items.map((i) => `${i.qty}× ${i.name}`).join(", ");
    processPurchase({
      sourceType: "sale",
      sourceId: s.id,
      customerName: s.customerName || "",
      customerPhone: s.customerPhone || "",
      purchaseDate: s.createdAt,
      chickSummary: summary,
    });
  }

  // Sort tasks: pending due today first, overdue, then upcoming
  return tasks.sort((a, b) => {
    if (a.status === "pending" && b.status !== "pending") return -1;
    if (a.status !== "pending" && b.status === "pending") return 1;
    return a.dueDate.localeCompare(b.dueDate);
  });
}

/**
 * Generate personalized WhatsApp follow-up link
 */
export function generateFollowUpWhatsAppUrl(task: FollowUpTask): string {
  let phone = task.customerPhone.replace(/[^\d+]/g, "").trim();
  if (phone.startsWith("+")) phone = phone.slice(1);
  if (phone.startsWith("0")) phone = "254" + phone.slice(1);
  if (phone.startsWith("7") || phone.startsWith("1")) phone = "254" + phone;

  let msg = "";
  if (task.milestone === "day3_brooder_check") {
    msg = `Habari ${task.customerName}! Hapa ni KukuConnect Kitui 👋 Tunatumai vifaranga wako (${task.chickSummary}) wanakaa vizuri. 
Kumbuka kuweka joto la brooder vizuri (32-35°C), maji safi na vitamins. Kama una swali lolote la ufugaji, tuko hapa kukusaidia! 🐥`;
  } else if (task.milestone === "day14_booster_feed") {
    msg = `Habari ${task.customerName}! KukuConnect inakukumbusha kwamba vifaranga wako (${task.chickSummary}) sasa wanafikia siku 14. 
Huu ni wakati wa chanjo ya Gumboro/Newcastle booster na kuboresha chakula. Je, ungependa tukuletee starter/grower feed au chanjo? 💉🌾`;
  } else {
    msg = `Habari ${task.customerName}! Hongera, vifaranga wako (${task.chickSummary}) sasa wana mwezi mmoja! 🎉
Wako tayari kwa nje ya brooder. Je, una mpango wa kuweka oda ya awamu inayofuata ya vifaranga? Tuna vifaranga bora wa Kuroiler & Rainbow Rooster tayari. 🐓`;
  }

  return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
}

export function markFollowUpStatus(
  taskId: string,
  status: "sent" | "dismissed"
): FollowUpStatusMap {
  const map = loadFollowUpStatusLocal();
  map[taskId] = {
    status,
    updatedAt: new Date().toISOString(),
  };
  saveFollowUpStatusLocal(map);
  return map;
}
