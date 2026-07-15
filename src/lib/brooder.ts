import { loadJson, saveJson } from "./storage";
import {
  type InventoryItem,
  type StockMovement,
  ITEM_IDS,
  applyStockChange,
  getItemById,
} from "./inventory";

export const BROODER_STORAGE_KEY = "kukuconnect-brooder-lots";

/** Chick age band mapped to inventory SKU */
export type BrooderStageId =
  | typeof ITEM_IDS.dayOld
  | typeof ITEM_IDS.week1
  | typeof ITEM_IDS.week2
  | typeof ITEM_IDS.week3
  | typeof ITEM_IDS.month1
  | typeof ITEM_IDS.meatBird;

export interface BrooderStage {
  id: BrooderStageId;
  label: string;
  /** Inclusive min age in days (from hatch day 0) */
  minDay: number;
  /** Exclusive max age (Infinity for last) */
  maxDay: number;
}

/** Stage ladder for brooder → inventory buckets */
export const BROODER_STAGES: BrooderStage[] = [
  { id: ITEM_IDS.dayOld, label: "Day-old (0–6d)", minDay: 0, maxDay: 7 },
  { id: ITEM_IDS.week1, label: "1 week (7–13d)", minDay: 7, maxDay: 14 },
  { id: ITEM_IDS.week2, label: "2 weeks (14–20d)", minDay: 14, maxDay: 21 },
  { id: ITEM_IDS.week3, label: "3 weeks (21–27d)", minDay: 21, maxDay: 28 },
  { id: ITEM_IDS.month1, label: "1 month (28–89d)", minDay: 28, maxDay: 90 },
  { id: ITEM_IDS.meatBird, label: "Meat / grower (90d+)", minDay: 90, maxDay: Infinity },
];

export type BrooderLotStatus = "active" | "closed";

export interface BrooderLot {
  id: string;
  name: string;
  /** Hatch / placed date YYYY-MM-DD */
  hatchDate: string;
  /**
   * Birds still on farm for this lot.
   * Canonical formula: initial − mortality − sales − discounted.
   */
  quantity: number;
  /** Birds placed / hatched into this lot */
  initialQuantity: number;
  /** Inventory SKU currently holding this lot */
  stageId: BrooderStageId;
  breed: string;
  notes: string;
  status: BrooderLotStatus;
  /** Last calendar day age-up was applied YYYY-MM-DD */
  lastAgedDate: string;
  totalMortality: number;
  /** Full-price (or list) sales deducted from this lot */
  totalSales: number;
  /** Discounted / free / below-list chicks deducted from this lot */
  totalDiscounted: number;
  createdAt: string;
  closedAt: string | null;
  brooder: string;
}

/**
 * Remaining stock for a brooder lot.
 * remaining = placed − mortality − sales − discounted chicks
 */
export function remainingFromBreakdown(input: {
  initialQuantity: number;
  totalMortality?: number;
  totalSales?: number;
  totalDiscounted?: number;
}): number {
  const placed = Math.max(0, Math.floor(input.initialQuantity || 0));
  const mort = Math.max(0, Math.floor(input.totalMortality ?? 0));
  const sold = Math.max(0, Math.floor(input.totalSales ?? 0));
  const disc = Math.max(0, Math.floor(input.totalDiscounted ?? 0));
  return Math.max(0, placed - mort - sold - disc);
}

/** Infer placed qty for older lots that never stored initialQuantity. */
export function effectiveInitialQuantity(lot: BrooderLot): number {
  const stored = Math.floor(lot.initialQuantity ?? 0);
  if (stored > 0) return stored;
  const inferred =
    Math.max(0, Math.floor(lot.quantity || 0)) +
    Math.max(0, Math.floor(lot.totalMortality ?? 0)) +
    Math.max(0, Math.floor(lot.totalSales ?? 0)) +
    Math.max(0, Math.floor(lot.totalDiscounted ?? 0));
  return inferred > 0 ? inferred : Math.max(0, Math.floor(lot.quantity || 0));
}

/**
 * Recompute `quantity` + open/closed status from breakdown counters.
 * Does not touch inventory — caller must apply stock delta if needed.
 */
