import { getDb, OutboxItem } from "./idbStore";
import { getSupabase } from "@/lib/supabase/client";

/** Check if an error represents an offline or network failure state */
export function isNetworkError(error: unknown): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  if (error instanceof Error) {
    return error.message.includes("Failed to fetch") || error.message.includes("NetworkError");
  }
  return false;
}

export async function enqueueMutation(
  table: string,
  operation: OutboxItem["operation"],
  payload: any
): Promise<void> {
  try {
    const db = await getDb();
    await db.add("outbox", {
      table,
      operation,
      payload,
      createdAt: new Date().toISOString(),
    });
    console.log(`[outbox] Enqueued offline ${operation} for ${table}`);
  } catch (err) {
    console.error("Failed to enqueue mutation", err);
  }
}

let isProcessing = false;

export async function processOutbox(): Promise<void> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  if (isProcessing) return;

  const supabase = getSupabase();
  if (!supabase) return;

  try {
    const db = await getDb();
    const tx = db.transaction("outbox", "readwrite");
    const store = tx.objectStore("outbox");
    
    // We open a cursor and process in order
    let cursor = await store.openCursor();
    
    if (cursor) {
      isProcessing = true;
      console.log("[outbox] Processing offline mutations...");
    }

    while (cursor) {
      const item = cursor.value;
      
      try {
        if (item.operation === "INSERT") {
          const { error } = await (supabase.from(item.table) as any).insert(item.payload);
          if (error) throw new Error(error.message);
        } else if (item.operation === "UPDATE") {
          const { error } = await (supabase.from(item.table) as any).update(item.payload).eq("id", item.payload.id);
          if (error) throw new Error(error.message);
        } else if (item.operation === "DELETE") {
          const col = item.payload.column || "id";
          const val = item.payload.value || item.payload.id;
          const { error } = await (supabase.from(item.table) as any).delete().eq(col, val);
          if (error) throw new Error(error.message);
        } else if (item.operation === "UPSERT") {
          const { error } = await (supabase.from(item.table) as any).upsert(item.payload);
          if (error) throw new Error(error.message);
        } else if (item.operation === "RPC") {
          const { error } = await supabase.rpc(item.table, item.payload);
          if (error) throw new Error(error.message);
        }
        
        // Success: remove from outbox
        await cursor.delete();
        console.log(`[outbox] Successfully synced ${item.operation} for ${item.table}`);
      } catch (err) {
        console.error(`[outbox] Failed to sync item ${item.id}`, err);
        // Break early on first failure to maintain strict ordering
        break; 
      }
      
      cursor = await cursor.continue();
    }
  } catch (err) {
    console.error("[outbox] Failed to process outbox", err);
  } finally {
    isProcessing = false;
  }
}
