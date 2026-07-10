"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { pageTitle } from "@/lib/nav";

/**
 * Persistent trail so staff always know where they are and can jump home.
 */
export default function Breadcrumbs() {
  const pathname = usePathname();
  const isHome = pathname === "/";
  const title = pageTitle(pathname);

  if (isHome) {
    return (
      <nav
        aria-label="Breadcrumb"
        className="flex items-center gap-2 text-sm text-on-surface-variant mb-4"
      >
        <span className="material-symbols-outlined text-base text-primary fill">
          home
        </span>
        <span className="font-medium text-on-surface">Dashboard</span>
        <span className="text-on-surface-variant/60">· Main page</span>
      </nav>
    );
  }

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex flex-wrap items-center gap-1.5 text-sm mb-4"
    >
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-primary font-medium hover:underline underline-offset-2 rounded-lg px-1.5 py-1 -ml-1.5 hover:bg-primary-fixed/50 transition-colors"
      >
        <span className="material-symbols-outlined text-base">home</span>
        Dashboard
      </Link>
      <span className="material-symbols-outlined text-outline text-sm">
        chevron_right
      </span>
      <span className="text-on-surface font-semibold truncate">{title}</span>
    </nav>
  );
}