export function withSyncedRemaining(
  lot: BrooderLot,
  patch?: Partial<
    Pick<
      BrooderLot,
      | "initialQuantity"
      | "totalMortality"
      | "totalSales"
      | "totalDiscounted"
      | "name"
      | "breed"
      | "notes"
      | "hatchDate"
      | "brooder"
    >
  >
): BrooderLot {
  const initialQuantity = Math.max(
    0,
    Math.floor(patch?.initialQuantity ?? effectiveInitialQuantity(lot))
  );
  const totalMortality = Math.max(
    0,
    Math.floor(patch?.totalMortality ?? lot.totalMortality ?? 0)
  );
  const totalSales = Math.max(
    0,
    Math.floor(patch?.totalSales ?? lot.totalSales ?? 0)
  );
  const totalDiscounted = Math.max(
    0,
    Math.floor(patch?.totalDiscounted ?? lot.totalDiscounted ?? 0)
  );
  const quantity = remainingFromBreakdown({
    initialQuantity,
    totalMortality,
    totalSales,
    totalDiscounted,
  });
  const closed = quantity === 0;
  return {
    ...lot,
    ...patch,
    initialQuantity,
    totalMortality,
    totalSales,
    totalDiscounted,
    quantity,
    status: closed ? "closed" : "active",
    closedAt: closed
      ? lot.closedAt ?? new Date().toISOString()
      : null,
  };
}

/** Normalize legacy lots so remaining always matches the formula. */
export function normalizeLot(lot: BrooderLot): BrooderLot {
  return withSyncedRemaining(lot, {
    initialQuantity: effectiveInitialQuantity(lot),
    totalMortality: lot.totalMortality ?? 0,
    totalSales: lot.totalSales ?? 0,
    totalDiscounted: lot.totalDiscounted ?? 0,
  });
}

export function normalizeLots(lots: BrooderLot[]): BrooderLot[] {
  return lots.map(normalizeLot);
}

export interface MortalityEvent {
  id: string;
  lotId: string;
  lotName: string;
  qty: number;
  reason: string;
  date: string;
  createdAt: string;
}

export const MORTALITY_STORAGE_KEY = "kukuconnect-mortality-log";

export function loadLotsLocal(): BrooderLot[] {
  return loadJson<BrooderLot[]>(BROODER_STORAGE_KEY, []);
}

export function saveLotsLocal(lots: BrooderLot[]): void {
  saveJson(BROODER_STORAGE_KEY, lots);
}

export function loadMortalityLocal(): MortalityEvent[] {
  return loadJson<MortalityEvent[]>(MORTALITY_STORAGE_KEY, []);
}

export function saveMortalityLocal(events: MortalityEvent[]): void {
  saveJson(MORTALITY_STORAGE_KEY, events.slice(0, 500));
}

