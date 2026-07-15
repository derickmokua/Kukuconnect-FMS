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
  if (!supabase) return normalizeLots(loadLotsLocal());
  try {
    const { data, error } = await supabase
      .from("brooder_lots")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      if (isMissingTableError(error.message)) {
        console.warn(
          "[brooder] brooder_lots missing — run supabase/brooder.sql. Using local data."
        );
      }
      return normalizeLots(loadLotsLocal());
    }
    if (!data) return normalizeLots(loadLotsLocal());
    return normalizeLots(data.map(rowToLot));
  } catch {
    return normalizeLots(loadLotsLocal());
  }
}

export async function saveLots(lots: BrooderLot[]): Promise<void> {
  const normalized = normalizeLots(lots);
  saveLotsLocal(normalized);
  if (getDataMode() !== "cloud") return;
  const supabase = getSupabase();
  if (!supabase) return;
  try {
    const rows = normalized.map(lotToRow);
    const { error } = await supabase.from("brooder_lots").upsert(rows);
    if (error && isMissingTableError(error.message)) {
      console.warn(
        "[brooder] Cannot sync lots — run supabase/brooder.sql in Supabase SQL Editor."
      );
    }
  } catch {
    /* optional cloud */
  }
}

export async function listMortality(): Promise<MortalityEvent[]> {
  if (getDataMode() === "local") return loadMortalityLocal();
  const supabase = getSupabase();
  if (!supabase) return loadMortalityLocal();
  try {
    const { data, error } = await supabase
      .from("mortality_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error || !data) return loadMortalityLocal();
    return data.map(rowToMort);
  } catch {
    return loadMortalityLocal();
  }
}

export async function saveMortality(events: MortalityEvent[]): Promise<void> {
  saveMortalityLocal(events);
  if (getDataMode() !== "cloud") return;
  const supabase = getSupabase();
  if (!supabase) return;
  try {
    await supabase.from("mortality_events").upsert(events.map(mortToRow));
  } catch {
    /* optional */
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
