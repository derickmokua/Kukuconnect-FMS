import { getDataMode } from "./mode";
import { getSupabase } from "@/lib/supabase/client";
import { getCache, setCache } from "./idbStore";
import { enqueueMutation, isNetworkError } from "./outbox";
import {
  type Sale,
  loadSales as localLoadSales,
  saveSales as localSaveSales,
  addSale,
} from "@/lib/sales";
import {
  type InventoryItem,
  type StockMovement,
  type ApplyResult,
  deductForSale,
  loadItems as localLoadItems,
  loadMovements as localLoadMovements,
  saveItems as localSaveItems,
  saveMovements as localSaveMovements,
  applyStockChange,
} from "@/lib/inventory";
import {
  type BrooderLot,
  type MortalityEvent,
  loadLotsLocal,
  saveLotsLocal,
  deductBrooderLotsForSale,
  loadMortalityLocal,
  saveMortalityLocal,
} from "@/lib/brooder";
import {
  type IncubationBatch,
  loadBatches as localLoadBatches,
  saveBatches as localSaveBatches,
} from "@/lib/incubation";

function genId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}



export type CartItem = {
  itemId: string;
  name: string;
  qty: number;
  price: number;
  isDiscounted?: boolean;
};

export async function buildRecordSalePayload(sale: Sale, cart: CartItem[]) {
  const lotDeductions: { lot_id: string; qty: number; is_discounted: boolean }[] = [];
  const mode = getDataMode();
  let nextCloudLots: BrooderLot[] = [];
  let originalCloudLots: BrooderLot[] = [];

  if (mode !== "local") {
    const activeLots = (await getCache("brooder_lots")) as BrooderLot[] || [];
    originalCloudLots = JSON.parse(JSON.stringify(activeLots));
    nextCloudLots = deductBrooderLotsForSale(
      activeLots,
      cart.map((c) => ({ itemId: c.itemId, qty: c.qty }))
    );
  }

  for (const originalLot of originalCloudLots) {
    const newLot = nextCloudLots.find((l) => l.id === originalLot.id);
    if (newLot) {
      if (newLot.totalSales > originalLot.totalSales) {
        lotDeductions.push({
          lot_id: originalLot.id,
          qty: newLot.totalSales - originalLot.totalSales,
          is_discounted: false,
        });
      }
      if (newLot.totalDiscounted > originalLot.totalDiscounted) {
        lotDeductions.push({
          lot_id: originalLot.id,
          qty: newLot.totalDiscounted - originalLot.totalDiscounted,
          is_discounted: true,
        });
      }
    }
  }

  const movementsPayload = cart.map((c) => ({
    id: genId("mov"),
    item_id: c.itemId,
    item_name: c.name,
    type: "sale",
    delta: -c.qty,
    balance_after: 0,
    note: `Sale #${sale.id}`,
    ref_id: sale.id,
    created_at: sale.createdAt,
  }));

  return {
    sale: {
      id: sale.id,
      created_at: sale.createdAt,
      date_label: sale.dateLabel,
      customer: sale.customer,
      customer_phone: sale.customerPhone,
      total: sale.total,
      receipt_number: sale.receiptNumber ?? "",
      payment_method: sale.paymentMethod ?? "Cash",
      mpesa_code: sale.mpesaCode ?? "",
      served_by: sale.servedBy ?? "",
    },
    items: cart.map((c) => ({
      sale_id: sale.id,
      item_id: c.itemId,
      name: c.name,
      qty: c.qty,
      price: c.price,
    })),
    movements: movementsPayload,
    brooderDeductions: lotDeductions,
  };
}

/**
 * Record a sale atomically.
 */
