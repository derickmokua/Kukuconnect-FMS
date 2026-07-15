"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { getDataMode } from "@/lib/data/mode";
import { MAIN_NAV, isNavActive, pageTitle } from "@/lib/nav";
import Logo from "./Logo";
import Breadcrumbs from "./Breadcrumbs";
import FarmAssistant from "./FarmAssistant";

const BARE_PATHS = ["/login", "/order"];

const MOBILE_TABS = [
  { href: "/", label: "Home", icon: "home" },
  { href: "/orders", label: "Orders", icon: "shopping_bag" },
  { href: "/sales", label: "Sales", icon: "payments" },
  { href: "/inventory", label: "Stock", icon: "inventory_2" },
  { href: "/settings", label: "More", icon: "menu" },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const bare = BARE_PATHS.some((p) => pathname.startsWith(p));
  const [mobileOpen, setMobileOpen] = useState(false);
  const { configured, user, signOut } = useAuth();
  const mode = getDataMode();
  const isHome = pathname === "/";
  const title = pageTitle(pathname);

  // Public farmer form: no FMS chrome (logo, "Farm Management System", staff links)
  if (pathname.startsWith("/order")) {
    return (
      <div className="min-h-screen bg-[linear-gradient(180deg,#faf8f7_0%,#f3f3f3_100%)] flex flex-col">
        <main className="flex-1 p-4 sm:p-8 max-w-xl w-full mx-auto">
          {children}
        </main>
        <footer className="px-4 py-4 text-center text-xs text-on-surface-variant">
          Questions? WhatsApp{" "}
          <a
            href="https://wa.me/254716883375"
            className="text-primary font-medium hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            0716 883 375
          </a>
        </footer>
      </div>
    );
  }

  // Staff login only — keep product branding for internal users
  if (bare) {
    return (
      <div className="min-h-screen bg-[linear-gradient(180deg,#faf8f7_0%,#f3f3f3_100%)] flex flex-col">
        <header className="sticky top-0 z-40 min-h-24 flex items-center justify-between px-4 sm:px-10 py-2 shrink-0 border-b border-outline-variant/60 bg-white/80 backdrop-blur-md">
          <Link href="/" className="flex items-center gap-4 min-w-0">
            <Logo size={88} priority />
            <div className="min-w-0">
              <p className="text-primary font-bold text-xl leading-tight tracking-tight">
                KukuConnect
              </p>
              <p className="text-xs sm:text-sm text-on-surface-variant font-medium leading-snug">
                Farm Management System
              </p>
            </div>
          </Link>
          <div className="flex items-center gap-3 shrink-0">
            <Link
              href="/"
              className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              <span className="material-symbols-outlined text-base">home</span>
              Dashboard
            </Link>
          </div>
        </header>
        <main className="flex-1 p-4 sm:p-10">{children}</main>
      </div>
    );
  }

  const brandBlock = (
    <Link
      href="/"
      onClick={() => setMobileOpen(false)}
      className="flex items-center gap-3 mb-2 px-1 rounded-xl hover:bg-white/60 transition-colors group"
      title="Go to dashboard"
    >
      <Logo size={88} priority />
      <div className="min-w-0">
        <h1 className="text-lg font-bold text-primary leading-tight tracking-tight group-hover:underline underline-offset-2">
          KukuConnect
        </h1>
        <p className="text-[11px] sm:text-xs text-on-surface-variant font-medium leading-snug mt-0.5">
          Farm Management System
        </p>
        <p className="text-[10px] text-primary/80 font-medium mt-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <span className="material-symbols-outlined text-[12px]">home</span>
          Main page
        </p>
      </div>
    </Link>
  );

  const navLinks = (
    <>
      <div className="px-5 pt-6 pb-4 flex flex-col gap-2 flex-1 min-h-0">
        {brandBlock}
        <p className="px-2 text-[10px] font-label-caps text-on-surface-variant/70 mb-1">
          Menu
        </p>
        <nav className="flex flex-col gap-0.5 overflow-y-auto" aria-label="Main">
          {MAIN_NAV.map((item) => {
            const active = isNavActive(pathname, item);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={`mx-1 px-3 py-2.5 flex items-center gap-3 transition-all font-medium text-sm rounded-xl border-l-[3px] ${
                  active
                    ? "bg-primary text-white border-primary shadow-sm shadow-primary/20"
                    : "border-transparent text-on-surface-variant hover:text-on-surface hover:bg-white/70"
                }`}
              >
                <span
                  className={`material-symbols-outlined text-[22px] ${
                    active ? "fill" : ""
                  }`}
                >
                  {item.icon}
                </span>
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="px-5 py-4 border-t border-outline-variant/60 space-y-1">
        <Link
          href="/"
          onClick={() => setMobileOpen(false)}
          className={`mx-1 px-3 py-2.5 flex items-center gap-3 rounded-xl text-sm font-medium transition-all ${
            isHome
              ? "bg-primary-fixed text-primary"
              : "text-primary hover:bg-primary-fixed/60"
          }`}
        >
          <span className="material-symbols-outlined text-[22px]">home</span>
          Back to dashboard
        </Link>
        <Link
          href="/order"
          target="_blank"
          className="mx-1 px-3 py-2.5 flex items-center gap-3 text-on-surface-variant hover:text-on-surface hover:bg-white/70 rounded-xl text-sm font-medium transition-all"
        >
          <span className="material-symbols-outlined text-[22px]">public</span>
          Farmer form
        </Link>
        {configured && (
          <button
            type="button"
            onClick={() => signOut()}
            className="w-full mx-0 px-3 py-2.5 flex items-center gap-3 text-on-surface-variant hover:text-on-surface hover:bg-white/70 rounded-xl text-sm font-medium transition-all text-left"
          >
            <span className="material-symbols-outlined text-[22px]">logout</span>
            Logout
          </button>
        )}
        <p className="px-3 pt-2 text-[11px] text-on-surface-variant/70 truncate">
          {mode === "cloud" ? "Cloud" : "Local"}
          {user?.email ? ` · ${user.email}` : ""}
        </p>
      </div>
    </>
  );

  return (
    <div className="min-h-screen md:h-screen md:overflow-hidden flex bg-[linear-gradient(180deg,#faf8f7_0%,#f0eeed_100%)]">
      <aside className="hidden md:flex flex-col h-screen w-64 bg-surface-container/90 border-r border-outline-variant/60 z-50 shrink-0 backdrop-blur-sm">
        {navLinks}
      </aside>

      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-[60]">
          <button
            type="button"
            className="absolute inset-0 bg-black/25 backdrop-blur-[2px]"
            aria-label="Close menu"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute left-0 top-0 bottom-0 w-72 bg-surface-container shadow-2xl flex flex-col">
            {navLinks}
          </aside>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0 md:h-screen md:overflow-hidden">
        <header className="sticky top-0 z-40 h-14 md:h-16 flex justify-between items-center px-3 md:px-8 shrink-0 border-b border-outline-variant/50 bg-white/80 backdrop-blur-md">
          <div className="flex items-center gap-1 sm:gap-2 min-w-0 flex-1">
            <button
              type="button"
              className="md:hidden w-10 h-10 flex items-center justify-center rounded-full hover:bg-surface-variant text-primary shrink-0"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
            >
              <span className="material-symbols-outlined">menu</span>
            </button>

            {/* Always-visible home control */}
            <Link
              href="/"
              className={`w-10 h-10 flex items-center justify-center rounded-full shrink-0 transition-colors ${
                isHome
                  ? "bg-primary-fixed text-primary"
                  : "hover:bg-primary-fixed/70 text-primary"
              }`}
              title="Dashboard (main page)"
              aria-label="Go to dashboard"
            >
              <span
                className={`material-symbols-outlined text-[22px] ${
                  isHome ? "fill" : ""
                }`}
              >
                home
              </span>
            </Link>

            <div className="min-w-0 pl-1">
              <p className="text-[10px] font-label-caps text-on-surface-variant leading-none mb-0.5 hidden sm:block">
                {isHome ? "Main page" : "You are here"}
              </p>
              <h2 className="text-base md:text-lg font-semibold text-on-surface truncate tracking-tight leading-tight">
                {title}
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
            {!isHome && (
              <Link
                href="/"
                className="hidden md:inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium text-primary hover:bg-primary-fixed/60 transition-colors"
              >
                <span className="material-symbols-outlined text-base">
                  arrow_back
                </span>
                Dashboard
              </Link>
            )}
            <Link
              href="/orders"
              className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-surface-variant text-on-surface-variant"
              title="Orders"
            >
              <span className="material-symbols-outlined">notifications</span>
            </Link>
            <Link
              href="/settings"
              className="hidden sm:flex w-10 h-10 items-center justify-center rounded-full hover:bg-surface-variant text-on-surface-variant"
              title="Settings"
            >
              <span className="material-symbols-outlined">settings</span>
            </Link>
            <div
              className="w-8 h-8 rounded-full border border-primary/30 bg-primary-fixed flex items-center justify-center text-primary text-xs font-bold ml-1"
              title={user?.email ?? "Staff"}
            >
              {(user?.email?.[0] || "K").toUpperCase()}
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 md:p-8 pb-24 md:pb-8">
          <div className="max-w-6xl mx-auto">
            <Breadcrumbs />
            {children}
          </div>
        </main>

        {/* Staff AI: alerts + suggestions (hidden on public /order and /login) */}
        <FarmAssistant />

        {/* Mobile bottom tabs — Home is primary way back on phone */}
        <nav
          className="md:hidden fixed bottom-0 inset-x-0 z-50 border-t border-outline-variant/60 bg-white/95 backdrop-blur-md safe-bottom shadow-[0_-4px_20px_rgba(0,0,0,0.04)]"
          aria-label="Primary"
        >
          <div className="flex items-stretch justify-around px-1 pt-1 pb-2">
            {MOBILE_TABS.map((tab) => {
              const isActive =
                tab.href === "/"
                  ? pathname === "/"
                  : tab.href === "/settings"
                    ? pathname.startsWith("/settings") ||
                      pathname.startsWith("/incubation") ||
                      pathname.startsWith("/expenses") ||
                      pathname.startsWith("/brooder")
                    : pathname.startsWith(tab.href);

              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={`flex flex-col items-center justify-center min-w-[3.5rem] min-h-[48px] py-1.5 px-2 rounded-xl transition-colors ${
                    isActive
                      ? "text-primary bg-primary-fixed/40"
                      : "text-on-surface-variant"
                  }`}
                >
                  <span
                    className={`material-symbols-outlined text-[24px] ${
                      isActive ? "fill" : ""
                    }`}
                  >
                    {tab.icon}
                  </span>
                  <span className="text-[10px] font-semibold mt-0.5">
                    {tab.label}
                  </span>
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}
