"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";

const PUBLIC_PATHS = ["/login", "/order"];

/** When cloud mode is on, force staff login for admin routes. Public: /login, /order */
export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const { configured, loading, session, likelySignedOut, authWarning } =
    useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));
  const isLogin = pathname.startsWith("/login");
  // Public farmer form must never wait on staff auth (critical on slow mobile)
  const isPublicForm = isPublic && !isLogin;

  // Wait only when restoring an existing session; not when clearly signed out
  const blocking =
    configured && loading && !likelySignedOut && !session && !isPublicForm;

  useEffect(() => {
    if (!configured) return;
    if (blocking) return;
    if (!session && !isPublic) {
      router.replace(`/login?next=${encodeURIComponent(pathname || "/")}`);
    }
    // Only bounce signed-in staff off the login page (not public order form)
    if (session && isLogin) {
      router.replace("/");
    }
  }, [
    configured,
    blocking,
    session,
    isPublic,
    isLogin,
    pathname,
    router,
  ]);

  if (!configured) return <>{children}</>;

  // Farmer order form: render immediately — no "Connecting to cloud" gate
  if (isPublicForm) return <>{children}</>;

  // Login page: never block on Connecting… — form is usable immediately
  if (isLogin) return <>{children}</>;

  if (blocking) {
    return (
      <div className="min-h-[40vh] flex flex-col items-center justify-center gap-3 px-4 text-on-surface-variant">
        <span
          className="material-symbols-outlined text-3xl text-primary animate-pulse"
          aria-hidden
        >
          cloud_sync
        </span>
        <p className="text-center text-sm">Restoring your session…</p>
        <p className="text-center text-xs max-w-sm opacity-80">
          Usually under 4 seconds. If this hangs, open login and sign in again.
        </p>
        <a
          href={`/login?next=${encodeURIComponent(pathname || "/")}`}
          className="text-sm text-primary font-medium mt-2 underline"
        >
          Go to login
        </a>
      </div>
    );
  }

  if (!session && !isPublic) {
    return (
      <div className="min-h-[40vh] flex flex-col items-center justify-center gap-2 text-on-surface-variant text-sm px-4 text-center">
        <p>Redirecting to staff login…</p>
        {authWarning ? (
          <p className="text-xs text-secondary max-w-md">{authWarning}</p>
        ) : null}
        <a
          href={`/login?next=${encodeURIComponent(pathname || "/")}`}
          className="text-primary font-medium underline mt-1"
        >
          Open login
        </a>
      </div>
    );
  }

  return <>{children}</>;
}
