import { loadJson, saveJson } from "./storage";

export const INVENTORY_ITEMS_KEY = "kukuconnect-inventory-items";
export const INVENTORY_MOVEMENTS_KEY = "kukuconnect-inventory-movements";

export type InventoryCategory = "livestock" | "eggs" | "other";
export type MovementType =
  | "in"
  | "out"
  | "adjust"
  | "sale"
  | "hatch"
  | "loss";

export interface InventoryItem {
  id: string;
  name: string;
  category: InventoryCategory;
  quantity: number;
  unit: string;
  lowStockAt: number;
  defaultPrice: number;
  /** Can be sold on the Sales page */
  sellable: boolean;
  /** Built-in catalogue items (cannot delete, can still edit qty) */
  system: boolean;
  updatedAt: string;
}

export interface StockMovement {
  id: string;
  itemId: string;
  itemName: string;
  type: MovementType;
  /** Signed change: positive = stock in, negative = stock out */
  delta: number;
  balanceAfter: number;
  note: string;
  createdAt: string;
  refId?: string;
}

/** Canonical sellable SKUs used by Sales + hatch intake */
export const ITEM_IDS = {
  parentStock: "parent-stock",
  dayOld: "day-old-chick",
  week1: "week-1-chick",
  week2: "week-2-chick",
  week3: "week-3-chick",
  month1: "month-1-chick",
  meatBird: "meat-bird",
  trayEggs: "tray-eggs",
  hatchingEggs: "hatching-eggs",
} as const;

const DEFAULT_ITEMS: Omit<InventoryItem, "updatedAt">[] = [
  {
    id: ITEM_IDS.parentStock,
    name: "Parent Stock",
    category: "livestock",
    quantity: 0,
    unit: "birds",
    lowStockAt: 20,
    defaultPrice: 0,
    sellable: false,
    system: true,
  },
  {
    id: ITEM_IDS.dayOld,
    name: "1 Day Old Chick",
    category: "livestock",
    quantity: 0,
    unit: "chicks",
    lowStockAt: 50,
    defaultPrice: 150,
    sellable: true,
    system: true,
  },
  {
    id: ITEM_IDS.week1,
    name: "1 Week Chick",
    category: "livestock",
    quantity: 0,
    unit: "chicks",
    lowStockAt: 30,
    defaultPrice: 200,
    sellable: true,
    system: true,
  },
  {
    id: ITEM_IDS.week2,
    name: "2 Weeks Chick",
    category: "livestock",
    quantity: 0,
    unit: "chicks",
    lowStockAt: 30,
    defaultPrice: 280,
    sellable: true,
    system: true,
  },
  {
    id: ITEM_IDS.week3,
    name: "3 Weeks Chick",
    category: "livestock",
    quantity: 0,
    unit: "chicks",
    lowStockAt: 20,
    defaultPrice: 350,
    sellable: true,
    system: true,
  },
  {
    id: ITEM_IDS.month1,
    name: "1 Month Chick",
    category: "livestock",
    quantity: 0,
    unit: "birds",
    lowStockAt: 20,
    defaultPrice: 500,
    sellable: true,
    system: true,
  },
  {
    id: ITEM_IDS.meatBird,
    name: "Meat Bird (3 Months)",
    category: "livestock",
    quantity: 0,
    unit: "birds",
    lowStockAt: 10,
    defaultPrice: 1200,
    sellable: true,
    system: true,
  },
  {
    id: ITEM_IDS.trayEggs,
    name: "Tray of Eggs",
    category: "eggs",
    quantity: 0,
    unit: "trays",
    lowStockAt: 5,
    defaultPrice: 400,
    sellable: true,
    system: true,
  },
  {
    id: ITEM_IDS.hatchingEggs,
    name: "Hatching Eggs",
    category: "eggs",
    quantity: 0,
    unit: "eggs",
    lowStockAt: 50,
    defaultPrice: 0,
    sellable: false,
    system: true,
  },
];

function nowIso() {
  return new Date().toISOString();
}

function withTimestamp(
  item: Omit<InventoryItem, "updatedAt">
): InventoryItem {
  return { ...item, updatedAt: nowIso() };
}