export function todayIsoLocal(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

export function ageDays(hatchDate: string, onDate: string = todayIsoLocal()): number {
  const [y1, m1, d1] = hatchDate.split("-").map(Number);
  const [y2, m2, d2] = onDate.split("-").map(Number);
  const a = new Date(y1, m1 - 1, d1);
  const b = new Date(y2, m2 - 1, d2);
  return Math.max(0, Math.floor((b.getTime() - a.getTime()) / 86400000));
}

export function stageForAge(days: number): BrooderStage {
  return (
    BROODER_STAGES.find((s) => days >= s.minDay && days < s.maxDay) ??
    BROODER_STAGES[BROODER_STAGES.length - 1]
  );
}

export function stageLabel(stageId: string): string {
  return BROODER_STAGES.find((s) => s.id === stageId)?.label ?? stageId;
}

export function createLot(input: {
  name: string;
  hatchDate: string;
  quantity: number;
  breed?: string;
  notes?: string;
  stageId?: BrooderStageId;
  brooder?: string;
}): BrooderLot {
  const qty = Math.max(0, Math.floor(input.quantity));
  const age = ageDays(input.hatchDate);
  const stage = input.stageId
    ? BROODER_STAGES.find((s) => s.id === input.stageId) ?? stageForAge(age)
    : stageForAge(age);
  const today = todayIsoLocal();
  return {
    id: `brood-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: input.name.trim() || "Brooder lot",
    hatchDate: input.hatchDate,
    quantity: qty,
    initialQuantity: qty,
    stageId: stage.id,
    breed: input.breed?.trim() ?? "",
    notes: input.notes?.trim() ?? "",
    status: qty > 0 ? "active" : "closed",
    lastAgedDate: today,
    totalMortality: 0,
    totalSales: 0,
    totalDiscounted: 0,
    createdAt: new Date().toISOString(),
    closedAt: qty > 0 ? null : new Date().toISOString(),
    brooder: input.brooder?.trim() || "Unassigned",
  };
}

/**
 * Apply daily age-up for all lots: move inventory between SKUs when stage changes.
 * Safe to call multiple times per day (idempotent via lastAgedDate).
 */
export function applyDailyAgeUp(
  lots: BrooderLot[],
  items: InventoryItem[],
  movements: StockMovement[],
  today: string = todayIsoLocal()
): {
  lots: BrooderLot[];
  items: InventoryItem[];
  movements: StockMovement[];
  transitions: { lotId: string; from: string; to: string; qty: number }[];
} {
  let nextItems = items;
  let nextMovements = movements;
  const transitions: { lotId: string; from: string; to: string; qty: number }[] = [];

  const nextLots = lots.map((lot) => {
    if (lot.status !== "active" || lot.quantity <= 0) return lot;
    if (lot.lastAgedDate >= today) return lot;

    const age = ageDays(lot.hatchDate, today);
    const target = stageForAge(age);
    if (target.id === lot.stageId) {
      return { ...lot, lastAgedDate: today };
    }

    // Move stock: out of old stage, into new
    const qty = lot.quantity;
    let r = applyStockChange(nextItems, nextMovements, {
      itemId: lot.stageId,
      delta: -qty,
      type: "adjust",
      note: `Brooder age-up: ${lot.name} → ${target.label}`,
      refId: lot.id,
      allowNegative: true,
    });
    if (r.ok) {
      nextItems = r.items;
      nextMovements = r.movements;
    }
    r = applyStockChange(nextItems, nextMovements, {
      itemId: target.id,
      delta: qty,
      type: "adjust",
      note: `Brooder age-up in: ${lot.name}`,
      refId: lot.id,
    });
    if (r.ok) {
      nextItems = r.items;
      nextMovements = r.movements;
    }

    transitions.push({
      lotId: lot.id,
      from: lot.stageId,
      to: target.id,
      qty,
    });

    return {
      ...lot,
      stageId: target.id,
      lastAgedDate: today,
    };
  });

  return { lots: nextLots, items: nextItems, movements: nextMovements, transitions };
}

/** Record mortality against a lot + inventory */
export function applyMortality(
  lots: BrooderLot[],
  items: InventoryItem[],
  movements: StockMovement[],
  events: MortalityEvent[],
  input: {
    lotId: string;
    qty: number;
    reason?: string;
    date?: string;
  }
): {
  ok: boolean;
  error?: string;
  lots: BrooderLot[];
  items: InventoryItem[];
  movements: StockMovement[];
  events: MortalityEvent[];
} {
  const lot = lots.find((l) => l.id === input.lotId);
  if (!lot) return { ok: false, error: "Lot not found", lots, items, movements, events };
  if (lot.status !== "active") {
    return { ok: false, error: "Lot is closed", lots, items, movements, events };
  }
  const qty = Math.floor(input.qty);
  if (qty <= 0) {
    return { ok: false, error: "Quantity must be > 0", lots, items, movements, events };
  }
  if (qty > lot.quantity) {
    return {
      ok: false,
      error: `Only ${lot.quantity} birds in this lot`,
      lots,
      items,
      movements,
      events,
    };
  }

  const r = applyStockChange(items, movements, {
    itemId: lot.stageId,
    delta: -qty,
    type: "loss",
    note: `Mortality: ${lot.name}${input.reason ? ` — ${input.reason}` : ""}`,
    refId: lot.id,
    createdAt: input.date ? new Date(input.date + "T12:00:00").toISOString() : undefined,
  });
  if (!r.ok) {
    return {
      ok: false,
      error: r.error,
      lots,
      items,
      movements,
      events,
    };
  }

  const nextLot = withSyncedRemaining(lot, {
    totalMortality: (lot.totalMortality ?? 0) + qty,
  });

  const event: MortalityEvent = {
    id: `mort-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    lotId: lot.id,
    lotName: lot.name,
    qty,
    reason: input.reason?.trim() ?? "",
    date: input.date ?? todayIsoLocal(),
    createdAt: new Date().toISOString(),
  };

  return {
    ok: true,
    lots: lots.map((l) => (l.id === lot.id ? nextLot : l)),
    items: r.items,
    movements: r.movements,
    events: [event, ...events].slice(0, 500),
  };
}

/** Create lot + add chicks to inventory at the correct stage */
export function placeInBrooder(
  lots: BrooderLot[],
  items: InventoryItem[],
  movements: StockMovement[],
  input: {
    name: string;
    hatchDate: string;
    quantity: number;
    breed?: string;
    notes?: string;
    brooder?: string;
  }
): {
  ok: boolean;
  error?: string;
  lots: BrooderLot[];
  items: InventoryItem[];
  movements: StockMovement[];
  lot?: BrooderLot;
} {
  const lot = createLot(input);
  if (lot.quantity <= 0) {
    return { ok: false, error: "Quantity must be > 0", lots, items, movements };
  }

  const r = applyStockChange(items, movements, {
    itemId: lot.stageId,
    delta: lot.quantity,
    type: "in",
    note: `Brooder in: ${lot.name}`,
    refId: lot.id,
  });
  if (!r.ok) {
    return { ok: false, error: r.error, lots, items, movements };
  }

  return {
    ok: true,
    lots: [lot, ...lots],
    items: r.items,
    movements: r.movements,
    lot,
  };
}

/** After hatch: create brooder lot from day-olds (stock already added by hatch) */
export function lotFromHatch(input: {
  batchName: string;
  hatchedCount: number;
  hatchDate?: string;
  batchId: string;
}): BrooderLot {
  return createLot({
    name: `Hatch · ${input.batchName}`,
    hatchDate: input.hatchDate ?? todayIsoLocal(),
    quantity: input.hatchedCount,
    notes: `From incubation ${input.batchId}`,
    stageId: ITEM_IDS.dayOld,
  });
}

/**
 * Deduct chick quantities from active brooder lots when a sale occurs.
 * Full-price sales → totalSales; below-list / free → totalDiscounted.
 * Remaining is always recomputed: placed − mortality − sales − discounted.
 */
export function deductBrooderLotsForSale(
  lots: BrooderLot[],
  soldItems: { itemId: string; qty: number; isDiscounted?: boolean }[]
): BrooderLot[] {
  let nextLots = normalizeLots(lots);
  const chickItemIds = new Set<string>([
    ITEM_IDS.dayOld,
    ITEM_IDS.week1,
    ITEM_IDS.week2,
    ITEM_IDS.week3,
    ITEM_IDS.month1,
    ITEM_IDS.meatBird,
  ]);

  for (const sold of soldItems) {
    if (!chickItemIds.has(sold.itemId)) continue;
    let remainingToDeduct = Math.max(0, Math.floor(sold.qty));

    nextLots = nextLots.map((lot) => {
      if (remainingToDeduct <= 0) return lot;
      if (
        lot.status !== "active" ||
        lot.stageId !== sold.itemId ||
        lot.quantity <= 0
      ) {
        return lot;
      }
      const deduct = Math.min(lot.quantity, remainingToDeduct);
      remainingToDeduct -= deduct;

      return withSyncedRemaining(lot, {
        totalSales: (lot.totalSales ?? 0) + (sold.isDiscounted ? 0 : deduct),
        totalDiscounted:
          (lot.totalDiscounted ?? 0) + (sold.isDiscounted ? deduct : 0),
      });
    });
  }

  return nextLots;
}

/**
 * Apply a manual correction to lot counters and sync inventory stock
 * for the quantity delta on the lot's current stage SKU.
 */
export function applyLotCorrection(
  lots: BrooderLot[],
  items: InventoryItem[],
  movements: StockMovement[],
  lotId: string,
  patch: Partial<
    Pick<
      BrooderLot,
      | "name"
      | "breed"
      | "notes"
      | "hatchDate"
      | "brooder"
      | "initialQuantity"
      | "totalMortality"
      | "totalSales"
      | "totalDiscounted"
    >
  >
): {
  ok: boolean;
  error?: string;
  lots: BrooderLot[];
  items: InventoryItem[];
  movements: StockMovement[];
} {
  const idx = lots.findIndex((l) => l.id === lotId);
  if (idx === -1) {
    return { ok: false, error: "Lot not found", lots, items, movements };
  }
  const prev = normalizeLot(lots[idx]);
  const next = withSyncedRemaining(prev, patch);
  const delta = next.quantity - prev.quantity;

  let nextItems = items;
  let nextMovements = movements;
  if (delta !== 0) {
    const r = applyStockChange(nextItems, nextMovements, {
      itemId: prev.stageId,
      delta,
      type: "adjust",
      note: `Lot correction: ${next.name} remaining ${prev.quantity} → ${next.quantity}`,
      refId: lotId,
      allowNegative: true,
    });
    if (!r.ok) {
      return {
        ok: false,
        error: r.error ?? "Could not sync inventory",
        lots,
        items,
        movements,
      };
    }
    nextItems = r.items;
    nextMovements = r.movements;
  }

  const nextLots = [...lots];
  nextLots[idx] = next;
  return {
    ok: true,
    lots: nextLots,
    items: nextItems,
    movements: nextMovements,
  };
}

export function activeLotsSummary(lots: BrooderLot[]) {
  const active = lots.filter((l) => l.status === "active");
  const byStage = new Map<string, number>();
  let total = 0;
  let mortality = 0;
  for (const l of active) {
    total += l.quantity;
    mortality += l.totalMortality;
    byStage.set(l.stageId, (byStage.get(l.stageId) ?? 0) + l.quantity);
  }
  return { activeCount: active.length, totalBirds: total, totalMortality: mortality, byStage };
}

export function needsAgeUp(lots: BrooderLot[], today = todayIsoLocal()): boolean {
  return lots.some(
    (l) =>
      l.status === "active" &&
      l.quantity > 0 &&
      (l.lastAgedDate < today ||
        stageForAge(ageDays(l.hatchDate, today)).id !== l.stageId)
  );
}
