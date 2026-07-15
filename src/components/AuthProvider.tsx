"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { mapAuthError } from "@/lib/supabase/mapAuthError";
import { hasStoredSupabaseSession } from "@/lib/supabase/sessionHint";

interface AuthContextValue {
  configured: boolean;
  loading: boolean;
  /** True when we already know there is no local session (skip Connecting gate). */
  likelySignedOut: boolean;
  session: Session | null;
  user: User | null;
  authWarning: string | null;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Keep short — staff should hit login quickly on slow mobile. */
const AUTH_TIMEOUT_MS = 4_000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const configured = isSupabaseConfigured();
  const [loading, setLoading] = useState(configured);
  const [session, setSession] = useState<Session | null>(null);
  const [likelySignedOut, setLikelySignedOut] = useState(false);
  const [authWarning, setAuthWarning] = useState<string | null>(null);

  useEffect(() => {
    if (!configured) {
      setLoading(false);
      setLikelySignedOut(false);
      return;
    }

    // Immediate UX: no stored session → treat as signed out (show login, not spinner)
    const hasHint = hasStoredSupabaseSession();
    if (!hasHint) {
      setLikelySignedOut(true);
      setLoading(false);
    }

    const supabase = getSupabase();
    if (!supabase) {
      setLoading(false);
      setLikelySignedOut(true);
      setAuthWarning(
        "Cloud env is set but the client failed to start. Redeploy with NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."
      );
      return;
    }

    let mounted = true;
    let settled = false;

    const finish = (next: Session | null, warning?: string | null) => {
      if (!mounted || settled) return;
      settled = true;
      setSession(next);
      setLikelySignedOut(!next);
      setLoading(false);
      if (warning !== undefined) setAuthWarning(warning);
    };

    const timeoutId = window.setTimeout(() => {
      if (!settled) {
        console.warn("[auth] getSession timed out — continuing without session");
        finish(
          null,
          "Cloud auth is slow or unreachable. You can still open login and try again."
        );
      }
    }, AUTH_TIMEOUT_MS);

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (error) {
          console.warn("[auth] getSession error:", error.message);
          finish(null, mapAuthError(error.message));
          return;
        }
        finish(data.session, null);
      })
      .catch((err) => {
        console.warn("[auth] getSession failed:", err);
        finish(
          null,
          mapAuthError(err instanceof Error ? err.message : "Auth check failed")
        );
      })
      .finally(() => {
        window.clearTimeout(timeoutId);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!mounted) return;
      setSession(next);
      setLikelySignedOut(!next);
      setLoading(false);
      settled = true;
      setAuthWarning(null);
      window.clearTimeout(timeoutId);
    });

    return () => {
      mounted = false;
      window.clearTimeout(timeoutId);
      subscription.unsubscribe();
    };
  }, [configured]);

  const signIn = useCallback(async (email: string, password: string) => {
    const supabase = getSupabase();
    if (!supabase) {
      return {
        error:
          "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY on Vercel, then redeploy.",
      };
    }
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) return { error: mapAuthError(error.message) };
      setAuthWarning(null);
      setLikelySignedOut(false);
      return {};
    } catch (err) {
      return {
        error: mapAuthError(
          err instanceof Error
            ? err.message
            : "Sign-in failed. Check network and try again."
        ),
      };
    }
  }, []);

  const signOut = useCallback(async () => {
    const supabase = getSupabase();
    if (!supabase) return;
    try {
      await supabase.auth.signOut();
      setLikelySignedOut(true);
    } catch (err) {
      console.warn("[auth] signOut failed:", err);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      configured,
      loading,
      likelySignedOut,
      session,
      user: session?.user ?? null,
      authWarning,
      signIn,
      signOut,
    }),
    [
      configured,
      loading,
      likelySignedOut,
      session,
      authWarning,
      signIn,
      signOut,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
