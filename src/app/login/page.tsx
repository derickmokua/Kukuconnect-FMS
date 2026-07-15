"use client";

import { FormEvent, Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { isSupabaseConfigured } from "@/lib/supabase/config";

function LoginForm() {
  const { signIn, authWarning } = useAuth();
  const router = useRouter();
  const search = useSearchParams();
  const next = search.get("next") || "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const result = await signIn(email.trim(), password);
    setLoading(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    router.replace(next);
  };

  if (!isSupabaseConfigured()) {
    return (
      <div className="max-w-md mx-auto mt-16 farm-card border border-outline-variant rounded-3xl p-8 text-center space-y-4">
        <h1 className="text-2xl font-bold text-on-surface">Cloud mode off</h1>
        <p className="text-on-surface-variant text-sm">
          Add <code className="text-secondary">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
          <code className="text-secondary">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to{" "}
          <code className="text-secondary">.env.local</code> / Vercel, run the SQL
          files, then redeploy.
        </p>
        <a
          href="/"
          className="inline-flex items-center gap-1 text-primary font-medium hover:underline text-sm"
        >
          <span className="material-symbols-outlined text-base">home</span>
          Back to dashboard
        </a>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto mt-12 farm-card border border-outline-variant rounded-3xl p-8 space-y-6">
      <div>
        <p className="text-xs uppercase tracking-widest text-tertiary-container/90 font-medium">
          KukuConnect Admin
        </p>
        <h1 className="text-3xl font-bold text-on-surface mt-2">Staff login</h1>
        <p className="text-on-surface-variant text-sm mt-2">
          Multi-device farm data · Kitui hatchery. Sign in on each phone or computer
          once — data then stays shared in the cloud.
        </p>
      </div>

      {authWarning && !error && (
        <p className="text-xs text-secondary bg-secondary/10 border border-secondary/20 rounded-xl px-3 py-2">
          {authWarning}
        </p>
      )}

      <form onSubmit={onSubmit} className="space-y-4">
        <label className="block space-y-1">
          <span className="text-sm text-on-surface-variant">Email</span>
          <input
            type="email"
            required
            autoComplete="email"
            className="kc-input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="kukuconnect@outlook.com"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm text-on-surface-variant">Password</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            className="kc-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        {error && (
          <p className="text-sm text-on-error-container bg-error-container border border-error/20 rounded-xl px-3 py-2">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full kc-btn-primary disabled:opacity-60 py-3 rounded-xl transition"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <div className="text-xs text-on-surface-variant space-y-2 border-t border-outline-variant/60 pt-4">
        <p className="font-medium text-on-surface">If login fails</p>
        <ol className="list-decimal pl-4 space-y-1">
          <li>
            Supabase → <strong>Authentication → Users</strong> → Add user (email +
            password).
          </li>
          <li>
            Tick <strong>Auto Confirm User</strong> (or confirm email on the user).
          </li>
          <li>
            Authentication → <strong>URL Configuration</strong>: Site URL{" "}
            <code className="text-secondary">https://app.kukuconnect.co.ke</code>
          </li>
          <li>
            After first login on a device that has old offline data:{" "}
            <strong>Settings</strong> → migrate local → cloud.
          </li>
        </ol>
        <p>
          Farmers use{" "}
          <a href="/order" className="text-primary underline">
            /order
          </a>{" "}
          — no staff login needed.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="text-center text-on-surface-variant mt-16">
          Loading login…
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
