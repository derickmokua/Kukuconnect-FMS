"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";

const PUBLIC_PATHS = ["/login", "/order"];

/** When cloud mode is on, force staff login for admin routes. Public: /login, /order */
export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const { configured, loading, session } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));
  const isLogin = pathname.startsWith("/login");

  useEffect(() => {
    if (!configured || loading) return;
    if (!session && !isPublic) {
      router.replace(`/login?next=${encodeURIComponent(pathname || "/")}`);
    }
    // Only bounce signed-in staff off the login page (not public order form)
    if (session && isLogin) {
      router.replace("/");
    }
  }, [configured, loading, session, isPublic, isLogin, pathname, router]);

  if (!configured) return <>{children}</>;

  if (loading) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center text-on-surface-variant">
        Connecting to KukuConnect cloud…
      </div>
    );
  }

  if (!session && !isPublic) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center text-on-surface-variant">
        Redirecting to login…
      </div>
    );
  }

  return <>{children}</>;
}