/** Merge saved items with any new default catalogue SKUs. */
export function loadItems(): InventoryItem[] {
  const saved = loadJson<InventoryItem[]>(INVENTORY_ITEMS_KEY, []);
  if (saved.length === 0) {
    const seeded = DEFAULT_ITEMS.map(withTimestamp);
    saveItems(seeded);
    return seeded;
  }

  const byId = new Map(saved.map((i) => [i.id, i]));
  let changed = false;
  for (const def of DEFAULT_ITEMS) {
    if (!byId.has(def.id)) {
      byId.set(def.id, withTimestamp(def));
      changed = true;
    }
  }
  const merged = Array.from(byId.values());
  if (changed) saveItems(merged);
  return merged;
}

export function saveItems(items: InventoryItem[]): void {
  saveJson(INVENTORY_ITEMS_KEY, items);
}

export function loadMovements(): StockMovement[] {
  return loadJson<StockMovement[]>(INVENTORY_MOVEMENTS_KEY, []);
}

export function saveMovements(movements: StockMovement[]): void {
  saveJson(INVENTORY_MOVEMENTS_KEY, movements.slice(0, 500));
}

export function isLowStock(item: InventoryItem): boolean {
  return item.quantity <= item.lowStockAt;
}

export function getSellableItems(items: InventoryItem[]): InventoryItem[] {
  return items.filter((i) => i.sellable);
}

export function getItemById(
  items: InventoryItem[],
  id: string
): InventoryItem | undefined {
  return items.find((i) => i.id === id);
}

export function getItemByName(
  items: InventoryItem[],
  name: string
): InventoryItem | undefined {
  return items.find((i) => i.name === name);
}

export interface ApplyResult {
  items: InventoryItem[];
  movements: StockMovement[];
  ok: boolean;
  error?: string;
}

function appendMovement(
  movements: StockMovement[],
  movement: StockMovement
): StockMovement[] {
  return [movement, ...movements].slice(0, 500);
}

/**
 * Apply a signed quantity change to one item.
 * delta > 0 stock in; delta < 0 stock out.
 * By default refuses negative balances unless allowNegative is true.
 */
