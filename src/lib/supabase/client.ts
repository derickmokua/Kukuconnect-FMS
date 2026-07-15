import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseEnv, isSupabaseConfigured } from "./config";

let browserClient: SupabaseClient | null = null;

/** Browser Supabase client (singleton). Null when env not configured. */
export function getSupabase(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  if (browserClient) return browserClient;

  const { url, anonKey } = getSupabaseEnv();
  browserClient = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      // localStorage is fine on modern mobile browsers; storage errors are
      // handled inside @supabase/gotrue-js. Keep flow simple for password login.
      flowType: "pkce",
      storage:
        typeof window !== "undefined" ? window.localStorage : undefined,
    },
  });
  return browserClient;
}
