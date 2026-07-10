"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  showBackHome = true,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  /** Show “Back to dashboard” on non-home pages (default true) */
  showBackHome?: boolean;
}) {
  const pathname = usePathname();
  const isHome = pathname === "/";

  return (
    <div className="space-y-3 pb-6 border-b border-outline-variant/60">
      {showBackHome && !isHome && (
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary/80 transition-colors group"
        >
          <span className="material-symbols-outlined text-[18px] group-hover:-translate-x-0.5 transition-transform">
            arrow_back
          </span>
          Back to dashboard
        </Link>
      )}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div className="min-w-0">
          {eyebrow && (
            <p className="font-label-caps text-on-surface-variant mb-1.5">
              {eyebrow}
            </p>
          )}
          <h2 className="text-2xl md:text-[1.75rem] font-semibold text-on-surface tracking-tight">
            {title}
          </h2>
          {description && (
            <p className="text-sm text-on-surface-variant mt-1.5 max-w-xl">
              {description}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
