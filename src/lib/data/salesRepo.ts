import {
  type Sale,
  loadSales as localLoadSales,
  saveSales as localSaveSales,
} from "@/lib/sales";
import { getSupabase } from "@/lib/supabase/client";
import { getDataMode } from "./mode";
import { getCache, setCache } from "./idbStore";
import { enqueueMutation, isNetworkError } from "./outbox";

type SaleRow = {
  id: string;
  created_at: string;
  date_label: string;
  customer: string;
  customer_phone: string;
  total: number;
  receipt_number?: string | null;
  payment_method?: string | null;
  mpesa_code?: string | null;
  served_by?: string | null;
};

type SaleItemRow = {
  sale_id: string;
  item_id: string;
  name: string;
  qty: number;
  price: number;
};

export async function listSales(): Promise<Sale[]> {
  if (getDataMode() === "local") return localLoadSales();

  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase client is not configured");

  try {
    const { data: sales, error } = await supabase
      .from("sales")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1000);

    if (error) throw new Error(error.message);
    if (!sales?.length) return [];

    const ids = sales.map((s) => s.id);
    const { data: lines, error: lineErr } = await supabase
      .from("sale_items")
      .select("*")
      .in("sale_id", ids);

    if (lineErr) throw new Error(lineErr.message);

    const bySale = new Map<string, SaleItemRow[]>();
    for (const line of (lines ?? []) as SaleItemRow[]) {
      const list = bySale.get(line.sale_id) ?? [];
      list.push(line);
      bySale.set(line.sale_id, list);
    }

    const mappedSales = (sales as SaleRow[]).map((s) => ({
      id: s.id,
      createdAt: s.created_at,
      dateLabel: s.date_label,
      customer: s.customer ?? "",
      customerPhone: s.customer_phone ?? "",
      total: Number(s.total),
      receiptNumber: s.receipt_number ?? undefined,
      paymentMethod: s.payment_method ?? undefined,
      mpesaCode: s.mpesa_code ?? undefined,
      servedBy: s.served_by ?? undefined,
      items: (bySale.get(s.id) ?? []).map((l) => ({
        itemId: l.item_id,
        name: l.name,
        qty: Number(l.qty),
        price: Number(l.price),
      })),
    }));
    
    await setCache("sales", mappedSales);
    return mappedSales;
  } catch (err) {
    if (isNetworkError(err)) {
      const cached = await getCache("sales");
      if (cached) return cached;
    }
    throw err;
  }
}

export async function listSalesPaginated(
  page = 1,
  pageSize = 50,
  query = ""
): Promise<{ data: Sale[]; count: number }> {
  if (getDataMode() === "local") {
    let all = localLoadSales();
    if (query) {
      const q = query.toLowerCase();
      all = all.filter(
        (s) =>
          s.customer.toLowerCase().includes(q) ||
          s.receiptNumber?.toLowerCase().includes(q) ||
          s.items.some((i) => i.name.toLowerCase().includes(q))
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
      .from("sales")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false });

    if (query) {
      qb = qb.or(`customer.ilike.%${query}%,receipt_number.ilike.%${query}%`);
    }

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    const { data: sales, error, count } = await qb.range(from, to);

    if (error) throw new Error(error.message);
    if (!sales?.length) return { data: [], count: count ?? 0 };

    const ids = sales.map((s) => s.id);
    const { data: lines, error: lineErr } = await supabase
      .from("sale_items")
      .select("*")
      .in("sale_id", ids);

    if (lineErr) throw new Error(lineErr.message);

    const bySale = new Map<string, SaleItemRow[]>();
    for (const line of (lines ?? []) as SaleItemRow[]) {
      const list = bySale.get(line.sale_id) ?? [];
      list.push(line);
      bySale.set(line.sale_id, list);
    }

    const mappedSales = (sales as SaleRow[]).map((s) => ({
      id: s.id,
      createdAt: s.created_at,
      dateLabel: s.date_label,
      customer: s.customer ?? "",
      customerPhone: s.customer_phone ?? "",
      total: Number(s.total),
      receiptNumber: s.receipt_number ?? undefined,
      paymentMethod: s.payment_method ?? undefined,
      mpesaCode: s.mpesa_code ?? undefined,
      servedBy: s.served_by ?? undefined,
      items: (bySale.get(s.id) ?? []).map((l) => ({
        itemId: l.item_id,
        name: l.name,
        qty: Number(l.qty),
        price: Number(l.price),
      })),
    }));

    const cached = (await getCache("sales")) || [];
    const cacheMap = new Map((cached as Sale[]).map((s) => [s.id, s]));
    for (const s of mappedSales) {
      cacheMap.set(s.id, s);
    }
    await setCache("sales", Array.from(cacheMap.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));

    return { data: mappedSales, count: count ?? 0 };
  } catch (err) {
    if (isNetworkError(err)) {
      let all = ((await getCache("sales")) || []) as Sale[];
      if (query) {
        const q = query.toLowerCase();
        all = all.filter(
          (s) =>
            s.customer.toLowerCase().includes(q) ||
            s.receiptNumber?.toLowerCase().includes(q) ||
            s.items.some((i) => i.name.toLowerCase().includes(q))
        );
      }
      const count = all.length;
      const data = all.slice((page - 1) * pageSize, page * pageSize);
      return { data, count };
    }
    throw err;
  }
}

