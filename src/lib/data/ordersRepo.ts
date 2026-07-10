import {
  type FarmerOrder,
  loadOrdersLocal,
  saveOrdersLocal,
} from "@/lib/orders";
import { getSupabase } from "@/lib/supabase/client";
import { getDataMode } from "./mode";

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
  if (!supabase) return loadOrdersLocal();

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

  return (orders as OrderRow[]).map((o) =>
    toOrder(o, byOrder.get(o.id) ?? [])
  );
}

/** Insert a single new order (public form or admin). Works as anon on cloud. */
export async function insertOrder(order: FarmerOrder): Promise<void> {
  if (getDataMode() === "local") {
    const all = loadOrdersLocal();
    saveOrdersLocal([order, ...all]);
    return;
  }

  const supabase = getSupabase();
  if (!supabase) {
    const all = loadOrdersLocal();
    saveOrdersLocal([order, ...all]);
    return;
  }

  const { error } = await supabase
    .from("farmer_orders")
    .insert(orderToRow(order));
  if (error) throw new Error(error.message);

  const lines = order.items.map((i) => ({
    order_id: order.id,
    breed: i.breed,
    age: i.age,
    item_id: i.itemId,
    name: i.name,
    qty: i.qty,
    unit_price: i.unitPrice,
  }));

  if (lines.length) {
    const { error: lineError } = await supabase
      .from("farmer_order_items")
      .insert(lines);
    if (lineError) throw new Error(lineError.message);
  }
}

/** Staff: persist full order list (status updates, deletes). */
export async function saveOrders(orders: FarmerOrder[]): Promise<void> {
  if (getDataMode() === "local") {
    saveOrdersLocal(orders);
    return;
  }

  const supabase = getSupabase();
  if (!supabase) {
    saveOrdersLocal(orders);
    return;
  }

  const rows = orders.map(orderToRow);
  const { error } = await supabase.from("farmer_orders").upsert(rows);
  if (error) throw new Error(error.message);

  const ids = orders.map((o) => o.id);
  if (ids.length) {
    await supabase.from("farmer_order_items").delete().in("order_id", ids);
  }

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
  if (lines.length) {
    const { error: lineError } = await supabase
      .from("farmer_order_items")
      .insert(lines);
    if (lineError) throw new Error(lineError.message);
  }

  const { data: existing } = await supabase.from("farmer_orders").select("id");
  const toDelete = (existing ?? [])
    .map((r) => r.id as string)
    .filter((id) => !ids.includes(id));
  if (toDelete.length) {
    await supabase.from("farmer_orders").delete().in("id", toDelete);
  }
}

/** Update one order in place (status change). */
export async function updateOrder(order: FarmerOrder): Promise<void> {
  if (getDataMode() === "local") {
    const all = loadOrdersLocal().map((o) => (o.id === order.id ? order : o));
    saveOrdersLocal(all);
    return;
  }

  const supabase = getSupabase();
  if (!supabase) {
    const all = loadOrdersLocal().map((o) => (o.id === order.id ? order : o));
    saveOrdersLocal(all);
    return;
  }

  const { error } = await supabase
    .from("farmer_orders")
    .upsert(orderToRow(order));
  if (error) throw new Error(error.message);
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
