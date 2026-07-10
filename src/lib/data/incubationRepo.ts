import {
  type IncubationBatch,
  loadBatches as localLoadBatches,
  saveBatches as localSaveBatches,
} from "@/lib/incubation";
import { getSupabase } from "@/lib/supabase/client";
import { getDataMode } from "./mode";

type BatchRow = {
  id: string;
  name: string;
  egg_count: number;
  start_date: string;
  incubation_days: number;
  status: IncubationBatch["status"];
  notes: string;
  candling_notes: string;
  removed_eggs: number;
  hatched_count: number | null;
  hatched_at: string | null;
  created_at: string;
};

function rowToBatch(row: BatchRow): IncubationBatch {
  return {
    id: row.id,
    name: row.name,
    eggCount: Number(row.egg_count),
    startDate: row.start_date,
    incubationDays: Number(row.incubation_days),
    status: row.status,
    notes: row.notes ?? "",
    candlingNotes: row.candling_notes ?? "",
    removedEggs: Number(row.removed_eggs ?? 0),
    hatchedCount: row.hatched_count == null ? null : Number(row.hatched_count),
    hatchedAt: row.hatched_at,
    createdAt: row.created_at,
  };
}

function batchToRow(b: IncubationBatch): BatchRow {
  return {
    id: b.id,
    name: b.name,
    egg_count: b.eggCount,
    start_date: b.startDate,
    incubation_days: b.incubationDays,
    status: b.status,
    notes: b.notes,
    candling_notes: b.candlingNotes,
    removed_eggs: b.removedEggs,
    hatched_count: b.hatchedCount,
    hatched_at: b.hatchedAt,
    created_at: b.createdAt,
  };
}

export async function listBatches(): Promise<IncubationBatch[]> {
  if (getDataMode() === "local") return localLoadBatches();

  const supabase = getSupabase();
  if (!supabase) return localLoadBatches();

  const { data, error } = await supabase
    .from("incubation_batches")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data as BatchRow[]).map(rowToBatch);
}

export async function saveBatches(batches: IncubationBatch[]): Promise<void> {
  if (getDataMode() === "local") {
    localSaveBatches(batches);
    return;
  }

  const supabase = getSupabase();
  if (!supabase) {
    localSaveBatches(batches);
    return;
  }

  const rows = batches.map(batchToRow);
  const { error } = await supabase.from("incubation_batches").upsert(rows);
  if (error) throw new Error(error.message);

  const ids = batches.map((b) => b.id);
  const { data: existing } = await supabase
    .from("incubation_batches")
    .select("id");
  const toDelete = (existing ?? [])
    .map((r) => r.id as string)
    .filter((id) => !ids.includes(id));
  if (toDelete.length) {
    await supabase.from("incubation_batches").delete().in("id", toDelete);
  }
}

export async function migrateLocalBatchesToCloud(): Promise<number> {
  const batches = localLoadBatches();
  if (!batches.length) return 0;
  await saveBatches(batches);
  return batches.length;
}
