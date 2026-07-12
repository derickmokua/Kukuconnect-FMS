/**
 * Business performance insights for KukuConnect FMS.
 * Rule-based KPIs + actionable recommendations (feed burn, mortality, cash, orders).
 * Optional AI only expands the narrative — core insights work without any API key.
 */

import type { InventoryItem, StockMovement } from "./inventory";
import { getLowStockItems, ITEM_IDS } from "./inventory";
import type { FarmerOrder } from "./orders";
import { pendingOrders, formatMoney } from "./orders";
import type { IncubationBatch } from "./incubation";
import { getCurrentDay } from "./incubation";
import type { Sale } from "./sales";
import { getMonthRevenue, monthKeyFromDate } from "./sales";
import type { Expense, ExpenseCategory } from "./expenses";
import { getMonthExpenses } from "./expenses";
import type { BrooderLot, MortalityEvent } from "./brooder";
import { needsAgeUp } from "./brooder";

export type InsightSeverity = "critical" | "warning" | "good" | "info";
export type InsightArea =
  | "feed"
  | "stock"
  | "orders"
  | "hatch"
  | "brooder"
  | "cash"
  | "sales"
  | "ops";

export interface PerformanceInsight {
  id: string;
  area: InsightArea;
  severity: InsightSeverity;
  title: string;
  /** What the numbers show */
  finding: string;
  /** What staff should do (practical) */
  recommendation: string;
  href?: string;
  /** Optional metric label shown as a chip */
  metric?: string;
}