export async function recordSaleTransaction(
  sale: Sale,
  cart: CartItem[]
): Promise<void> {
  const mode = getDataMode();

  if (mode === "local") {
    const items = localLoadItems();
    const movements = localLoadMovements();
    const result = deductForSale(
      items,
      movements,
      cart.map((c) => ({ itemId: c.itemId, qty: c.qty })),
      sale.id,
      sale.createdAt
    );
    if (!result.ok) throw new Error(result.error);
    localSaveItems(result.items);
    localSaveMovements(result.movements);

    const activeLots = loadLotsLocal();
    const nextLots = deductBrooderLotsForSale(
      activeLots,
      cart.map((c) => ({ itemId: c.itemId, qty: c.qty }))
    );
    saveLotsLocal(nextLots);

    const sales = localLoadSales();
    localSaveSales([sale, ...sales]);
    return;
  }

  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase is not configured.");

  // Optimistic updates
  const items = (await getCache("inventory_items") || []) as InventoryItem[];
  const movements = (await getCache("inventory_movements") || []) as StockMovement[];
  const invRes = deductForSale(
    items,
    movements,
    cart.map((c) => ({ itemId: c.itemId, qty: c.qty })),
    sale.id,
    sale.createdAt
  );
  if (invRes.ok) {
    await setCache("inventory_items", invRes.items);
    await setCache("inventory_movements", invRes.movements);
  }

  const cachedLots = (await getCache("brooder_lots") || []) as BrooderLot[];
  const activeLots = cachedLots.filter(l => l.status === "active").sort((a, b) => a.hatchDate.localeCompare(b.hatchDate));
  const nextLots = deductBrooderLotsForSale(activeLots, cart);
  await setCache("brooder_lots", cachedLots.map(l => nextLots.find(n => n.id === l.id) || l));

  const sales = (await getCache("sales") || []) as Sale[];
  await setCache("sales", addSale(sales, sale));

  const payload = await buildRecordSalePayload(sale, cart);

  try {
    if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error("Failed to fetch");
    const { error } = await supabase.rpc("record_sale", { payload });
    if (error) {
      if (error.message.includes("could not find the function")) {
        console.warn("RPC record_sale missing! Falling back to individual saves.");
        throw new Error("RPC functions missing. Please run supabase/rpc.sql in your Supabase SQL Editor.");
      }
      throw new Error(error.message);
    }
  } catch (err) {
    if (isNetworkError(err)) {
      await enqueueMutation("record_sale", "RPC", payload);
      return;
    }
    throw err;
  }
}

/**
 * Adjust inventory atomically.
 */
export async function adjustInventoryTransaction(
  itemId: string,
  delta: number,
  type: StockMovement["type"],
  note: string,
  refId?: string,
  allowNegative = false
): Promise<void> {
  const mode = getDataMode();
  const createdAt = new Date().toISOString();

  if (mode === "local") {
    const items = localLoadItems();
    const movements = localLoadMovements();
    const result = applyStockChange(items, movements, {
      itemId,
      delta,
      type,
      note,
      refId,
      allowNegative,
      createdAt,
    });
    if (!result.ok) throw new Error(result.error);
    localSaveItems(result.items);
    localSaveMovements(result.movements);
    return;
  }

  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase is not configured.");

  // Optimistic IDB updates
  const items = (await getCache("inventory_items") || []) as InventoryItem[];
  const movements = (await getCache("inventory_movements") || []) as StockMovement[];
  const result = applyStockChange(items, movements, {
    itemId,
    delta,
    type,
    note,
    refId,
    allowNegative,
    createdAt,
  });
  if (result.ok) {
    await setCache("inventory_items", result.items);
    await setCache("inventory_movements", result.movements);
  }

  // Try fetch for validation if needed
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      if (!allowNegative && delta < 0) {
        const { data: item } = await supabase
          .from("inventory_items")
          .select("quantity, name")
          .eq("id", itemId)
          .single();
        if (item && item.quantity + delta < 0) {
          throw new Error(`Not enough ${item.name}: have ${item.quantity}, need ${Math.abs(delta)}`);
        }
      }
    }
  } catch (err) {
    // If offline, we skip true cloud validation, but optimistic update has its own logic
  }

  let itemName = "Unknown Item";
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      const { data: itemNameObj } = await supabase
        .from("inventory_items")
        .select("name")
        .eq("id", itemId)
        .single();
      if (itemNameObj) itemName = itemNameObj.name;
    } else {
      const item = items.find(i => i.id === itemId);
      if (item) itemName = item.name;
    }
  } catch(e) {
    // ignore
  }

  const payload = {
    movement: {
      id: genId("mov"),
      item_id: itemId,
      item_name: itemName,
      type,
      delta,
      balance_after: 0,
      note,
      ref_id: refId ?? null,
      created_at: createdAt,
    },
  };

  try {
    if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error("Failed to fetch");
    const { error } = await supabase.rpc("adjust_inventory", { payload });
    if (error) {
      if (error.message.includes("could not find the function")) {
        throw new Error("RPC functions missing. Please run supabase/rpc.sql in your Supabase SQL Editor.");
      }
      throw new Error(error.message);
    }
  } catch (err) {
    if (isNetworkError(err)) {
      await enqueueMutation("adjust_inventory", "RPC", payload);
      return;
    }
    throw err;
  }
}

/**
 * Record a mortality event atomically.
 */
