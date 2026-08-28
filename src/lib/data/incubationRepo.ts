import {
  type IncubationBatch,
  loadBatches as localLoadBatches,
  saveBatches as localSaveBatches,
} from "@/lib/incubation";
import { getSupabase } from "@/lib/supabase/client";
import { getDataMode } from "./mode";
import { getCache, setCache } from "./idbStore";
import { enqueueMutation, isNetworkError } from "./outbox";

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
  if (!supabase) throw new Error("Supabase client is not configured");

  try {
    const { data, error } = await supabase
      .from("incubation_batches")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);
    const batches = (data as BatchRow[]).map(rowToBatch);
    await setCache("incubation_batches", batches);
    return batches;
  } catch (err) {
    if (isNetworkError(err)) {
      const cached = await getCache("incubation_batches");
      if (cached) return cached;
    }
    throw err;
  }
}

export async function saveBatches(batches: IncubationBatch[]): Promise<void> {
  if (getDataMode() === "local") {
    localSaveBatches(batches);
    return;
  }

  const supabase = getSupabase();
  if (!supabase) {
    throw new Error("Supabase client is not configured");
  }

  await setCache("incubation_batches", batches);
  const rows = batches.map(batchToRow);

  try {
    if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error("Failed to fetch");
    const { error } = await supabase.from("incubation_batches").upsert(rows);
    if (error) throw new Error(error.message);
  } catch (err) {
    if (isNetworkError(err)) {
      await enqueueMutation("incubation_batches", "UPSERT", rows);
      return;
    }
    throw err;
  }

  // REMOVED: Bulk delete logic that destroyed cloud records missing from the local cache.
}

export async function insertBatch(batch: IncubationBatch): Promise<void> {
  if (getDataMode() === "local") {
    const all = localLoadBatches();
    localSaveBatches([batch, ...all]);
    return;
  }

  const supabase = getSupabase();
  if (!supabase) {
    throw new Error("Supabase client is not configured");
  }

  const row = batchToRow(batch);
  const cached = await getCache("incubation_batches") || [];
  await setCache("incubation_batches", [batch, ...cached]);

  try {
    if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error("Failed to fetch");
    const { error } = await supabase.from("incubation_batches").insert(row);
    if (error) throw new Error(error.message);
  } catch (err) {
    if (isNetworkError(err)) {
      await enqueueMutation("incubation_batches", "INSERT", row);
      return;
    }
    throw err;
  }
}

export async function updateBatch(batch: IncubationBatch): Promise<void> {
  if (getDataMode() === "local") {
    const all = localLoadBatches().map(b => b.id === batch.id ? batch : b);
    localSaveBatches(all);
    return;
  }

  const supabase = getSupabase();
  if (!supabase) {
    throw new Error("Supabase client is not configured");
  }

  const row = batchToRow(batch);
  const cached = (await getCache("incubation_batches") || []) as IncubationBatch[];
  await setCache("incubation_batches", cached.map(b => b.id === batch.id ? batch : b));

  try {
    if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error("Failed to fetch");
    const { error } = await supabase.from("incubation_batches").update(row).eq("id", batch.id);
    if (error) throw new Error(error.message);
  } catch (err) {
    if (isNetworkError(err)) {
      await enqueueMutation("incubation_batches", "UPDATE", row);
      return;
    }
    throw err;
  }
}

export async function deleteBatchCloud(id: string): Promise<void> {
  if (getDataMode() === "local") {
    const all = localLoadBatches().filter(b => b.id !== id);
    localSaveBatches(all);
    return;
  }
  
  const supabase = getSupabase();
  if (!supabase) {
    throw new Error("Supabase client is not configured");
  }
  
  const cached = (await getCache("incubation_batches") || []) as IncubationBatch[];
  await setCache("incubation_batches", cached.filter(b => b.id !== id));

  try {
    if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error("Failed to fetch");
    const { error } = await supabase.from("incubation_batches").delete().eq("id", id);
    if (error) throw new Error(error.message);
  } catch (err) {
    if (isNetworkError(err)) {
      await enqueueMutation("incubation_batches", "DELETE", { id });
      return;
    }
    throw err;
  }
}

export async function migrateLocalBatchesToCloud(): Promise<number> {
  const batches = localLoadBatches();
  if (!batches.length) return 0;
  await saveBatches(batches);
  return batches.length;
}