export interface FarmSnapshot {
  generatedAt: string;
  birdsOnFarm: number;
  lowStock: { name: string; quantity: number; lowStockAt: number }[];
  sellable: {
    dayOld: number;
    week3: number;
    parentStock: number;
    chicksReady: number;
  };
  orders: {
    pending: number;
    paid: number;
    fulfilled: number;
    pendingTotal: number;
    oldestPendingHours: number | null;
  };
  incubation: {
    activeBatches: number;
    eggsIncubating: number;
    nearHatch: { name: string; day: number; totalDays: number }[];
  };
  brooder: {
    activeLots: number;
    birds: number;
    needsAgeUp: boolean;
    mortality7d: number;
    mortality30d: number;
  };
  feed: {
    spend7d: number;
    spendPrev7d: number;
    spend30d: number;
    spendMonth: number;
    /** KSh feed per bird over last 7 days (0 if no birds) */
    perBird7d: number | null;
    /** % change 7d vs previous 7d (null if prev was 0) */
    burnChangePct: number | null;
  };
  expenseMix: { category: ExpenseCategory; amount: number; pct: number }[];
  finance: {
    month: string;
    revenue: number;
    expenses: number;
    profit: number;
    feedPctOfRevenue: number | null;
    feedPctOfExpenses: number | null;
  };
  sales: {
    revenue7d: number;
    revenuePrev7d: number;
    chicksSold7d: number;
  };
  livestockLoss7d: number;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function daysAgoIso(days: number, from = new Date()): string {
  const d = startOfDay(from);
  d.setDate(d.getDate() - days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function sumExpensesInRange(
  expenses: Expense[],
  fromIso: string,
  toIsoExclusive: string,
  category?: ExpenseCategory
): number {
  return expenses
    .filter((e) => {
      if (category && e.category !== category) return false;
      return e.date >= fromIso && e.date < toIsoExclusive;
    })
    .reduce((s, e) => s + e.amount, 0);
}

function sumSalesInRange(
  sales: Sale[],
  from: Date,
  to: Date
): { revenue: number; chicks: number } {
  let revenue = 0;
  let chicks = 0;
  for (const s of sales) {
    const t = new Date(s.createdAt).getTime();
    if (t >= from.getTime() && t < to.getTime()) {
      revenue += s.total;
      chicks += s.items.reduce((n, line) => n + line.qty, 0);
    }
  }
  return { revenue, chicks };
}

function sumMortalityInRange(
  events: MortalityEvent[],
  fromIso: string,
  toIsoExclusive: string
): number {
  return events
    .filter((e) => e.date >= fromIso && e.date < toIsoExclusive)
    .reduce((s, e) => s + e.qty, 0);
}

function sumLossMovements7d(movements: StockMovement[], from: Date): number {
  return movements
    .filter(
      (m) =>
        m.type === "loss" &&
        new Date(m.createdAt).getTime() >= from.getTime()
    )
    .reduce((s, m) => s + Math.abs(m.delta), 0);
}

export function buildFarmSnapshot(input: {
  items: InventoryItem[];
  orders: FarmerOrder[];
  batches: IncubationBatch[];
  sales: Sale[];
  expenses: Expense[];
  lots: BrooderLot[];
  mortality?: MortalityEvent[];
  movements?: StockMovement[];
}): FarmSnapshot {
  const {
    items,
    orders,
    batches,
    sales,
    expenses,
    lots,
    mortality = [],
    movements = [],
  } = input;

  const now = new Date();
  const d7 = daysAgoIso(7, now);
  const d14 = daysAgoIso(14, now);
  const d30 = daysAgoIso(30, now);
  const from7 = startOfDay(now);
  from7.setDate(from7.getDate() - 7);
  const from14 = startOfDay(now);
  from14.setDate(from14.getDate() - 14);
  const tomorrow = startOfDay(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const low = getLowStockItems(items);
  const pending = pendingOrders(orders);
  const paid = orders.filter((o) => o.status === "paid");
  const fulfilled = orders.filter((o) => o.status === "fulfilled");

  let oldestPendingHours: number | null = null;
  if (pending.length) {
    const oldest = pending.reduce((a, b) =>
      a.createdAt < b.createdAt ? a : b
    );
    oldestPendingHours = Math.floor(
      (Date.now() - new Date(oldest.createdAt).getTime()) / (1000 * 60 * 60)
    );
  }

  const incubating = batches.filter((b) => b.status === "incubating");
  const nearHatch = incubating
    .map((b) => {
      const day = getCurrentDay(b);
      return {
        name: b.name,
        day,
        totalDays: b.incubationDays,
        remaining: b.incubationDays - day,
      };
    })
    .filter((b) => b.remaining <= 3)
    .map(({ name, day, totalDays }) => ({ name, day, totalDays }));

  const dayOld =
    items.find((i) => i.id === ITEM_IDS.dayOld)?.quantity ?? 0;
  const week3 =
    items.find((i) => i.id === ITEM_IDS.week3)?.quantity ?? 0;
  const parentStock =
    items.find((i) => i.id === ITEM_IDS.parentStock)?.quantity ?? 0;
  const chicksReady = items
    .filter((i) => i.sellable && i.category === "livestock")
    .reduce((s, i) => s + i.quantity, 0);

  const activeLots = lots.filter((l) => l.status === "active");
  const brooderBirds = activeLots.reduce((s, l) => s + l.quantity, 0);
  const livestockBirds = items
    .filter((i) => i.category === "livestock")
    .reduce((s, i) => s + i.quantity, 0);
  // Prefer max of brooder vs livestock so we don't double-count if both track same birds
  const birdsOnFarm = Math.max(livestockBirds, brooderBirds, parentStock);

  const endExclusive = (() => {
    const t = startOfDay(now);
    t.setDate(t.getDate() + 1);
    const y = t.getFullYear();
    const m = String(t.getMonth() + 1).padStart(2, "0");
    const day = String(t.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  })();
  const feedSpend7d = sumExpensesInRange(expenses, d7, endExclusive, "feed");
  const feedSpendPrev7d = sumExpensesInRange(expenses, d14, d7, "feed");
  const feedSpend30d = sumExpensesInRange(expenses, d30, endExclusive, "feed");

  const month = monthKeyFromDate();
  const revenue = getMonthRevenue(sales, month);
  const monthExp = getMonthExpenses(expenses, month);
  const feedMonth = expenses
    .filter(
      (e) => e.category === "feed" && e.date.startsWith(month)
    )
    .reduce((s, e) => s + e.amount, 0);

  const byCat = new Map<ExpenseCategory, number>();
  for (const e of expenses) {
    if (!e.date.startsWith(month)) continue;
    byCat.set(e.category, (byCat.get(e.category) ?? 0) + e.amount);
  }
  const expenseMix = [...byCat.entries()]
    .map(([category, amount]) => ({
      category,
      amount,
      pct: monthExp > 0 ? Math.round((amount / monthExp) * 100) : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  const sales7 = sumSalesInRange(sales, from7, tomorrow);
  const salesPrev = sumSalesInRange(sales, from14, from7);

  const burnChangePct =
    feedSpendPrev7d > 0
      ? Math.round(
          ((feedSpend7d - feedSpendPrev7d) / feedSpendPrev7d) * 100
        )
      : feedSpend7d > 0
        ? 100
        : null;

  const perBird7d =
    birdsOnFarm > 0 ? Math.round((feedSpend7d / birdsOnFarm) * 10) / 10 : null;

  return {
    generatedAt: new Date().toISOString(),
    birdsOnFarm,
    lowStock: low.map((i) => ({
      name: i.name,
      quantity: i.quantity,
      lowStockAt: i.lowStockAt,
    })),
    sellable: {
      dayOld,
      week3,
      parentStock,
      chicksReady,
    },
    orders: {
      pending: pending.length,
      paid: paid.length,
      fulfilled: fulfilled.length,
      pendingTotal: pending.reduce((s, o) => s + o.total, 0),
      oldestPendingHours,
    },
    incubation: {
      activeBatches: incubating.length,
      eggsIncubating: incubating.reduce(
        (s, b) => s + Math.max(0, b.eggCount - b.removedEggs),
        0
      ),
      nearHatch,
    },
    brooder: {
      activeLots: activeLots.length,
      birds: brooderBirds,
      needsAgeUp: needsAgeUp(lots),
      mortality7d: sumMortalityInRange(mortality, d7, endExclusive),
      mortality30d: sumMortalityInRange(mortality, d30, endExclusive),
    },
    feed: {
      spend7d: feedSpend7d,
      spendPrev7d: feedSpendPrev7d,
      spend30d: feedSpend30d,
      spendMonth: feedMonth,
      perBird7d,
      burnChangePct,
    },
    expenseMix,
    finance: {
      month,
      revenue,
      expenses: monthExp,
      profit: revenue - monthExp,
      feedPctOfRevenue:
        revenue > 0 ? Math.round((feedMonth / revenue) * 100) : null,
      feedPctOfExpenses:
        monthExp > 0 ? Math.round((feedMonth / monthExp) * 100) : null,
    },
    sales: {
      revenue7d: sales7.revenue,
      revenuePrev7d: salesPrev.revenue,
      chicksSold7d: sales7.chicks,
    },
    livestockLoss7d: sumLossMovements7d(movements, from7),
  };
}

/**
 * Actionable performance insights — e.g. feed burning faster than expected.
 */
export function buildPerformanceInsights(
  snapshot: FarmSnapshot
): PerformanceInsight[] {
  const out: PerformanceInsight[] = [];

  // --- Feed efficiency / burn rate ---
  if (snapshot.feed.spend7d > 0 || snapshot.feed.spendPrev7d > 0) {
    const change = snapshot.feed.burnChangePct;
    if (change != null && change >= 25 && snapshot.feed.spend7d > 0) {
      out.push({
        id: "feed-burn-up",
        area: "feed",
        severity: change >= 50 ? "critical" : "warning",
        title: "Feed spend is rising faster than last week",
        finding: `Last 7 days feed: ${formatMoney(snapshot.feed.spend7d)} vs previous 7 days ${formatMoney(snapshot.feed.spendPrev7d)} (${change > 0 ? "+" : ""}${change}%).${
          snapshot.feed.perBird7d != null
            ? ` About ${formatMoney(snapshot.feed.perBird7d)} feed per bird this week (${snapshot.birdsOnFarm} birds counted).`
            : ""
        }`,
        recommendation: [
          "Check for wastage: spillage under feeders, wet mash, rodents, or open bags.",
          "Match feed type to age (chick mash vs grower) — wrong stage wastes money and slows growth.",
          "Weigh a sample of bags used vs birds on hand; aim for steady g/bird/day, not free-choice overflow.",
          "If bird numbers did not rise, reduce refill frequency and fix feeder height/guards.",
        ].join(" "),
        href: "/expenses",
        metric: `${change > 0 ? "+" : ""}${change}% feed week`,
      });
    } else if (change != null && change <= -20 && snapshot.feed.spendPrev7d > 0) {
      out.push({
        id: "feed-burn-down",
        area: "feed",
        severity: "good",
        title: "Feed spend dropped vs last week",
        finding: `Feed ${formatMoney(snapshot.feed.spend7d)} this week vs ${formatMoney(snapshot.feed.spendPrev7d)} before (${change}%).`,
        recommendation:
          "Confirm birds are still getting enough (growth/weight). If flock size fell or you switched to bulk buying, good. If chicks look hungry or uneven, you may be underfeeding.",
        href: "/expenses",
        metric: `${change}% feed week`,
      });
    }
  }

  // High feed share of costs
  if (
    snapshot.finance.feedPctOfExpenses != null &&
    snapshot.finance.feedPctOfExpenses >= 55 &&
    snapshot.feed.spendMonth > 0
  ) {
    out.push({
      id: "feed-share-high",
      area: "feed",
      severity:
        snapshot.finance.feedPctOfExpenses >= 70 ? "critical" : "warning",
      title: "Feed is dominating this month’s costs",
      finding: `Feed is ${snapshot.finance.feedPctOfExpenses}% of expenses (${formatMoney(snapshot.feed.spendMonth)} of ${formatMoney(snapshot.finance.expenses)}).${
        snapshot.finance.feedPctOfRevenue != null
          ? ` That is ${snapshot.finance.feedPctOfRevenue}% of revenue.`
          : ""
      }`,
      recommendation:
        "Buy in bulk only what you will use before spoilage; negotiate supplier price; cut wastage first before cutting ration quality. Track kg feed per 100 chicks so “bags finishing early” is measured, not guessed.",
      href: "/expenses",
      metric: `${snapshot.finance.feedPctOfExpenses}% of costs`,
    });
  }

  // Feed spend with few birds
  if (
    snapshot.feed.spend7d >= 2000 &&
    snapshot.birdsOnFarm > 0 &&
    snapshot.feed.perBird7d != null &&
    snapshot.feed.perBird7d > 80
  ) {
    out.push({
      id: "feed-per-bird-high",
      area: "feed",
      severity: "warning",
      title: "Feed cost per bird looks high for 7 days",
      finding: `~${formatMoney(snapshot.feed.perBird7d)} feed per bird over 7 days with ${snapshot.birdsOnFarm} birds on the books.`,
      recommendation:
        "Typical small-scale broiler/kuroiler starter periods should not burn bags that fast unless wastage, theft, wrong bird count, or selling feed off-books. Recount flock, inspect feed store, and log each bag with date + birds present.",
      href: "/inventory",
      metric: `${formatMoney(snapshot.feed.perBird7d)}/bird/wk`,
    });
  }

  if (snapshot.feed.spend7d >= 3000 && snapshot.birdsOnFarm === 0) {
    out.push({
      id: "feed-no-birds",
      area: "feed",
      severity: "critical",
      title: "Feed expenses with almost no birds recorded",
      finding: `${formatMoney(snapshot.feed.spend7d)} feed spend in 7 days but bird stock/brooder shows 0.`,
      recommendation:
        "Update Inventory and Brooder counts, or investigate diversion/theft. Do not buy more feed until headcount matches reality.",
      href: "/inventory",
      metric: formatMoney(snapshot.feed.spend7d),
    });
  }

  // --- Mortality / losses ---
  if (snapshot.brooder.mortality7d > 0 || snapshot.livestockLoss7d > 0) {
    const dead =
      snapshot.brooder.mortality7d + snapshot.livestockLoss7d;
    const rate =
      snapshot.birdsOnFarm > 0
        ? Math.round((dead / snapshot.birdsOnFarm) * 1000) / 10
        : null;
    out.push({
      id: "mortality-7d",
      area: "brooder",
      severity: rate != null && rate >= 5 ? "critical" : "warning",
      title: "Mortality / losses in the last 7 days",
      finding: `Brooder deaths logged: ${snapshot.brooder.mortality7d}; inventory losses: ${snapshot.livestockLoss7d}.${
        rate != null ? ` Roughly ${rate}% of counted birds.` : ""
      }`,
      recommendation:
        "Separate sick birds, check heat (brooder temp), drafts, overcrowding, and water. Review vaccine timing. High early mortality usually costs more in wasted feed than in the dead chicks alone.",
      href: "/brooder",
      metric: `${dead} lost / 7d`,
    });
  }

  // --- Stock ---
  for (const item of snapshot.lowStock) {
    out.push({
      id: `low-${item.name}`,
      area: "stock",
      severity: item.quantity === 0 ? "critical" : "warning",
      title:
        item.quantity === 0
          ? `Out of stock: ${item.name}`
          : `Low stock: ${item.name}`,
      finding: `${item.quantity} left (alert threshold ${item.lowStockAt}).`,
      recommendation:
        item.quantity === 0
          ? "Pause sales of this SKU, accelerate hatch/intake, or buy-in. Do not take M-Pesa for stock you cannot fulfill."
          : "Plan restock or reduce promotions until hatch catches up.",
      href: "/inventory",
      metric: String(item.quantity),
    });
  }

  if (
    snapshot.orders.pending > 0 &&
    snapshot.sellable.dayOld === 0 &&
    snapshot.sellable.week3 === 0
  ) {
    out.push({
      id: "orders-no-stock",
      area: "orders",
      severity: "critical",
      title: "Orders waiting but no sellable chicks",
      finding: `${snapshot.orders.pending} pending order(s) while day-old and 3-week stock are 0.`,
      recommendation:
        "Call/WhatsApp farmers with a realistic date, or source birds. Avoid confirming payment until supply is clear.",
      href: "/orders",
    });
  } else if (snapshot.orders.pending > 0) {
    out.push({
      id: "pending-orders",
      area: "orders",
      severity:
        snapshot.orders.oldestPendingHours != null &&
        snapshot.orders.oldestPendingHours >= 24
          ? "critical"
          : "warning",
      title: `${snapshot.orders.pending} order(s) awaiting payment confirm`,
      finding: `${formatMoney(snapshot.orders.pendingTotal)} pending.${
        snapshot.orders.oldestPendingHours != null
          ? ` Oldest ~${snapshot.orders.oldestPendingHours}h.`
          : ""
      }`,
      recommendation:
        "Confirm M-Pesa same day when possible — delayed confirms lose trust and mess up stock planning.",
      href: "/orders",
    });
  }

  if (snapshot.orders.paid > 0) {
    out.push({
      id: "fulfill-paid",
      area: "orders",
      severity: "info",
      title: `${snapshot.orders.paid} paid order(s) to fulfill`,
      finding: "Money in — birds or pickup still open.",
      recommendation:
        "Schedule release, notify farmer on WhatsApp, mark fulfilled so stock and cash stay aligned.",
      href: "/orders",
    });
  }

  // --- Hatch ---
  for (const b of snapshot.incubation.nearHatch) {
    out.push({
      id: `hatch-${b.name}`,
      area: "hatch",
      severity: "warning",
      title: `Hatch soon: ${b.name}`,
      finding: `Day ${b.day} of ${b.totalDays}.`,
      recommendation:
        "Prepare brooder heat, feeders, drinkers, and boxes. Hatch without brooder ready spikes mortality and wastes the whole batch’s feed investment later.",
      href: "/incubation",
    });
  }

  if (snapshot.brooder.needsAgeUp) {
    out.push({
      id: "age-up",
      area: "ops",
      severity: "info",
      title: "Brooder daily age-up not run",
      finding: `${snapshot.brooder.birds} birds in ${snapshot.brooder.activeLots} active lot(s).`,
      recommendation:
        "Open Brooder and run the daily update so stock stages (and feed phase) match real age.",
      href: "/brooder",
    });
  }

  // --- Cash / sales ---
  if (snapshot.finance.profit < 0 && snapshot.finance.expenses > 0) {
    out.push({
      id: "loss-month",
      area: "cash",
      severity: "warning",
      title: "Month-to-date profit is negative",
      finding: `Revenue ${formatMoney(snapshot.finance.revenue)} − expenses ${formatMoney(snapshot.finance.expenses)} = ${formatMoney(snapshot.finance.profit)}.`,
      recommendation:
        "Attack biggest cost line first (often feed), then speed up sales/fulfillment of ready birds. Avoid new equipment until cash positive.",
      href: "/sales",
      metric: formatMoney(snapshot.finance.profit),
    });
  }

  if (
    snapshot.sales.revenuePrev7d > 0 &&
    snapshot.sales.revenue7d < snapshot.sales.revenuePrev7d * 0.6
  ) {
    const drop = Math.round(
      (1 - snapshot.sales.revenue7d / snapshot.sales.revenuePrev7d) * 100
    );
    out.push({
      id: "sales-drop",
      area: "sales",
      severity: "warning",
      title: "Sales slowed vs previous week",
      finding: `${formatMoney(snapshot.sales.revenue7d)} this week vs ${formatMoney(snapshot.sales.revenuePrev7d)} before (about −${drop}%). Chicks sold (lines qty): ${snapshot.sales.chicksSold7d}.`,
      recommendation:
        "Push ready 3-week stock on WhatsApp/groups, clear pending orders, and avoid holding birds into expensive feed weeks without buyers.",
      href: "/sales",
      metric: `−${drop}% rev`,
    });
  }

  if (
    snapshot.sellable.chicksReady > 50 &&
    snapshot.sales.revenue7d === 0 &&
    snapshot.orders.pending === 0
  ) {
    out.push({
      id: "stock-no-sales",
      area: "sales",
      severity: "warning",
      title: "Birds on hand but no recent sales",
      finding: `${snapshot.sellable.chicksReady} sellable livestock recorded; 0 sales revenue in 7 days.`,
      recommendation:
        "Every extra day burns feed. List available ages/prices, message past customers, and set a weekly sales target.",
      href: "/sales",
    });
  }

  // Quiet / healthy baseline
  if (out.length === 0) {
    out.push({
      id: "steady",
      area: "ops",
      severity: "good",
      title: "No major red flags from current data",
      finding: `Birds ~${snapshot.birdsOnFarm}, feed 7d ${formatMoney(snapshot.feed.spend7d)}, profit MTD ${formatMoney(snapshot.finance.profit)}.`,
      recommendation:
        "Keep logging feed by bag and mortality daily — insights get sharper with consistent expenses and brooder records.",
      href: "/expenses",
    });
  }

  const rank: Record<InsightSeverity, number> = {
    critical: 0,
    warning: 1,
    info: 2,
    good: 3,
  };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/** @deprecated use buildPerformanceInsights */
export function buildRuleAlerts(
  snapshot: FarmSnapshot
): PerformanceInsight[] {
  return buildPerformanceInsights(snapshot);
}

export type FarmAlert = PerformanceInsight;

export function snapshotToPromptText(snapshot: FarmSnapshot): string {
  return [
    `Time: ${snapshot.generatedAt}`,
    `Birds on farm (approx): ${snapshot.birdsOnFarm}`,
    `Stock: day-old ${snapshot.sellable.dayOld}, 3-week ${snapshot.sellable.week3}, parent ${snapshot.sellable.parentStock}, sellable ${snapshot.sellable.chicksReady}`,
    `Feed 7d: ${snapshot.feed.spend7d} KSh (prev 7d ${snapshot.feed.spendPrev7d}), change% ${snapshot.feed.burnChangePct ?? "n/a"}, per bird 7d ${snapshot.feed.perBird7d ?? "n/a"}`,
    `Feed month: ${snapshot.feed.spendMonth}, % of expenses ${snapshot.finance.feedPctOfExpenses ?? "n/a"}, % of revenue ${snapshot.finance.feedPctOfRevenue ?? "n/a"}`,
    `Mortality 7d brooder ${snapshot.brooder.mortality7d}, inventory loss ${snapshot.livestockLoss7d}`,
    `Orders pending ${snapshot.orders.pending} (${snapshot.orders.pendingTotal} KSh), paid ${snapshot.orders.paid}`,
    `Sales 7d ${snapshot.sales.revenue7d} (prev ${snapshot.sales.revenuePrev7d}), chicks qty sold ${snapshot.sales.chicksSold7d}`,
    `Finance MTD: rev ${snapshot.finance.revenue}, exp ${snapshot.finance.expenses}, profit ${snapshot.finance.profit}`,
    `Incubation: ${snapshot.incubation.activeBatches} batches, near hatch: ${
      snapshot.incubation.nearHatch.map((b) => b.name).join(", ") || "none"
    }`,
  ].join("\n");
}

export const ASSISTANT_SYSTEM_PROMPT = `You are the KukuConnect business performance coach for a Kitui, Kenya poultry hatchery (Kuroiler & Rainbow Rooster).

You are NOT a chatbot for chit-chat. You write short operational BRIEFINGS for hatchery staff.

Focus on:
- Feed efficiency and wastage (bags finishing too soon, cost per bird, feed % of costs)
- Mortality and how it wastes feed
- Stock vs orders (fulfillment risk)
- Sales velocity vs birds burning feed
- Cash: profit, expense mix

Style:
- Direct, practical Kenya context (KSh, WhatsApp sales, M-Pesa manual confirm)
- Bullet points only
- Each bullet: finding → action
- Do not invent numbers; only use the SNAPSHOT and INSIGHTS provided
- No drug prescriptions; send serious disease to a vet
- Max ~180 words`;