export async function recordMortalityTransaction(
  event: MortalityEvent,
  movement: StockMovement | null = null
): Promise<void> {
  const mode = getDataMode();

  if (mode === "local") {
    const lots = loadLotsLocal();
    const nextLots = lots.map((l) =>
      l.id === event.lotId
        ? {
            ...l,
            quantity: Math.max(0, l.quantity - event.qty),
            totalMortality: l.totalMortality + event.qty,
          }
        : l
    );
    saveLotsLocal(nextLots);
    const mortalities = loadMortalityLocal();
    saveMortalityLocal([event, ...mortalities]);
    
    if (movement) {
      const items = localLoadItems();
      const movements = localLoadMovements();
      const nextItems = items.map((i) =>
        i.id === movement.itemId
          ? { ...i, quantity: i.quantity + movement.delta }
          : i
      );
      localSaveItems(nextItems);
      localSaveMovements([movement, ...movements]);
    }
    return;
  }

  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase is not configured.");

  // Optimistic updates
  const lots = (await getCache("brooder_lots") || []) as BrooderLot[];
  const nextLots = lots.map((l) =>
    l.id === event.lotId
      ? {
          ...l,
          quantity: Math.max(0, l.quantity - event.qty),
          totalMortality: l.totalMortality + event.qty,
        }
      : l
  );
  await setCache("brooder_lots", nextLots);
  
  const mortalities = (await getCache("mortality_events") || []) as MortalityEvent[];
  await setCache("mortality_events", [event, ...mortalities]);
  
  if (movement) {
    const items = (await getCache("inventory_items") || []) as InventoryItem[];
    const movements = (await getCache("inventory_movements") || []) as StockMovement[];
    const nextItems = items.map((i) =>
      i.id === movement.itemId
        ? { ...i, quantity: i.quantity + movement.delta }
        : i
    );
    await setCache("inventory_items", nextItems);
    await setCache("inventory_movements", [movement, ...movements]);
  }

  const payload = {
    event: {
      id: event.id,
      lot_id: event.lotId,
      lot_name: event.lotName,
      qty: event.qty,
      reason: event.reason,
      date: event.date,
      created_at: event.createdAt,
    },
    movement: movement ? {
      id: movement.id,
      item_id: movement.itemId,
      item_name: movement.itemName,
      type: movement.type,
      delta: movement.delta,
      balance_after: 0,
      note: movement.note,
      ref_id: movement.refId ?? null,
      created_at: movement.createdAt,
    } : null,
  };

  try {
    if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error("Failed to fetch");
    const { error } = await supabase.rpc("record_mortality", { payload });
    if (error) {
      if (error.message.includes("could not find the function")) {
        throw new Error("RPC functions missing. Please run supabase/rpc.sql in your Supabase SQL Editor.");
      }
      throw new Error(error.message);
    }
  } catch (err) {
    if (isNetworkError(err)) {
      await enqueueMutation("record_mortality", "RPC", payload);
      return;
    }
    throw err;
  }
}

/**
 * Record a hatch event atomically.
 */
