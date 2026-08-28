import {
  type FarmerOrder,
  loadOrdersLocal,
  saveOrdersLocal,
} from "@/lib/orders";
import { getSupabase } from "@/lib/supabase/client";
import { getDataMode } from "./mode";
import { getCache, setCache } from "./idbStore";
import { enqueueMutation, isNetworkError } from "./outbox";

type OrderRow = {
  id: string;
  created_at: string;
  customer_name: string;
  customer_phone: string;
  location: string;
  notes: string;
  total: number;
  status: FarmerOrder["status"];
  payment_ref: string;
  paid_at: string | null;
  fulfilled_at: string | null;
  source: FarmerOrder["source"];
};

type ItemRow = {
  order_id: string;
  breed: FarmerOrder["items"][0]["breed"];
  age: FarmerOrder["items"][0]["age"];
  item_id: string;
  name: string;
  qty: number;
  unit_price: number;
};

function toOrder(row: OrderRow, items: ItemRow[]): FarmerOrder {
  return {
    id: row.id,
    createdAt: row.created_at,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    location: row.location ?? "",
    notes: row.notes ?? "",
    total: Number(row.total),
    status: row.status,
    paymentRef: row.payment_ref ?? "",
    paidAt: row.paid_at,
    fulfilledAt: row.fulfilled_at,
    source: row.source,
    items: items.map((i) => ({
      breed: i.breed,
      age: i.age,
      itemId: i.item_id,
      name: i.name,
      qty: Number(i.qty),
      unitPrice: Number(i.unit_price),
    })),
  };
}

function orderToRow(o: FarmerOrder): OrderRow {
  return {
    id: o.id,
    created_at: o.createdAt,
    customer_name: o.customerName,
    customer_phone: o.customerPhone,
    location: o.location,
    notes: o.notes,
    total: o.total,
    status: o.status,
    payment_ref: o.paymentRef,
    paid_at: o.paidAt,
    fulfilled_at: o.fulfilledAt,
    source: o.source,
  };
}

/** Staff: list all orders (cloud requires login). */
export async function listOrders(): Promise<FarmerOrder[]> {
  if (getDataMode() === "local") return loadOrdersLocal();

  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase client is not configured");

  try {
    const { data: orders, error } = await supabase
      .from("farmer_orders")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1000);

    if (error) throw new Error(error.message);
    if (!orders?.length) return [];

    const ids = orders.map((o) => o.id);
    const { data: lines, error: lineErr } = await supabase
      .from("farmer_order_items")
      .select("*")
      .in("order_id", ids);

    if (lineErr) throw new Error(lineErr.message);

    const byOrder = new Map<string, ItemRow[]>();
    for (const line of (lines ?? []) as ItemRow[]) {
      const list = byOrder.get(line.order_id) ?? [];
      list.push(line);
      byOrder.set(line.order_id, list);
    }

    const mapped = (orders as OrderRow[]).map((o) =>
      toOrder(o, byOrder.get(o.id) ?? [])
    );
    await setCache("farmer_orders", mapped);
    return mapped;
  } catch (err) {
    if (isNetworkError(err)) {
      const cached = await getCache("farmer_orders");
      if (cached) return cached;
    }
    throw err;
  }
}

export async function listOrdersPaginated(
  page = 1,
  pageSize = 50,
  query = "",
  statusFilter = "all"
): Promise<{ data: FarmerOrder[]; count: number }> {
  if (getDataMode() === "local") {
    let all = loadOrdersLocal();
    if (statusFilter !== "all") {
      all = all.filter((o) => o.status === statusFilter);
    }
    if (query) {
      const q = query.toLowerCase();
      all = all.filter(
        (o) =>
          o.customerName.toLowerCase().includes(q) ||
          o.location.toLowerCase().includes(q)
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
      .from("farmer_orders")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false });

    if (statusFilter !== "all") {
      qb = qb.eq("status", statusFilter);
    }

    if (query) {
      qb = qb.or(`customer_name.ilike.%${query}%,location.ilike.%${query}%`);
    }

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    const { data: orders, error, count } = await qb.range(from, to);

    if (error) throw new Error(error.message);
    if (!orders?.length) return { data: [], count: count ?? 0 };

    const ids = orders.map((o) => o.id);
    const { data: lines, error: lineErr } = await supabase
      .from("farmer_order_items")
      .select("*")
      .in("order_id", ids);

    if (lineErr) throw new Error(lineErr.message);

    const byOrder = new Map<string, ItemRow[]>();
    for (const line of (lines ?? []) as ItemRow[]) {
      const list = byOrder.get(line.order_id) ?? [];
      list.push(line);
      byOrder.set(line.order_id, list);
    }

    const mapped = (orders as OrderRow[]).map((o) =>
      toOrder(o, byOrder.get(o.id) ?? [])
    );

    const cached = (await getCache("farmer_orders")) || [];
    const cacheMap = new Map((cached as FarmerOrder[]).map((o) => [o.id, o]));
    for (const o of mapped) {
      cacheMap.set(o.id, o);
    }
    await setCache("farmer_orders", Array.from(cacheMap.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));

    return { data: mapped, count: count ?? 0 };
  } catch (err) {
    if (isNetworkError(err)) {
      let all = ((await getCache("farmer_orders")) || []) as FarmerOrder[];
      if (statusFilter !== "all") {
        all = all.filter((o) => o.status === statusFilter);
      }
      if (query) {
        const q = query.toLowerCase();
        all = all.filter(
          (o) =>
            o.customerName.toLowerCase().includes(q) ||
            o.location.toLowerCase().includes(q)
        );
      }
      const count = all.length;
      const data = all.slice((page - 1) * pageSize, page * pageSize);
      return { data, count };
    }
    throw err;
  }
}

