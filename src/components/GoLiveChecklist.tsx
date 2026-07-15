"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "./AuthProvider";
import { getDataMode } from "@/lib/data/mode";
import { listItems } from "@/lib/data/inventoryRepo";
import { listOrders } from "@/lib/data/ordersRepo";
import { ITEM_IDS } from "@/lib/inventory";
import { mpesaTillHint } from "@/lib/orders";

type Health = {
  cloud?: { ready?: boolean };
  schema?: {
    reachable?: boolean;
    coreOk?: boolean;
    missingCore?: string[];
    missingOptional?: string[];
    message?: string;
  };
  payments?: { tillConfigured?: boolean };
  notifications?: {
    staffPhoneConfigured?: boolean;
    africastalking?: boolean;
  };
  v1?: { ready?: boolean; message?: string };
};

type Check = {
  id: string;
  label: string;
  ok: boolean | null;
  detail: string;
  href?: string;
};

export default function GoLiveChecklist() {
  const { configured, user } = useAuth();
  const mode = getDataMode();
  const [checks, setChecks] = useState<Check[]>([]);
  const [loading, setLoading] = useState(true);
  const [origin, setOrigin] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    let health: Health = {};
    try {
      health = await fetch("/api/health").then((r) => r.json());
    } catch {
      health = {};
    }

    let dayOld = 0;
    let week3 = 0;
    let parent = 0;
    let pendingOrders = 0;
    try {
      const items = await listItems();
      dayOld = items.find((i) => i.id === ITEM_IDS.dayOld)?.quantity ?? 0;
      week3 = items.find((i) => i.id === ITEM_IDS.week3)?.quantity ?? 0;
      parent = items.find((i) => i.id === ITEM_IDS.parentStock)?.quantity ?? 0;
    } catch {
      /* cloud may require login */
    }
    try {
      const orders = await listOrders();
      pendingOrders = orders.filter((o) => o.status === "pending").length;
    } catch {
      /* ignore */
    }

    const till = mpesaTillHint();
    const tillOk = Boolean(health.payments?.tillConfigured);
    const stockOk = dayOld > 0 || week3 > 0;
    const cloudOk = mode === "cloud" && Boolean(health.cloud?.ready);
    const loggedIn = !configured || Boolean(user);
    const schema = health.schema;
    const sqlOk =
      !cloudOk
        ? false
        : schema?.coreOk === true
          ? schema.missingOptional?.length
            ? null
            : true
          : schema?.reachable === false
            ? false
            : false;
    const sqlDetail = !cloudOk
      ? "Run after creating the Supabase project"
      : schema?.message ||
        "Confirm you ran schema.sql + orders.sql (+ brooder.sql)";

    const next: Check[] = [
      {
        id: "cloud",
        label: "Supabase cloud configured",
        ok: cloudOk,
        detail: cloudOk
          ? "Multi-device mode on"
          : mode === "local"
            ? "Still local-only — add NEXT_PUBLIC_SUPABASE_* and restart"
            : "Env missing URL or anon key",
        href: "/settings",
      },
      {
        id: "sql",
        label: "Database tables (you run SQL once)",
        ok: sqlOk,
        detail: sqlDetail,
      },
      {
        id: "auth",
        label: "Staff can sign in",
        ok: loggedIn && (mode === "local" || Boolean(user)),
        detail:
          mode === "local"
            ? "Local mode — no login required"
            : user
              ? `Signed in as ${user.email}`
              : "Create user in Supabase Auth (Auto Confirm), then /login on each device",
        href: "/login",
      },
      {
        id: "till",
        label: "M-Pesa till / paybill on order form",
        ok: tillOk,
        detail: tillOk ? `Showing: ${till}` : `Placeholder till: ${till}`,
      },
      {
        id: "stock",
        label: "Sellable stock entered",
        ok: stockOk,
        detail: stockOk
          ? `Day-old ${dayOld} · 3-week ${week3} · Parent ${parent}`
          : "Set day-old and/or 3-week qty in Inventory (or Quick start below)",
        href: "/inventory",
      },
      {
        id: "order-link",
        label: "Public order link ready",
        ok: true,
        detail: origin
          ? `${origin}/order`
          : "Share /order after deploy",
        href: "/order",
      },
      {
        id: "notify",
        label: "Notifications (optional for v1)",
        ok: true,
        detail: health.notifications?.africastalking
          ? "WhatsApp + Africa's Talking SMS"
          : health.notifications?.staffPhoneConfigured
            ? "WhatsApp OK · staff phone set · SMS optional"
            : "WhatsApp templates work without SMS keys",
      },
      {
        id: "smoke",
        label: "Smoke test: place + confirm an order",
        ok: null,
        detail:
          pendingOrders > 0
            ? `${pendingOrders} pending — confirm one with real till test if possible`
            : "Place test order on /order, then Confirm paid on /orders",
        href: "/orders",
      },
    ];

    setChecks(next);
    setLoading(false);
  }, [configured, user, mode]);

  useEffect(() => {
    setOrigin(typeof window !== "undefined" ? window.location.origin : "");
    refresh();
  }, [refresh]);

  const copyOrderLink = async () => {
    const url = `${origin || ""}/order`;
    try {
      await navigator.clipboard.writeText(url);
      alert(`Copied: ${url}`);
    } catch {
      prompt("Copy this link:", url);
    }
  };

  const requiredReady = checks
    .filter((c) => ["cloud", "till", "stock", "auth"].includes(c.id))
    .every((c) => c.ok === true || c.ok === null);

  return (
    <section className="farm-card rounded-3xl border border-emerald-900/40 p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-widest text-tertiary-container font-medium">
            V1 Live
          </p>
          <h3 className="text-lg font-semibold text-on-surface mt-1">
            Go-live checklist
          </h3>
          <p className="text-sm text-on-surface-variant mt-1">
            Finish these, then deploy to kukuconnect.co.ke
          </p>
        </div>
        <button
          type="button"
          onClick={() => refresh()}
          className="bg-surface-container-highest hover:bg-surface-container-high px-4 py-2 rounded-xl text-sm shrink-0"
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <p className="text-on-surface-variant text-sm">Checking…</p>
      ) : (
        <ul className="space-y-3">
          {checks.map((c) => (
            <li
              key={c.id}
              className="flex gap-3 items-start border-b border-outline-variant/80 pb-3 last:border-0 last:pb-0"
            >
              <StatusIcon ok={c.ok} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-on-surface">{c.label}</p>
                <p className="text-xs text-on-surface-variant mt-0.5 break-all">
                  {c.detail}
                </p>
                {c.href && (
                  <Link
                    href={c.href}
                    className="text-xs text-secondary hover:underline mt-1 inline-block"
                  >
                    Open →
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          onClick={copyOrderLink}
          className="bg-tertiary-container text-on-primary hover:opacity-90 px-4 py-2.5 rounded-xl text-sm font-medium"
        >
          Copy /order link
        </button>
        <Link
          href="/order"
          target="_blank"
          className="bg-surface-container-highest hover:bg-surface-container-high px-4 py-2.5 rounded-xl text-sm"
        >
          Open farmer form
        </Link>
      </div>

      <p
        className={`text-sm rounded-xl px-3 py-2 border ${
          requiredReady
            ? "border-emerald-900/50 bg-emerald-950/30 text-emerald-300"
            : "border-amber-900/40 bg-amber-950/20 text-on-secondary-container"
        }`}
      >
        {requiredReady
          ? "Core checklist looks good — deploy, set DNS, run one paid smoke test, then share /order."
          : "Fix red items above before calling v1 live."}
      </p>
    </section>
  );
}

function StatusIcon({ ok }: { ok: boolean | null }) {
  if (ok === true) {
    return (
      <span className="mt-0.5 w-6 h-6 rounded-full bg-emerald-900/60 text-tertiary-container flex items-center justify-center text-xs shrink-0">
        ✓
      </span>
    );
  }
  if (ok === false) {
    return (
      <span className="mt-0.5 w-6 h-6 rounded-full bg-red-900/50 text-error flex items-center justify-center text-xs shrink-0">
        !
      </span>
    );
  }
  return (
    <span className="mt-0.5 w-6 h-6 rounded-full bg-surface-container-highest text-on-surface-variant flex items-center justify-center text-xs shrink-0">
      ?
    </span>
  );
}
