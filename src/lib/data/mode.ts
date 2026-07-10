import { isSupabaseConfigured } from "@/lib/supabase/config";

export type DataMode = "cloud" | "local";

/** Prefer cloud when Supabase is configured; otherwise localStorage. */
export function getDataMode(): DataMode {
  return isSupabaseConfigured() ? "cloud" : "local";
}

export function dataModeLabel(mode: DataMode = getDataMode()): string {
  return mode === "cloud" ? "Cloud (multi-device)" : "Local (this browser only)";
}
