"use client";

/**
 * Business performance insights panel (not a chatbot).
 * Surfaces feed burn, stock, orders, mortality, and cash recommendations.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  buildFarmSnapshot,
  buildPerformanceInsights,
  type FarmSnapshot,
  type PerformanceInsight,
} from "@/lib/insights";
import { listItems, listMovements } from "@/lib/data/inventoryRepo";
import { listOrders } from "@/lib/data/ordersRepo";
import { listBatches } from "@/lib/data/incubationRepo";
import { listSales } from "@/lib/data/salesRepo";
import { listExpenses } from "@/lib/data/expensesRepo";
import { listLots, listMortality } from "@/lib/data/brooderRepo";
import { formatMoney } from "@/lib/orders";

export default function FarmAssistant() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [snapshot, setSnapshot] = useState<FarmSnapshot | null>(null);
  const [insights, setInsights] = useState<PerformanceInsight[]>([]);
  const [brief, setBrief] = useState("");
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | "feed" | "money" | "ops">(
    "all"
  );

  const urgentCount = useMemo(
    () =>
      insights.filter(
        (a) => a.severity === "critical" || a.severity === "warning"
      ).length,
    [insights]
  );

  const loadSnapshot = useCallback(async () => {
    const [items, orders, batches, sales, expenses, lots, mortality, movements] =
      await Promise.all([
        listItems(),
        listOrders(),
        listBatches(),
        listSales(),
        listExpenses(),
        listLots(),
        listMortality(),
        listMovements(),
      ]);
    const snap = buildFarmSnapshot({
      items,
      orders,
      batches,
      sales,
      expenses,
      lots,
      mortality,
      movements,
    });
    const nextInsights = buildPerformanceInsights(snap);
    setSnapshot(snap);
    setInsights(nextInsights);
    return { snap, nextInsights };
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { snap, nextInsights } = await loadSnapshot();
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "brief",
          snapshot: snap,
          insights: nextInsights,
        }),
      });
      const data = (await res.json()) as {
        aiEnabled?: boolean;
        insights?: PerformanceInsight[];
        brief?: string;
        error?: string;
        message?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Failed to load insights");
      setAiEnabled(Boolean(data.aiEnabled));
      if (data.insights?.length) setInsights(data.insights);
      setBrief(data.brief ?? data.message ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh");
    } finally {
      setLoading(false);
    }
  }, [loadSnapshot]);

  useEffect(() => {
    if (!open) return;
    void refresh();
  }, [open, refresh]);

  const filtered = useMemo(() => {
    if (filter === "all") return insights;
    if (filter === "feed")
      return insights.filter((i) => i.area === "feed" || i.area === "brooder");
    if (filter === "money")
      return insights.filter(
        (i) =>
          i.area === "cash" || i.area === "sales" || i.area === "orders"
      );
    return insights.filter(
      (i) =>
        i.area === "stock" ||
        i.area === "hatch" ||
        i.area === "ops" ||
        i.area === "brooder"
    );
  }, [insights, filter]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed z-[70] bottom-20 md:bottom-6 right-4 md:right-6 flex items-center gap-2 rounded-full bg-primary text-on-primary shadow-lg px-4 py-3 hover:opacity-95 transition"
        aria-label="Open business insights"
      >
        <span className="material-symbols-outlined text-[22px]">
          monitoring
        </span>
        <span className="text-sm font-semibold hidden sm:inline">Insights</span>
        {urgentCount > 0 && (
          <span className="min-w-5 h-5 px-1 rounded-full bg-secondary-container text-on-secondary-container text-[11px] font-bold flex items-center justify-center">
            {urgentCount > 9 ? "9+" : urgentCount}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center sm:p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/35 backdrop-blur-[2px]"
            aria-label="Close insights"
            onClick={() => setOpen(false)}
          />
          <div className="relative w-full sm:max-w-lg max-h-[90vh] sm:max-h-[85vh] bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl border border-outline-variant flex flex-col overflow-hidden">
            <header className="px-4 pt-4 pb-3 border-b border-outline-variant/60 shrink-0">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-tertiary-container font-semibold">
                    Performance
                  </p>
                  <h3 className="text-lg font-semibold text-on-surface">
                    Business insights
                  </h3>
                  <p className="text-xs text-on-surface-variant mt-0.5">
                    Feed, stock, sales &amp; cash — from your live farm data
                    {aiEnabled === true
                      ? " · AI brief on"
                      : aiEnabled === false
                        ? " · rules only"
                        : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="w-9 h-9 rounded-full hover:bg-surface-container-high flex items-center justify-center"
                  aria-label="Close"
                >
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>

              {snapshot && <KpiStrip snapshot={snapshot} />}

              <div className="flex flex-wrap gap-1 mt-3">
                {(
                  [
                    ["all", "All"],
                    ["feed", "Feed"],
                    ["money", "Money"],
                    ["ops", "Ops"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setFilter(id)}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold transition ${
                      filter === id
                        ? "bg-primary text-on-primary"
                        : "bg-surface-container-high text-on-surface-variant"
                    }`}
                  >
                    {label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => void refresh()}
                  disabled={loading}
                  className="ml-auto text-xs text-primary font-medium px-2 py-1.5 rounded-lg hover:bg-primary-fixed/50 disabled:opacity-50"
                >
                  {loading ? "…" : "Refresh"}
                </button>
              </div>
            </header>

            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {error && (
                <p className="text-sm text-on-error-container bg-error-container/50 border border-error/20 rounded-xl px-3 py-2">
                  {error}
                </p>
              )}

              {brief && (
                <div className="rounded-2xl border border-primary/20 bg-primary-fixed/25 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-primary mb-1">
                    Brief
                  </p>
                  <pre className="text-sm text-on-surface whitespace-pre-wrap font-sans leading-relaxed">
                    {brief}
                  </pre>
                </div>
              )}

              {loading && !insights.length && (
                <p className="text-sm text-on-surface-variant">
                  Reading expenses, stock, orders…
                </p>
              )}

              {filtered.map((insight) => (
                <InsightCard key={insight.id} insight={insight} />
              ))}

              <p className="text-[11px] text-on-surface-variant pb-2 leading-relaxed">
                Tips improve when you log <strong>feed</strong> under Expenses
                and <strong>mortality</strong> in Brooder. Example: if bags run
                out early, insights will flag rising feed spend vs bird count
                and suggest wastage checks.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function KpiStrip({ snapshot }: { snapshot: FarmSnapshot }) {
  return (
    <div className="grid grid-cols-3 gap-2 mt-3">
      <Kpi
        label="Feed 7d"
        value={formatMoney(snapshot.feed.spend7d)}
        sub={
          snapshot.feed.burnChangePct != null
            ? `${snapshot.feed.burnChangePct > 0 ? "+" : ""}${snapshot.feed.burnChangePct}% vs prev`
            : "vs prior week"
        }
      />
      <Kpi
        label="Birds"
        value={String(snapshot.birdsOnFarm)}
        sub={
          snapshot.feed.perBird7d != null
            ? `${formatMoney(snapshot.feed.perBird7d)} feed/bird`
            : "on books"
        }
      />
      <Kpi
        label="MTD profit"
        value={formatMoney(snapshot.finance.profit)}
        sub={
          snapshot.finance.feedPctOfExpenses != null
            ? `Feed ${snapshot.finance.feedPctOfExpenses}% costs`
            : "this month"
        }
      />
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-xl bg-surface-container-low border border-outline-variant/50 px-2 py-2">
      <p className="text-[10px] uppercase tracking-wide text-on-surface-variant">
        {label}
      </p>
      <p className="text-sm font-semibold text-on-surface truncate">{value}</p>
      <p className="text-[10px] text-on-surface-variant truncate">{sub}</p>
    </div>
  );
}

function InsightCard({ insight }: { insight: PerformanceInsight }) {
  const tone =
    insight.severity === "critical"
      ? "border-error/40 bg-error-container/25"
      : insight.severity === "warning"
        ? "border-amber-700/25 bg-amber-50"
        : insight.severity === "good"
          ? "border-emerald-800/25 bg-emerald-50/80"
          : "border-outline-variant bg-surface-container-low";

  return (
    <article className={`rounded-2xl border p-3 space-y-2 ${tone}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wide font-semibold text-on-surface-variant">
              {insight.area} · {insight.severity}
            </span>
            {insight.metric && (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-white/70 border border-outline-variant/50">
                {insight.metric}
              </span>
            )}
          </div>
          <h4 className="text-sm font-semibold text-on-surface mt-0.5">
            {insight.title}
          </h4>
        </div>
        {insight.href && (
          <Link
            href={insight.href}
            className="text-xs font-medium text-primary shrink-0 hover:underline"
          >
            Open
          </Link>
        )}
      </div>
      <p className="text-xs text-on-surface-variant leading-relaxed">
        <span className="font-medium text-on-surface">Finding: </span>
        {insight.finding}
      </p>
      <p className="text-xs leading-relaxed text-on-surface">
        <span className="font-medium text-primary">Do this: </span>
        {insight.recommendation}
      </p>
    </article>
  );
}
