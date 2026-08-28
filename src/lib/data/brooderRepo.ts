import {
  type BrooderLot,
  type MortalityEvent,
  loadLotsLocal,
  loadMortalityLocal,
  normalizeLot,
  normalizeLots,
  saveLotsLocal,
  saveMortalityLocal,
} from "@/lib/brooder";
import { getSupabase } from "@/lib/supabase/client";
import { getDataMode } from "./mode";
import { getCache, setCache } from "./idbStore";
import { enqueueMutation, isNetworkError } from "./outbox";

function isMissingTableError(message?: string): boolean {
  const m = (message || "").toLowerCase();
  return (
    m.includes("could not find the table") ||
    m.includes("pgrst205") ||
    m.includes("schema cache")
  );
}

/** Cloud tables optional — always works local; cloud if tables exist */
export async function listLots(): Promise<BrooderLot[]> {
  if (getDataMode() === "local") return normalizeLots(loadLotsLocal());
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase client is not configured");
  
  try {
    const { data, error } = await supabase
      .from("brooder_lots")
      .select("*")
      .order("created_at", { ascending: false });
      
    if (error) throw new Error(error.message);
    if (!data) return [];
    const lots = normalizeLots(data.map(rowToLot));
    await setCache("brooder_lots", lots);
    return lots;
  } catch (err) {
    if (isNetworkError(err)) {
      const cached = await getCache("brooder_lots");
      if (cached) return cached;
    }
    throw err;
  }
}

export async function saveLots(lots: BrooderLot[]): Promise<void> {
  const normalized = normalizeLots(lots);
  if (getDataMode() === "local") {
    saveLotsLocal(normalized);
    return;
  }
  
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase client is not configured");
  
  const { data: existing } = await supabase
    .from("brooder_lots")
    .select("id, quantity, total_mortality, total_sales, total_discounted");
    
  const existingMap = new Map((existing ?? []).map((e) => [e.id as string, e]));

  const rows = normalized.map((lot) => {
    const row = lotToRow(lot);
    const ex = existingMap.get(lot.id);
    if (ex) {
      row.quantity = Number(ex.quantity);
      row.total_mortality = Number(ex.total_mortality);
      row.total_sales = Number(ex.total_sales);
      row.total_discounted = Number(ex.total_discounted);
    }
    return row;
  });

  await setCache("brooder_lots", normalized);

  try {
    if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error("Failed to fetch");
    const { error } = await supabase.from("brooder_lots").upsert(rows);
    if (error) throw new Error(error.message);
  } catch (err) {
    if (isNetworkError(err)) {
      await enqueueMutation("brooder_lots", "UPSERT", rows);
      return;
    }
    throw err;
  }
}

export async function upsertLotCloud(lot: BrooderLot): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase client is not configured");
  const cached = (await getCache("brooder_lots") || []) as BrooderLot[];
  const existingIndex = cached.findIndex(l => l.id === lot.id);
  if (existingIndex >= 0) {
    cached[existingIndex] = lot;
  } else {
    cached.unshift(lot);
  }
  await setCache("brooder_lots", cached);

  try {
    if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error("Failed to fetch");
    const { error } = await supabase.from("brooder_lots").upsert(lotToRow(lot));
    if (error) throw new Error(error.message);
  } catch (err) {
    if (isNetworkError(err)) {
      await enqueueMutation("brooder_lots", "UPSERT", lotToRow(lot));
      return;
    }
    throw err;
  }
}

export async function deleteLotCloud(id: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase client is not configured");
  const cached = (await getCache("brooder_lots") || []) as BrooderLot[];
  await setCache("brooder_lots", cached.filter(l => l.id !== id));

  try {
    if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error("Failed to fetch");
    const { error } = await supabase.from("brooder_lots").delete().eq("id", id);
    if (error) throw new Error(error.message);
  } catch (err) {
    if (isNetworkError(err)) {
      await enqueueMutation("brooder_lots", "DELETE", { id });
      return;
    }
    throw err;
  }
}

export async function listMortality(): Promise<MortalityEvent[]> {
  if (getDataMode() === "local") return loadMortalityLocal();
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase client is not configured");
  
  try {
    const { data, error } = await supabase
      .from("mortality_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
      
    if (error) throw new Error(error.message);
    if (!data) return [];
    const events = data.map(rowToMort);
    await setCache("mortality_events", events);
    return events;
  } catch (err) {
    if (isNetworkError(err)) {
      const cached = await getCache("mortality_events");
      if (cached) return cached;
    }
    throw err;
  }
}

export async function saveMortality(events: MortalityEvent[]): Promise<void> {
  if (getDataMode() === "local") {
    saveMortalityLocal(events);
    return;
  }
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase client is not configured");
  
  await setCache("mortality_events", events);
  try {
    if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error("Failed to fetch");
    const { error } = await supabase.from("mortality_events").upsert(events.map(mortToRow));
    if (error) throw new Error(error.message);
  } catch (err) {
    if (isNetworkError(err)) {
      await enqueueMutation("mortality_events", "UPSERT", events.map(mortToRow));
      return;
    }
    throw err;
  }
}

function rowToLot(r: Record<string, unknown>): BrooderLot {
  const quantity = Number(r.quantity ?? 0);
  return normalizeLot({
    id: String(r.id),
    name: String(r.name ?? ""),
    hatchDate: String(r.hatch_date ?? r.hatchDate ?? ""),
    quantity,
    initialQuantity: Number(r.initial_quantity ?? r.initialQuantity ?? quantity),
    stageId: r.stage_id as BrooderLot["stageId"],
    breed: String(r.breed ?? ""),
    notes: String(r.notes ?? ""),
    status: (r.status as BrooderLot["status"]) ?? "active",
    lastAgedDate: String(r.last_aged_date ?? r.lastAgedDate ?? ""),
    totalMortality: Number(r.total_mortality ?? r.totalMortality ?? 0),
    totalSales: Number(r.total_sales ?? r.totalSales ?? 0),
    totalDiscounted: Number(r.total_discounted ?? r.totalDiscounted ?? 0),
    createdAt: String(r.created_at ?? r.createdAt ?? new Date().toISOString()),
    closedAt: (r.closed_at as string) ?? (r.closedAt as string) ?? null,
    brooder: String(r.brooder ?? "Unassigned"),
  });
}

function lotToRow(l: BrooderLot) {
  return {
    id: l.id,
    name: l.name,
    hatch_date: l.hatchDate,
    quantity: l.quantity,
    initial_quantity: l.initialQuantity,
    stage_id: l.stageId,
    breed: l.breed,
    notes: l.notes,
    status: l.status,
    last_aged_date: l.lastAgedDate,
    total_mortality: l.totalMortality,
    total_sales: l.totalSales,
    total_discounted: l.totalDiscounted,
    created_at: l.createdAt,
    closed_at: l.closedAt,
    brooder: l.brooder,
  };
}

function rowToMort(r: Record<string, unknown>): MortalityEvent {
  return {
    id: String(r.id),
    lotId: String(r.lot_id ?? r.lotId ?? ""),
    lotName: String(r.lot_name ?? r.lotName ?? ""),
    qty: Number(r.qty ?? 0),
    reason: String(r.reason ?? ""),
    date: String(r.date ?? ""),
    createdAt: String(r.created_at ?? r.createdAt ?? ""),
  };
}

function mortToRow(e: MortalityEvent) {
  return {
    id: e.id,
    lot_id: e.lotId,
    lot_name: e.lotName,
    qty: e.qty,
    reason: e.reason,
    date: e.date,
    created_at: e.createdAt,
  };
}
