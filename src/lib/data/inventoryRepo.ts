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
import { getCache, setCache } from "./idbStore";
import { enqueueMutation, isNetworkError } from "./outbox";

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
  if (!supabase) throw new Error("Supabase client is not configured");

  try {
    const { data, error } = await supabase
      .from("inventory_items")
      .select("*")
      .order("name");

    if (error) throw new Error(error.message);
    if (!data) return [];
    const items = (data as ItemRow[]).map(rowToItem);
    await setCache("inventory_items", items);
    return items;
  } catch (err) {
    if (isNetworkError(err)) {
      const cached = await getCache("inventory_items");
      if (cached) return cached;
    }
    throw err;
  }
}

export async function saveItems(items: InventoryItem[]): Promise<void> {
  if (getDataMode() === "local") {
    localSaveItems(items);
    return;
  }

  const supabase = getSupabase();
  if (!supabase) {
    throw new Error("Supabase client is not configured");
  }

  let existingMap = new Map<string, number>();
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      const { data: existing, error: existError } = await supabase.from("inventory_items").select("id, quantity");
      if (!existError && existing) {
        existingMap = new Map(existing.map((e) => [e.id as string, Number(e.quantity)]));
      }
    }
  } catch (e) {
    // offline or failed
  }

  const rows = items.map((item) => {
    const row = itemToRow(item);
    // Preserve the true cloud quantity to avoid overwriting it during a metadata save
    if (existingMap.has(item.id)) {
      row.quantity = existingMap.get(item.id)!;
    }
    return row;
  });

  await setCache("inventory_items", items);

  try {
    if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error("Failed to fetch");
    const { error } = await supabase.from("inventory_items").upsert(rows);
    if (error) throw new Error(error.message);
  } catch (err) {
    if (isNetworkError(err)) {
      await enqueueMutation("inventory_items", "UPSERT", rows);
      return;
    }
    throw err;
  }
}

export async function listMovements(): Promise<StockMovement[]> {
  if (getDataMode() === "local") return localLoadMovements();

  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase client is not configured");

  try {
    const { data, error } = await supabase
      .from("inventory_movements")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) throw new Error(error.message);
    const movements = (data as MovementRow[]).map(rowToMovement);
    await setCache("inventory_movements", movements);
    return movements;
  } catch (err) {
    if (isNetworkError(err)) {
      const cached = await getCache("inventory_movements");
      if (cached) return cached;
    }
    throw err;
  }
}

export async function listMovementsPaginated(
  page = 1,
  pageSize = 50,
  query = ""
): Promise<{ data: StockMovement[]; count: number }> {
  if (getDataMode() === "local") {
    let all = localLoadMovements();
    if (query) {
      const q = query.toLowerCase();
      all = all.filter(
        (m) =>
          m.itemName.toLowerCase().includes(q) ||
          m.note.toLowerCase().includes(q) ||
          m.type.toLowerCase().includes(q)
      );
    }
    const count = all.length;
    const data = all.slice((page - 1) * pageSize, page * pageSize);
    return { data, count };
  }

  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase client is not configured");

  try {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      throw new Error("Failed to fetch");
    }

    let qb = supabase
      .from("inventory_movements")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false });

    if (query) {
      qb = qb.or(`item_name.ilike.%${query}%,note.ilike.%${query}%,type.ilike.%${query}%`);
    }

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    const { data, error, count } = await qb.range(from, to);

    if (error) throw new Error(error.message);

    const movements = (data as MovementRow[]).map(rowToMovement);
    
    const cached = (await getCache("inventory_movements")) || [];
    const cacheMap = new Map((cached as StockMovement[]).map((m) => [m.id, m]));
    for (const m of movements) {
      cacheMap.set(m.id, m);
    }
    await setCache("inventory_movements", Array.from(cacheMap.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));

    return { data: movements, count: count ?? 0 };
  } catch (err) {
    if (isNetworkError(err)) {
      let all = ((await getCache("inventory_movements")) || []) as StockMovement[];
      if (query) {
        const q = query.toLowerCase();
        all = all.filter(
          (m) =>
            m.itemName.toLowerCase().includes(q) ||
            m.note.toLowerCase().includes(q) ||
            m.type.toLowerCase().includes(q)
        );
      }
      const count = all.length;
      const data = all.slice((page - 1) * pageSize, page * pageSize);
      return { data, count };
    }
    throw err;
  }
}

export async function saveMovements(movements: StockMovement[]): Promise<void> {
  if (getDataMode() === "local") {
    localSaveMovements(movements);
    return;
  }

  const supabase = getSupabase();
  if (!supabase) {
    throw new Error("Supabase client is not configured");
  }

  // Upsert latest movements (id-stable). Full replace of missing is expensive;
  // insert-only for new IDs, keep last 500 client-side.
  const rows = movements.slice(0, 500).map(movementToRow);
  await setCache("inventory_movements", movements);

  try {
    if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error("Failed to fetch");
    const { error } = await supabase.from("inventory_movements").upsert(rows);
    if (error) throw new Error(error.message);
  } catch (err) {
    if (isNetworkError(err)) {
      await enqueueMutation("inventory_movements", "UPSERT", rows);
      return;
    }
    throw err;
  }
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