export async function recordHatchTransaction(
  batch: IncubationBatch,
  dayOldMovement: StockMovement | null,
  newBrooderLot: BrooderLot | null
): Promise<void> {
  const mode = getDataMode();

  if (mode === "local") {
    // 1. Update batch
    const batches = localLoadBatches();
    const nextBatches = batches.map((b) => (b.id === batch.id ? batch : b));
    localSaveBatches(nextBatches);

    // 2. Inventory
    if (dayOldMovement) {
      const items = localLoadItems();
      const movements = localLoadMovements();
      const nextItems = items.map((i) =>
        i.id === dayOldMovement.itemId
          ? { ...i, quantity: i.quantity + dayOldMovement.delta }
          : i
      );
      localSaveItems(nextItems);
      localSaveMovements([dayOldMovement, ...movements]);
    }

    // 3. Brooder Lot
    if (newBrooderLot) {
      const lots = loadLotsLocal();
      saveLotsLocal([newBrooderLot, ...lots]);
    }
    return;
  }

  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase is not configured.");

  // Optimistic updates
  const batches = (await getCache("incubation_batches") || []) as IncubationBatch[];
  const nextBatches = batches.map((b) => (b.id === batch.id ? batch : b));
  await setCache("incubation_batches", nextBatches);

  if (dayOldMovement) {
    const items = (await getCache("inventory_items") || []) as InventoryItem[];
    const movements = (await getCache("inventory_movements") || []) as StockMovement[];
    const nextItems = items.map((i) =>
      i.id === dayOldMovement.itemId
        ? { ...i, quantity: i.quantity + dayOldMovement.delta }
        : i
    );
    await setCache("inventory_items", nextItems);
    await setCache("inventory_movements", [dayOldMovement, ...movements]);
  }

  if (newBrooderLot) {
    const lots = (await getCache("brooder_lots") || []) as BrooderLot[];
    await setCache("brooder_lots", [newBrooderLot, ...lots]);
  }

  const payload = {
    batch: {
      id: batch.id,
      status: batch.status,
      hatched_count: batch.hatchedCount,
      hatched_at: batch.hatchedAt,
      notes: batch.notes,
    },
    movement: dayOldMovement
      ? {
          id: dayOldMovement.id,
          item_id: dayOldMovement.itemId,
          item_name: dayOldMovement.itemName,
          type: dayOldMovement.type,
          delta: dayOldMovement.delta,
          balance_after: 0,
          note: dayOldMovement.note,
          ref_id: dayOldMovement.refId ?? null,
          created_at: dayOldMovement.createdAt,
        }
      : null,
    brooderLot: newBrooderLot
      ? {
          id: newBrooderLot.id,
          name: newBrooderLot.name,
          hatch_date: newBrooderLot.hatchDate,
          quantity: newBrooderLot.quantity,
          initial_quantity: newBrooderLot.initialQuantity,
          stage_id: newBrooderLot.stageId,
          breed: newBrooderLot.breed,
          notes: newBrooderLot.notes,
          status: newBrooderLot.status,
          last_aged_date: newBrooderLot.lastAgedDate,
          total_mortality: newBrooderLot.totalMortality,
          total_sales: newBrooderLot.totalSales,
          total_discounted: newBrooderLot.totalDiscounted,
          created_at: newBrooderLot.createdAt,
          brooder: newBrooderLot.brooder,
        }
      : null,
  };

  try {
    if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error("Failed to fetch");
    const { error } = await supabase.rpc("record_hatch", { payload });
    if (error) {
      if (error.message.includes("could not find the function")) {
        throw new Error("RPC functions missing. Please run supabase/rpc.sql in your Supabase SQL Editor.");
      }
      throw new Error(error.message);
    }
  } catch (err) {
    if (isNetworkError(err)) {
      await enqueueMutation("record_hatch", "RPC", payload);
      return;
    }
    throw err;
  }
}

/**
 * Submit an order via RPC to safely check prices and reserve inventory.
 */
export async function createOrderTransaction(order: any): Promise<void> {
  const mode = getDataMode();
  if (mode === "local") {
    // Local fallback - no reservation logic, just save
    return;
  }

  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase is not configured.");

  const payload = {
    order: {
      id: order.id,
      created_at: order.createdAt,
      customer_name: order.customerName,
      customer_phone: order.customerPhone,
      location: order.location,
      notes: order.notes,
      source: order.source,
    },
    items: order.items.map((i: any) => ({
      breed: i.breed,
      age: i.age,
      item_id: i.itemId,
      name: i.name,
      qty: i.qty,
    })),
  };

  try {
    if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error("Failed to fetch");
    const { error } = await supabase.rpc("create_order", { payload });
    if (error) throw new Error(error.message);
  } catch (err) {
    if (isNetworkError(err)) {
      await enqueueMutation("create_order", "RPC", payload);
      return;
    }
    throw err;
  }
}

/**
 * Process order payment via RPC (clears reservation, deducts stock, creates sale).
 */
export async function payOrderTransaction(
  orderId: string,
  paymentRef: string,
  salePayload: any
): Promise<void> {
  const mode = getDataMode();
  if (mode === "local") return;

  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase is not configured.");

  const payload = {
    order_id: orderId,
    payment_ref: paymentRef,
    sale_payload: salePayload,
  };

  try {
    if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error("Failed to fetch");
    const { error } = await supabase.rpc("process_order_payment", { payload });
    if (error) throw new Error(error.message);
  } catch (err) {
    if (isNetworkError(err)) {
      await enqueueMutation("process_order_payment", "RPC", payload);
      return;
    }
    throw err;
  }
}

/**
 * Cancel an order via RPC (clears reservation).
 */
export async function cancelOrderTransaction(orderId: string): Promise<void> {
  const mode = getDataMode();
  if (mode === "local") return;

  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase is not configured.");

  const payload = { order_id: orderId };

  try {
    if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error("Failed to fetch");
    const { error } = await supabase.rpc("cancel_order", { payload });
    if (error) throw new Error(error.message);
  } catch (err) {
    if (isNetworkError(err)) {
      await enqueueMutation("cancel_order", "RPC", payload);
      return;
    }
    throw err;
  }
}
