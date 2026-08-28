import { openDB, DBSchema, IDBPDatabase } from "idb";

export interface OutboxItem {
  id?: number;
  table: string; // The supabase table name or rpc name
  operation: "INSERT" | "UPDATE" | "DELETE" | "UPSERT" | "RPC";
  payload: any;
  createdAt: string;
}

export interface FarmDB extends DBSchema {
  cache: {
    key: string;
    value: any;
  };
  outbox: {
    key: number;
    value: OutboxItem;
    indexes: { "by-created": string };
  };
}

let dbPromise: Promise<IDBPDatabase<FarmDB>> | null = null;

/** Ensure IDB is only initialized on the client side */
export function getDb(): Promise<IDBPDatabase<FarmDB>> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("IndexedDB is only available in the browser"));
  }
  if (!dbPromise) {
    dbPromise = openDB<FarmDB>("farm-management", 1, {
      upgrade(db) {
        db.createObjectStore("cache");
        const outboxStore = db.createObjectStore("outbox", {
          keyPath: "id",
          autoIncrement: true,
        });
        outboxStore.createIndex("by-created", "createdAt");
      },
    });
  }
  return dbPromise;
}

/** Helper to cache list data for offline reading */
export async function setCache(key: string, data: any) {
  try {
    const db = await getDb();
    await db.put("cache", data, key);
  } catch (err) {
    // Ignore in SSR
  }
}

/** Helper to get cached data for offline reading */
export async function getCache(key: string): Promise<any | null> {
  try {
    const db = await getDb();
    return await db.get("cache", key);
  } catch (err) {
    return null; // Fallback to null in SSR
  }
}