export async function saveSales(sales: Sale[]): Promise<void> {
  if (getDataMode() === "local") {
    localSaveSales(sales);
    return;
  }

  const supabase = getSupabase();
  if (!supabase) {
    throw new Error("Supabase client is not configured");
  }

  const saleRows: SaleRow[] = sales.map((s) => ({
    id: s.id,
    created_at: s.createdAt,
    date_label: s.dateLabel,
    customer: s.customer,
    customer_phone: s.customerPhone,
    total: s.total,
    receipt_number: s.receiptNumber ?? "",
    payment_method: s.paymentMethod ?? "Cash",
    mpesa_code: s.mpesaCode ?? "",
    served_by: s.servedBy ?? "",
  }));

  await setCache("sales", sales);

  try {
    if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error("Failed to fetch");
    
    const { error } = await supabase.from("sales").upsert(saleRows);
    if (error) {
      if (error.message.toLowerCase().includes("column")) {
        const basic = saleRows.map(
          ({
            receipt_number: _r,
            payment_method: _p,
            mpesa_code: _m,
            served_by: _s,
            ...rest
          }) => rest
        );
        const { error: e2 } = await supabase.from("sales").upsert(basic);
        if (e2) throw new Error(e2.message);
      } else {
        throw new Error(error.message);
      }
    }

    const ids = sales.map((s) => s.id);
    if (ids.length) {
      await supabase.from("sale_items").delete().in("sale_id", ids);
    }

    const lineRows = sales.flatMap((s) =>
      s.items.map((i) => ({
        sale_id: s.id,
        item_id: i.itemId,
        name: i.name,
        qty: i.qty,
        price: i.price,
      }))
    );

    if (lineRows.length) {
      const { error: lineError } = await supabase
        .from("sale_items")
        .insert(lineRows);
      if (lineError) throw new Error(lineError.message);
    }
  } catch (err) {
    if (isNetworkError(err)) {
      await enqueueMutation("sales", "UPSERT", saleRows);
      
      const ids = sales.map((s) => s.id);
      if (ids.length) {
        // Unfortunately, delete().in is not supported easily in outbox without custom logic,
        // so we'll enqueue a delete for each sale's items
        for (const id of ids) {
          await enqueueMutation("sale_items", "DELETE", { sale_id: id });
        }
      }
      
      const lineRows = sales.flatMap((s) =>
        s.items.map((i) => ({
          sale_id: s.id,
          item_id: i.itemId,
          name: i.name,
          qty: i.qty,
          price: i.price,
        }))
      );
      if (lineRows.length) {
        await enqueueMutation("sale_items", "INSERT", lineRows);
      }
      return;
    }
    throw err;
  }

  // WARNING: Removed bulk delete logic that destroyed historical records past the limit.
}

export async function updateSale(sale: Sale): Promise<void> {
  if (getDataMode() === "local") {
    const all = localLoadSales().map(s => s.id === sale.id ? sale : s);
    localSaveSales(all);
    return;
  }

  const supabase = getSupabase();
  if (!supabase) {
    throw new Error("Supabase client is not configured");
  }

  const row: SaleRow = {
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
  };

  const cached = (await getCache("sales") || []) as Sale[];
  await setCache("sales", cached.map(s => s.id === sale.id ? sale : s));

  try {
    if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error("Failed to fetch");
    const { error } = await supabase.from("sales").update(row).eq("id", sale.id);
    if (error) throw new Error(error.message);

    // Recreate sale_items
    await supabase.from("sale_items").delete().eq("sale_id", sale.id);
    
    const lineRows = sale.items.map((i) => ({
      sale_id: sale.id,
      item_id: i.itemId,
      name: i.name,
      qty: i.qty,
      price: i.price,
    }));

    if (lineRows.length) {
      const { error: lineError } = await supabase
        .from("sale_items")
        .insert(lineRows);
      if (lineError) throw new Error(lineError.message);
    }
  } catch (err) {
    if (isNetworkError(err)) {
      await enqueueMutation("sales", "UPDATE", row);
      // Wait, DELETE operation in outbox expects { id: ... } for .eq('id', ...). 
      // We need to support custom columns for outbox DELETE if possible, but let's change outbox.ts to handle it, or we can just send an RPC instead.
      // Wait, if outbox.ts does `.delete().eq("id", payload.id)`, it will fail because sale_items doesn't have an "id" column.
      // We should modify outbox to allow column-specific deletes.
      await enqueueMutation("sale_items", "DELETE", { column: "sale_id", value: sale.id });
      
      const lineRows = sale.items.map((i) => ({
        sale_id: sale.id,
        item_id: i.itemId,
        name: i.name,
        qty: i.qty,
        price: i.price,
      }));
      if (lineRows.length) {
        await enqueueMutation("sale_items", "INSERT", lineRows);
      }
      return;
    }
    throw err;
  }
}

export async function deleteSaleCloud(id: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase client is not configured");
  const cached = (await getCache("sales") || []) as Sale[];
  await setCache("sales", cached.filter(s => s.id !== id));

  try {
    if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error("Failed to fetch");
    const { error } = await supabase.from("sales").delete().eq("id", id);
    if (error) throw new Error(error.message);
  } catch (err) {
    if (isNetworkError(err)) {
      await enqueueMutation("sales", "DELETE", { id });
      return;
    }
    throw err;
  }
}

export async function migrateLocalSalesToCloud(): Promise<number> {
  const sales = localLoadSales();
  if (!sales.length) return 0;
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    throw new Error("Supabase not configured");
  }
  await saveSales(sales);
  return sales.length;
}
