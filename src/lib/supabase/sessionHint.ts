import { getSupabaseEnv } from "./config";

/**
 * Sync hint: does localStorage already hold a Supabase session?
 * Used to skip the long "Connecting…" gate when the user is clearly logged out.
 */
export function hasStoredSupabaseSession(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const { url } = getSupabaseEnv();
    const ref =
      url.match(/https?:\/\/([a-z0-9-]+)\.supabase\.co/i)?.[1] ?? "";
    const keys = [
      ref ? `sb-${ref}-auth-token` : "",
      "supabase.auth.token",
    ].filter(Boolean);

    for (const key of keys) {
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as {
          access_token?: string;
          currentSession?: { access_token?: string };
        };
        if (parsed?.access_token || parsed?.currentSession?.access_token) {
          return true;
        }
        // Newer storage shapes may be nested differently; non-empty object is enough
        if (typeof parsed === "object" && parsed !== null) return true;
      } catch {
        if (raw.length > 20) return true;
      }
    }

    // Fallback: any sb-*-auth-token key
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && /^sb-.*-auth-token$/i.test(k)) {
        const v = window.localStorage.getItem(k);
        if (v && v.length > 20) return true;
      }
    }
  } catch {
    /* private mode / blocked storage */
  }
  return false;
}