export async function getOrderCounts(): Promise<Record<string, number>> {
  if (getDataMode() === "local") {
    const all = loadOrdersLocal();
    return {
      pending: all.filter((o) => o.status === "pending").length,
      paid: all.filter((o) => o.status === "paid").length,
      fulfilled: all.filter((o) => o.status === "fulfilled").length,
      cancelled: all.filter((o) => o.status === "cancelled").length,
    };
  }

  const supabase = getSupabase();
  if (!supabase) return { pending: 0, paid: 0, fulfilled: 0, cancelled: 0 };

  try {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      throw new Error("offline");
    }
    // We can run parallel count queries
    const statuses = ["pending", "paid", "fulfilled", "cancelled"];
    const promises = statuses.map((status) =>
      supabase
        .from("farmer_orders")
        .select("*", { count: "exact", head: true })
        .eq("status", status)
    );
    const results = await Promise.all(promises);
    return {
      pending: results[0].count ?? 0,
      paid: results[1].count ?? 0,
      fulfilled: results[2].count ?? 0,
      cancelled: results[3].count ?? 0,
    };
  } catch (err) {
    if (isNetworkError(err)) {
      const all = ((await getCache("farmer_orders")) || []) as FarmerOrder[];
      return {
        pending: all.filter((o) => o.status === "pending").length,
        paid: all.filter((o) => o.status === "paid").length,
        fulfilled: all.filter((o) => o.status === "fulfilled").length,
        cancelled: all.filter((o) => o.status === "cancelled").length,
      };
    }
    return { pending: 0, paid: 0, fulfilled: 0, cancelled: 0 };
  }
}

/** Insert a single new order (public form or admin). Works as anon on cloud. */
export async function insertOrder(order: FarmerOrder): Promise<void> {
  if (getDataMode() === "local") {
    const all = loadOrdersLocal();
    saveOrdersLocal([order, ...all]);
    return;
  }

  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase client is not configured");

  const cached = await getCache("farmer_orders") || [];
  await setCache("farmer_orders", [order, ...cached]);

  // Use the new secure RPC to insert order and reserve stock
  const { createOrderTransaction } = await import('./transactions');
  await createOrderTransaction(order);
}

/** Staff: persist full order list (status updates, deletes). */
export async function saveOrders(orders: FarmerOrder[]): Promise<void> {
  if (getDataMode() === "local") {
    saveOrdersLocal(orders);
    return;
  }

  const supabase = getSupabase();
  if (!supabase) {
    throw new Error("Supabase client is not configured");
  }

  const rows = orders.map(orderToRow);
  const ids = orders.map((o) => o.id);
  const lines = orders.flatMap((o) =>
    o.items.map((i) => ({
      order_id: o.id,
      breed: i.breed,
      age: i.age,
      item_id: i.itemId,
      name: i.name,
      qty: i.qty,
      unit_price: i.unitPrice,
    }))
  );

  await setCache("farmer_orders", orders);

  try {
    if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error("Failed to fetch");
    
    const { error } = await supabase.from("farmer_orders").upsert(rows);
    if (error) throw new Error(error.message);

    if (ids.length) {
      await supabase.from("farmer_order_items").delete().in("order_id", ids);
    }

    if (lines.length) {
      const { error: lineError } = await supabase
        .from("farmer_order_items")
        .insert(lines);
      if (lineError) throw new Error(lineError.message);
    }
  } catch (err) {
    if (isNetworkError(err)) {
      await enqueueMutation("farmer_orders", "UPSERT", rows);
      if (ids.length) {
        for (const id of ids) {
          await enqueueMutation("farmer_order_items", "DELETE", { column: "order_id", value: id });
        }
      }
      if (lines.length) {
        await enqueueMutation("farmer_order_items", "INSERT", lines);
      }
      return;
    }
    throw err;
  }

  // REMOVED: Bulk delete logic that destroyed cloud records missing from the local cache.
}

/** Update one order in place (status change). */
export async function updateOrder(order: FarmerOrder): Promise<void> {
  if (getDataMode() === "local") {
    const all = loadOrdersLocal().map((o) => (o.id === order.id ? order : o));
    saveOrdersLocal(all);
    return;
  }

  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase client is not configured");

  const cached = (await getCache("farmer_orders") || []) as FarmerOrder[];
  await setCache("farmer_orders", cached.map(o => o.id === order.id ? order : o));

  const row = orderToRow(order);
  try {
    if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error("Failed to fetch");
    const { error } = await supabase
      .from("farmer_orders")
      .upsert(row);
    if (error) throw new Error(error.message);
  } catch (err) {
    if (isNetworkError(err)) {
      await enqueueMutation("farmer_orders", "UPSERT", row);
      return;
    }
    throw err;
  }
}

export async function migrateLocalOrdersToCloud(): Promise<number> {
  const orders = loadOrdersLocal();
  if (!orders.length) return 0;
  for (const o of orders) {
    try {
      await insertOrder(o);
    } catch {
      await updateOrder(o);
    }
  }
  return orders.length;
}
