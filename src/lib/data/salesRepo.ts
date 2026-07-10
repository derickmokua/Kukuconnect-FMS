import {
  type Sale,
  loadSales as localLoadSales,
  saveSales as localSaveSales,
} from "@/lib/sales";
import { getSupabase } from "@/lib/supabase/client";
import { getDataMode } from "./mode";

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
  if (!supabase) return localLoadSales();

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

  return (sales as SaleRow[]).map((s) => ({
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
}

export async function saveSales(sales: Sale[]): Promise<void> {
  if (getDataMode() === "local") {
    localSaveSales(sales);
    return;
  }

  const supabase = getSupabase();
  if (!supabase) {
    localSaveSales(sales);
    return;
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

  const { error } = await supabase.from("sales").upsert(saleRows);
  if (error) {
    // Fallback if receipt columns not migrated yet
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

  const { data: existing } = await supabase.from("sales").select("id");
  const toDelete = (existing ?? [])
    .map((r) => r.id as string)
    .filter((id) => !ids.includes(id));
  if (toDelete.length) {
    await supabase.from("sales").delete().in("id", toDelete);
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
