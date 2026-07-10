import {
  type InventoryItem,
  type StockMovement,
  INVENTORY_ITEMS_KEY,
  INVENTORY_MOVEMENTS_KEY,
  loadItems as localLoadItems,
  loadMovements as localLoadMovements,
  saveItems as localSaveItems,
  saveMovements as localSaveMovements,
} from "@/lib/inventory";
import { getSupabase } from "@/lib/supabase/client";
import { getDataMode } from "./mode";

type ItemRow = {
  id: string;
  name: string;
  category: InventoryItem["category"];
  quantity: number;
  unit: string;
  low_stock_at: number;
  default_price: number;
  sellable: boolean;
  system: boolean;
  updated_at: string;
};

type MovementRow = {
  id: string;
  item_id: string;
  item_name: string;
  type: StockMovement["type"];
  delta: number;
  balance_after: number;
  note: string;
  ref_id: string | null;
  created_at: string;
};

function rowToItem(row: ItemRow): InventoryItem {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    quantity: Number(row.quantity),
    unit: row.unit,
    lowStockAt: Number(row.low_stock_at),
    defaultPrice: Number(row.default_price),
    sellable: row.sellable,
    system: row.system,
    updatedAt: row.updated_at,
  };
}

function itemToRow(item: InventoryItem): ItemRow {
  return {
    id: item.id,
    name: item.name,
    category: item.category,
    quantity: item.quantity,
    unit: item.unit,
    low_stock_at: item.lowStockAt,
    default_price: item.defaultPrice,
    sellable: item.sellable,
    system: item.system,
    updated_at: item.updatedAt,
  };
}

function rowToMovement(row: MovementRow): StockMovement {
  return {
    id: row.id,
    itemId: row.item_id,
    itemName: row.item_name,
    type: row.type,
    delta: Number(row.delta),
    balanceAfter: Number(row.balance_after),
    note: row.note ?? "",
    createdAt: row.created_at,
    refId: row.ref_id ?? undefined,
  };
}

function movementToRow(m: StockMovement): MovementRow {
  return {
    id: m.id,
    item_id: m.itemId,
    item_name: m.itemName,
    type: m.type,
    delta: m.delta,
    balance_after: m.balanceAfter,
    note: m.note,
    ref_id: m.refId ?? null,
    created_at: m.createdAt,
  };
}

export async function listItems(): Promise<InventoryItem[]> {
  if (getDataMode() === "local") return localLoadItems();

  const supabase = getSupabase();
  if (!supabase) return localLoadItems();

  const { data, error } = await supabase
    .from("inventory_items")
    .select("*")
    .order("name");

  if (error) throw new Error(error.message);
  if (!data || data.length === 0) {
    // First run: seed from defaults if cloud empty
    const seeded = localLoadItems();
    await saveItems(seeded);
    return seeded;
  }
  return (data as ItemRow[]).map(rowToItem);
}

export async function saveItems(items: InventoryItem[]): Promise<void> {
  if (getDataMode() === "local") {
    localSaveItems(items);
    return;
  }

  const supabase = getSupabase();
  if (!supabase) {
    localSaveItems(items);
    return;
  }

  const rows = items.map(itemToRow);
  const { error } = await supabase.from("inventory_items").upsert(rows);
  if (error) throw new Error(error.message);

  // Remove cloud rows that no longer exist (custom deletes)
  const ids = items.map((i) => i.id);
  const { data: existing } = await supabase.from("inventory_items").select("id");
  const toDelete = (existing ?? [])
    .map((r) => r.id as string)
    .filter((id) => !ids.includes(id));
  if (toDelete.length) {
    await supabase.from("inventory_items").delete().in("id", toDelete);
  }
}

export async function listMovements(): Promise<StockMovement[]> {
  if (getDataMode() === "local") return localLoadMovements();

  const supabase = getSupabase();
  if (!supabase) return localLoadMovements();

  const { data, error } = await supabase
    .from("inventory_movements")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) throw new Error(error.message);
  return (data as MovementRow[]).map(rowToMovement);
}

export async function saveMovements(movements: StockMovement[]): Promise<void> {
  if (getDataMode() === "local") {
    localSaveMovements(movements);
    return;
  }

  const supabase = getSupabase();
  if (!supabase) {
    localSaveMovements(movements);
    return;
  }

  // Upsert latest movements (id-stable). Full replace of missing is expensive;
  // insert-only for new IDs, keep last 500 client-side.
  const rows = movements.slice(0, 500).map(movementToRow);
  const { error } = await supabase.from("inventory_movements").upsert(rows);
  if (error) throw new Error(error.message);
}

/** Push browser localStorage inventory into Supabase (one-time migration). */
export async function migrateLocalInventoryToCloud(): Promise<{
  items: number;
  movements: number;
}> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase not configured");

  const items = localLoadItems();
  const movements = localLoadMovements();
  await saveItems(items);
  if (movements.length) {
    const { error } = await supabase
      .from("inventory_movements")
      .upsert(movements.map(movementToRow));
    if (error) throw new Error(error.message);
  }
  return { items: items.length, movements: movements.length };
}

export { INVENTORY_ITEMS_KEY, INVENTORY_MOVEMENTS_KEY };