export function applyStockChange(
  items: InventoryItem[],
  movements: StockMovement[],
  input: {
    itemId: string;
    delta: number;
    type: MovementType;
    note?: string;
    refId?: string;
    allowNegative?: boolean;
  }
): ApplyResult {
  const idx = items.findIndex((i) => i.id === input.itemId);
  if (idx === -1) {
    return { items, movements, ok: false, error: "Item not found" };
  }

  const delta = Math.trunc(input.delta);
  if (delta === 0) {
    return { items, movements, ok: false, error: "Quantity change cannot be zero" };
  }

  const item = items[idx];
  const nextQty = item.quantity + delta;
  if (nextQty < 0 && !input.allowNegative) {
    return {
      items,
      movements,
      ok: false,
      error: `Not enough ${item.name}: have ${item.quantity}, need ${Math.abs(delta)}`,
    };
  }

  const updated: InventoryItem = {
    ...item,
    quantity: nextQty,
    updatedAt: nowIso(),
  };
  const nextItems = [...items];
  nextItems[idx] = updated;

  const movement: StockMovement = {
    id: `mov-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    itemId: item.id,
    itemName: item.name,
    type: input.type,
    delta,
    balanceAfter: nextQty,
    note: input.note?.trim() ?? "",
    createdAt: nowIso(),
    refId: input.refId,
  };

  return {
    items: nextItems,
    movements: appendMovement(movements, movement),
    ok: true,
  };
}

export function setAbsoluteQuantity(
  items: InventoryItem[],
  movements: StockMovement[],
  itemId: string,
  quantity: number,
  note?: string
): ApplyResult {
  const item = getItemById(items, itemId);
  if (!item) return { items, movements, ok: false, error: "Item not found" };
  const qty = Math.max(0, Math.floor(quantity));
  const delta = qty - item.quantity;
  if (delta === 0) {
    return { items, movements, ok: true };
  }
  return applyStockChange(items, movements, {
    itemId,
    delta,
    type: "adjust",
    note: note ?? `Set quantity to ${qty}`,
    allowNegative: true,
  });
}

export function updateItemMeta(
  items: InventoryItem[],
  itemId: string,
  patch: Partial<
    Pick<
      InventoryItem,
      "name" | "lowStockAt" | "defaultPrice" | "unit" | "category" | "sellable"
    >
  >
): InventoryItem[] {
  return items.map((i) =>
    i.id === itemId
      ? {
          ...i,
          ...patch,
          name: patch.name?.trim() || i.name,
          lowStockAt: Math.max(0, Math.floor(patch.lowStockAt ?? i.lowStockAt)),
          defaultPrice: Math.max(0, patch.defaultPrice ?? i.defaultPrice),
          updatedAt: nowIso(),
        }
      : i
  );
}

export function addCustomItem(
  items: InventoryItem[],
  input: {
    name: string;
    category: InventoryCategory;
    quantity?: number;
    unit?: string;
    lowStockAt?: number;
    defaultPrice?: number;
    sellable?: boolean;
  }
): { items: InventoryItem[]; item: InventoryItem } {
  const item: InventoryItem = {
    id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: input.name.trim() || "Custom item",
    category: input.category,
    quantity: Math.max(0, Math.floor(input.quantity ?? 0)),
    unit: input.unit?.trim() || "units",
    lowStockAt: Math.max(0, Math.floor(input.lowStockAt ?? 0)),
    defaultPrice: Math.max(0, input.defaultPrice ?? 0),
    sellable: input.sellable ?? true,
    system: false,
    updatedAt: nowIso(),
  };
  return { items: [...items, item], item };
}

export function deleteItem(
  items: InventoryItem[],
  itemId: string
): { items: InventoryItem[]; ok: boolean; error?: string } {
  const item = getItemById(items, itemId);
  if (!item) return { items, ok: false, error: "Item not found" };
  if (item.system) {
    return { items, ok: false, error: "Built-in items cannot be deleted" };
  }
  return { items: items.filter((i) => i.id !== itemId), ok: true };
}

export interface SaleLine {
  itemId: string;
  qty: number;
}

/** Deduct stock for a multi-line sale. All-or-nothing. */
export function deductForSale(
  items: InventoryItem[],
  movements: StockMovement[],
  lines: SaleLine[],
  saleId: string
): ApplyResult {
  // Validate first
  for (const line of lines) {
    const item = getItemById(items, line.itemId);
    if (!item) {
      return { items, movements, ok: false, error: "Sale item not found in inventory" };
    }
    if (line.qty <= 0) {
      return { items, movements, ok: false, error: "Invalid sale quantity" };
    }
    if (item.quantity < line.qty) {
      return {
        items,
        movements,
        ok: false,
        error: `Not enough ${item.name}: have ${item.quantity}, need ${line.qty}`,
      };
    }
  }

  let nextItems = items;
  let nextMovements = movements;
  for (const line of lines) {
    const result = applyStockChange(nextItems, nextMovements, {
      itemId: line.itemId,
      delta: -line.qty,
      type: "sale",
      note: `Sale #${saleId}`,
      refId: String(saleId),
    });
    if (!result.ok) return result;
    nextItems = result.items;
    nextMovements = result.movements;
  }
  return { items: nextItems, movements: nextMovements, ok: true };
}

/** Add day-old chicks from a hatch. */
export function addFromHatch(
  items: InventoryItem[],
  movements: StockMovement[],
  hatchedCount: number,
  batchName: string,
  batchId: string
): ApplyResult {
  const count = Math.floor(hatchedCount);
  if (count <= 0) {
    return { items, movements, ok: true };
  }
  return applyStockChange(items, movements, {
    itemId: ITEM_IDS.dayOld,
    delta: count,
    type: "hatch",
    note: `Hatch from ${batchName}`,
    refId: batchId,
  });
}

/** Chicks ready for sale = sellable livestock excluding parent stock. */
export function getChicksReadyCount(items: InventoryItem[]): number {
  return items
    .filter(
      (i) =>
        i.sellable &&
        i.category === "livestock" &&
        i.id !== ITEM_IDS.parentStock
    )
    .reduce((sum, i) => sum + i.quantity, 0);
}

export function getParentStockCount(items: InventoryItem[]): number {
  return getItemById(items, ITEM_IDS.parentStock)?.quantity ?? 0;
}

export function getLowStockItems(items: InventoryItem[]): InventoryItem[] {
  return items.filter(isLowStock);
}

export function formatMovementType(type: MovementType): string {
  const labels: Record<MovementType, string> = {
    in: "Stock in",
    out: "Stock out",
    adjust: "Adjustment",
    sale: "Sale",
    hatch: "Hatch",
    loss: "Loss / mortality",
  };
  return labels[type];
}

export function categoryLabel(category: InventoryCategory): string {
  const labels: Record<InventoryCategory, string> = {
    livestock: "Livestock",
    eggs: "Eggs",
    other: "Other",
  };
  return labels[category];
}
