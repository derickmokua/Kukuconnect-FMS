"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Nav from "@/components/Nav";
import {
  type IncubationBatch,
  createBatch,
  discardBatch,
  formatDateKe,
  getCurrentDay,
  getEggsStillIn,
  getExpectedHatchDate,
  getProgressPercent,
  hatchBatch,
  isDueOrOverdue,
  todayIsoDate,
  updateHatchRecord,
  DEFAULT_INCUBATION_DAYS,
} from "@/lib/incubation";
import { addFromHatch } from "@/lib/inventory";
import { lotFromHatch } from "@/lib/brooder";
import { listBatches, saveBatches } from "@/lib/data/incubationRepo";
import {
  listItems,
  listMovements,
  saveItems,
  saveMovements,
} from "@/lib/data/inventoryRepo";
import { listLots, saveLots } from "@/lib/data/brooderRepo";
import {
  MONTH_OPTIONS,
  availableYears,
  batchHatchMetrics,
  buildHatchReport,
  downloadHatchReport,
  formatHatchRate,
  makePeriodKey,
  type PeriodBasis,
} from "@/lib/hatchReport";

type Filter = "active" | "all" | "completed";
type PeriodMode = "all" | "year" | "month";

export default function IncubationPage() {
  const [batches, setBatches] = useState<IncubationBatch[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [filter, setFilter] = useState<Filter>("active");
  const [showForm, setShowForm] = useState(false);
  const [periodMode, setPeriodMode] = useState<PeriodMode>("month");
  const [reportYear, setReportYear] = useState(() => new Date().getFullYear());
  const [reportMonthNum, setReportMonthNum] = useState(() =>
    String(new Date().getMonth() + 1).padStart(2, "0")
  );
  const [periodBasis, setPeriodBasis] = useState<PeriodBasis>("start");
  const [reportBusy, setReportBusy] = useState(false);

  const [name, setName] = useState("");
  const [eggCount, setEggCount] = useState(100);
  const [startDate, setStartDate] = useState(todayIsoDate());
  const [incubationDays, setIncubationDays] = useState(DEFAULT_INCUBATION_DAYS);
  const [notes, setNotes] = useState("");

  const [hatchTargetId, setHatchTargetId] = useState<string | null>(null);
  const [hatchCount, setHatchCount] = useState(0);
  const [hatchNotes, setHatchNotes] = useState("");
  const [hatchDate, setHatchDate] = useState(todayIsoDate());
  const [syncToBrooder, setSyncToBrooder] = useState(true);

  const [candleTargetId, setCandleTargetId] = useState<string | null>(null);
  const [removedEggs, setRemovedEggs] = useState(0);
  const [candlingNotes, setCandlingNotes] = useState("");

  const [editTargetId, setEditTargetId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editEggCount, setEditEggCount] = useState(100);
  const [editStartDate, setEditStartDate] = useState("");
  const [editIncubationDays, setEditIncubationDays] = useState(21);
  const [editNotes, setEditNotes] = useState("");
  const [editHatchDate, setEditHatchDate] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const next = await listBatches();
        if (!cancelled) setBatches(next);
      } catch (err) {
        alert(err instanceof Error ? err.message : "Failed to load batches");
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback(async (next: IncubationBatch[]) => {
    setBatches(next);
    try {
      await saveBatches(next);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save batches");
    }
  }, []);

  const filtered = useMemo(() => {
    const sorted = [...batches].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    if (filter === "active") return sorted.filter((b) => b.status === "incubating");
    if (filter === "completed")
      return sorted.filter((b) => b.status === "hatched" || b.status === "discarded");
    return sorted;
  }, [batches, filter]);

  const stats = useMemo(() => {
    const active = batches.filter((b) => b.status === "incubating");
    const eggs = active.reduce((s, b) => s + getEggsStillIn(b), 0);
    const due = active.filter((b) => isDueOrOverdue(b)).length;
    const hatchedTotal = batches
      .filter((b) => b.status === "hatched")
      .reduce((s, b) => s + (b.hatchedCount ?? 0), 0);
    return { active: active.length, eggs, due, hatchedTotal };
  }, [batches]);

  const reportYears = useMemo(() => availableYears(batches), [batches]);
  const periodKey = useMemo(
    () => makePeriodKey(periodMode, reportYear, reportMonthNum),
    [periodMode, reportYear, reportMonthNum]
  );
  const hatchReport = useMemo(
    () => buildHatchReport(batches, { period: periodKey, basis: periodBasis }),
    [batches, periodKey, periodBasis]
  );

  const handleDownloadHatchReport = async () => {
    setReportBusy(true);
    try {
      await downloadHatchReport(hatchReport);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Could not create PDF");
    } finally {
      setReportBusy(false);
    }
  };

  const resetForm = () => {
    setName("");
    setEggCount(100);
    setStartDate(todayIsoDate());
    setIncubationDays(DEFAULT_INCUBATION_DAYS);
    setNotes("");
    setShowForm(false);
  };

  const handleAddBatch = (e: React.FormEvent) => {
    e.preventDefault();
    if (eggCount <= 0) {
      alert("Egg count must be greater than zero.");
      return;
    }
    const batch = createBatch({ name, eggCount, startDate, incubationDays, notes });
    persist([batch, ...batches]);
    resetForm();
  };

  const openHatch = (batch: IncubationBatch) => {
    setHatchTargetId(batch.id);
    setHatchCount(getEggsStillIn(batch));
    setHatchNotes("");
    setHatchDate(todayIsoDate());
    setSyncToBrooder(true);
    setCandleTargetId(null);
    setEditTargetId(null);
  };

  const confirmHatch = async () => {
    if (!hatchTargetId) return;
    const target = batches.find((b) => b.id === hatchTargetId);
    if (!target) return;

    const hatched = hatchBatch(target, {
      hatchedCount: hatchCount,
      notes: hatchNotes,
      hatchedAt: hatchDate,
    });
    const next = batches.map((b) => (b.id === hatchTargetId ? hatched : b));
    await persist(next);

    // Day-old chicks → inventory + brooder lot (for daily age-up / mortality)
    if (syncToBrooder && (hatched.hatchedCount ?? 0) > 0) {
      try {
        const invResult = addFromHatch(
          await listItems(),
          await listMovements(),
          hatched.hatchedCount ?? 0,
          hatched.name,
          hatched.id,
          hatched.hatchedAt ?? undefined
        );
        if (invResult.ok) {
          await saveItems(invResult.items);
          await saveMovements(invResult.movements);
        }
        const lot = lotFromHatch({
          batchName: hatched.name,
          hatchedCount: hatched.hatchedCount ?? 0,
          batchId: hatched.id,
          hatchDate: hatched.hatchedAt ? hatched.hatchedAt.slice(0, 10) : undefined,
        });
        const existingLots = await listLots();
        await saveLots([lot, ...existingLots]);
      } catch (err) {
        alert(
          err instanceof Error
            ? err.message
            : "Hatch saved but inventory/brooder update failed"
        );
      }
    }

    setHatchDate(todayIsoDate());
    setHatchTargetId(null);
  };

  const openCandle = (batch: IncubationBatch) => {
    setCandleTargetId(batch.id);
    setRemovedEggs(batch.removedEggs);
    setCandlingNotes(batch.candlingNotes);
    setHatchTargetId(null);
    setEditTargetId(null);
  };

  const openEdit = (batch: IncubationBatch) => {
    setEditTargetId(batch.id);
    setEditName(batch.name);
    setEditEggCount(batch.eggCount);
    setEditStartDate(batch.startDate);
    setEditIncubationDays(batch.incubationDays);
    setEditNotes(batch.notes);
    setEditHatchDate(batch.hatchedAt ? batch.hatchedAt.slice(0, 10) : "");
    setHatchTargetId(null);
    setCandleTargetId(null);
  };

  const confirmEdit = async () => {
    if (!editTargetId) return;
    const target = batches.find((b) => b.id === editTargetId);
    if (!target) return;
    const wasHatched = target.status === "hatched";

    const next = batches.map((b) => {
      if (b.id !== editTargetId) return b;
      let updated: IncubationBatch = {
        ...b,
        name: editName.trim() || b.name,
        eggCount: Math.max(0, Math.floor(editEggCount)),
        startDate: editStartDate || b.startDate,
        incubationDays: Math.max(1, Math.floor(editIncubationDays)),
        notes: editNotes.trim(),
      };
      if (wasHatched && editHatchDate) {
        updated = updateHatchRecord(updated, { hatchedAt: editHatchDate });
      }
      return updated;
    });
    await persist(next);

    if (wasHatched && editHatchDate) {
      try {
        const hatchIso = new Date(editHatchDate + "T12:00:00").toISOString();
        const movements = await listMovements();
        const nextMovements = movements.map((m) => {
          if (m.refId === editTargetId && m.type === "hatch") {
            return { ...m, createdAt: hatchIso };
          }
          return m;
        });
        await saveMovements(nextMovements);

        // Matching brooder lots reference the batch id in notes
        const lotsList = await listLots();
        const nextLots = lotsList.map((lot) => {
          if (lot.notes.includes(editTargetId)) {
            return { ...lot, hatchDate: editHatchDate };
          }
          return lot;
        });
        await saveLots(nextLots);
      } catch (err) {
        console.error("Failed to sync edited hatch date:", err);
      }
    }

    setEditTargetId(null);
  };

  const confirmCandle = () => {
    if (!candleTargetId) return;
    const next = batches.map((b) => {
      if (b.id !== candleTargetId) return b;
      const removed = Math.min(b.eggCount, Math.max(0, Math.floor(removedEggs)));
      return {
        ...b,
        removedEggs: removed,
        candlingNotes: candlingNotes.trim(),
      };
    });
    persist(next);
    setCandleTargetId(null);
  };

  const handleDiscard = (batch: IncubationBatch) => {
    const reason = window.prompt(
      "Discard this batch? Enter a reason (optional), or Cancel to keep it."
    );
    if (reason === null) return;
    const next = batches.map((b) =>
      b.id === batch.id ? discardBatch(b, reason || undefined) : b
    );
    persist(next);
  };

  const handleDelete = (id: string) => {
    if (!window.confirm("Permanently delete this batch record?")) return;
    persist(batches.filter((b) => b.id !== id));
  };

  if (!hydrated) {
    return (
      <div className="max-w-5xl mx-auto">
        <Nav />
        <p className="text-on-surface-variant">Loading incubation data…</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <Nav />

      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 border-b border-outline-variant pb-6">
        <div>
          <h2 className="text-3xl font-bold text-on-surface">Incubation Tracker</h2>
          <p className="text-on-surface-variant mt-1">
            Track egg batches, day count, candling, and hatch results
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="bg-secondary-container text-on-secondary-container hover:opacity-90 px-6 py-3 rounded-2xl font-medium transition"
        >
          {showForm ? "Cancel" : "+ New Batch"}
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard label="Active batches" value={String(stats.active)} accent="text-secondary" />
        <SummaryCard label="Eggs incubating" value={stats.eggs.toLocaleString()} accent="text-secondary" />
        <SummaryCard label="Due / overdue" value={String(stats.due)} accent="text-error" />
        <SummaryCard label="Chicks hatched (all time)" value={stats.hatchedTotal.toLocaleString()} accent="text-tertiary-container" />
      </div>

      {/* Hatch report */}
      <section className="farm-card rounded-3xl border border-outline-variant p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-widest text-tertiary-container font-medium">
              Performance
            </p>
            <h3 className="text-xl font-semibold text-on-surface mt-1">
              Hatching report
            </h3>
            <p className="text-sm text-on-surface-variant mt-1">
              Count batches by month or year. Hatch rate = chicks ÷ eggs set on
              completed hatches only.
            </p>
          </div>
          <button
            type="button"
            disabled={reportBusy}
            onClick={() => void handleDownloadHatchReport()}
            className="bg-tertiary-container text-on-primary hover:opacity-90 disabled:opacity-50 px-4 py-2.5 rounded-xl text-sm font-medium shrink-0"
          >
            {reportBusy ? "Preparing…" : "Download PDF"}
          </button>
        </div>

        {/* Period filters: all / year / month + basis */}
        <div className="flex flex-col gap-3 rounded-2xl bg-surface-container-low border border-outline-variant/60 p-4">
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["all", "All time"],
                ["year", "Year"],
                ["month", "Month"],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setPeriodMode(mode)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition ${
                  periodMode === mode
                    ? "bg-primary text-on-primary"
                    : "bg-surface-container-highest text-on-surface-variant"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            {periodMode !== "all" && (
              <label className="text-sm text-on-surface-variant space-y-1">
                <span className="block text-xs">Year</span>
                <select
                  value={reportYear}
                  onChange={(e) => setReportYear(Number(e.target.value))}
                  className="bg-surface-container-highest text-on-surface rounded-xl px-3 py-2 text-sm border border-outline-variant min-w-[6rem]"
                >
                  {reportYears.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {periodMode === "month" && (
              <label className="text-sm text-on-surface-variant space-y-1">
                <span className="block text-xs">Month</span>
                <select
                  value={reportMonthNum}
                  onChange={(e) => setReportMonthNum(e.target.value)}
                  className="bg-surface-container-highest text-on-surface rounded-xl px-3 py-2 text-sm border border-outline-variant min-w-[9rem]"
                >
                  {MONTH_OPTIONS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="text-sm text-on-surface-variant space-y-1">
              <span className="block text-xs">Count batches by</span>
              <select
                value={periodBasis}
                onChange={(e) =>
                  setPeriodBasis(e.target.value as PeriodBasis)
                }
                className="bg-surface-container-highest text-on-surface rounded-xl px-3 py-2 text-sm border border-outline-variant min-w-[12rem]"
              >
                <option value="start">Set date (batch started)</option>
                <option value="hatch">Hatch date (when finished)</option>
              </select>
            </label>
            <p className="text-xs text-on-surface-variant self-center sm:ml-1">
              Showing: <strong className="text-on-surface">{hatchReport.periodLabel}</strong>
              {" · "}
              {hatchReport.basisLabel}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <SummaryCard
            label="Batches in period"
            value={String(hatchReport.summary.batchesInPeriod)}
            accent="text-on-surface"
          />
          <SummaryCard
            label="Still incubating"
            value={String(hatchReport.summary.batchesIncubating)}
            accent="text-secondary"
          />
          <SummaryCard
            label="Completed / hatched"
            value={String(hatchReport.summary.batchesCompleted)}
            accent="text-tertiary-container"
          />
          <SummaryCard
            label="Eggs set (period)"
            value={hatchReport.summary.eggsSetInPeriod.toLocaleString()}
            accent="text-on-surface"
          />
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <SummaryCard
            label="Chicks hatched"
            value={hatchReport.summary.chicksHatched.toLocaleString()}
            accent="text-tertiary-container"
          />
          <SummaryCard
            label="Hatch rate (of eggs set)"
            value={formatHatchRate(hatchReport.summary.hatchRateOfSet)}
            accent="text-secondary"
          />
          <SummaryCard
            label="Eggs on completed"
            value={hatchReport.summary.eggsSetCompleted.toLocaleString()}
            accent="text-on-surface"
          />
          <SummaryCard
            label="Unhatched (completed)"
            value={hatchReport.summary.unhatched.toLocaleString()}
            accent="text-on-surface"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <div className="rounded-2xl bg-surface-container-low border border-outline-variant/60 px-4 py-3">
            <p className="text-xs text-on-surface-variant">After candling</p>
            <p className="text-lg font-semibold text-on-surface">
              {formatHatchRate(hatchReport.summary.hatchRateOfFertile)}
            </p>
            <p className="text-xs text-on-surface-variant mt-0.5">
              Chicks ÷ eggs left after removes
            </p>
          </div>
          <div className="rounded-2xl bg-surface-container-low border border-outline-variant/60 px-4 py-3">
            <p className="text-xs text-on-surface-variant">Unhatched</p>
            <p className="text-lg font-semibold text-on-surface">
              {hatchReport.summary.unhatched.toLocaleString()}
            </p>
            <p className="text-xs text-on-surface-variant mt-0.5">
              Eggs that did not produce a chick
            </p>
          </div>
          <div className="rounded-2xl bg-surface-container-low border border-outline-variant/60 px-4 py-3">
            <p className="text-xs text-on-surface-variant">Best batch</p>
            <p className="text-lg font-semibold text-on-surface truncate">
              {hatchReport.summary.bestBatchName
                ? `${formatHatchRate(hatchReport.summary.bestBatchRate)} · ${hatchReport.summary.bestBatchName}`
                : "—"}
            </p>
            <p className="text-xs text-on-surface-variant mt-0.5">
              By hatch rate of eggs set
            </p>
          </div>
        </div>

        {hatchReport.inProgress.count > 0 && (
          <div className="rounded-2xl border border-secondary/30 bg-secondary-fixed/30 px-4 py-3 space-y-2">
            <p className="text-sm font-medium text-on-surface">
              {hatchReport.inProgress.count} batch
              {hatchReport.inProgress.count === 1 ? "" : "es"} still incubating
              — not in hatch rate yet
            </p>
            <p className="text-xs text-on-surface-variant">
              {hatchReport.inProgress.eggsStillIn.toLocaleString()} eggs still
              in · hatch rate is calculated only after you click{" "}
              <strong className="text-on-surface">Record hatch</strong> and
              enter chicks hatched.
            </p>
            <ul className="text-sm text-on-surface space-y-1">
              {hatchReport.inProgress.batches.map((b) => (
                <li key={b.name + b.startDate} className="flex flex-wrap gap-x-3 gap-y-0.5">
                  <span className="font-medium">{b.name}</span>
                  <span className="text-on-surface-variant">
                    {b.eggsSet} eggs · {b.dayLabel}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {hatchReport.rows.length === 0 ? (
          <p className="text-sm text-on-surface-variant rounded-xl bg-surface-container-low border border-outline-variant/50 px-3 py-3">
            {hatchReport.inProgress.count > 0
              ? `Hatch report totals are 0 because your ${hatchReport.inProgress.count} batch(es) are still “Incubating”. When chicks come out, open each batch → Record hatch → enter how many hatched. Then rates appear here.`
              : "No completed hatches in this period. Record hatch results on a batch to build the report."}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-outline-variant">
            <table className="w-full text-sm text-left min-w-[640px]">
              <thead className="bg-surface-container-high text-on-surface-variant text-xs uppercase tracking-wide">
                <tr>
                  <th className="px-3 py-2.5 font-medium">Batch</th>
                  <th className="px-3 py-2.5 font-medium">Eggs set</th>
                  <th className="px-3 py-2.5 font-medium">Candled out</th>
                  <th className="px-3 py-2.5 font-medium">Hatched</th>
                  <th className="px-3 py-2.5 font-medium">Rate (set)</th>
                  <th className="px-3 py-2.5 font-medium">Rate (after candle)</th>
                  <th className="px-3 py-2.5 font-medium">Hatch date</th>
                </tr>
              </thead>
              <tbody>
                {hatchReport.rows.map((row) => (
                  <tr
                    key={row.batchId}
                    className="border-t border-outline-variant/60 text-on-surface"
                  >
                    <td className="px-3 py-2.5 font-medium">{row.name}</td>
                    <td className="px-3 py-2.5">{row.eggsSet}</td>
                    <td className="px-3 py-2.5">{row.removedEggs}</td>
                    <td className="px-3 py-2.5 font-semibold text-tertiary-container">
                      {row.chicksHatched}
                    </td>
                    <td className="px-3 py-2.5 font-semibold">
                      {formatHatchRate(row.hatchRateOfSet)}
                    </td>
                    <td className="px-3 py-2.5">
                      {formatHatchRate(row.hatchRateOfFertile)}
                    </td>
                    <td className="px-3 py-2.5 text-on-surface-variant">
                      {row.hatchedAt
                        ? formatDateKe(row.hatchedAt.slice(0, 10))
                        : formatDateKe(row.startDate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* New batch form */}
      {showForm && (
        <form
          onSubmit={handleAddBatch}
          className="farm-card p-6 sm:p-8 rounded-3xl space-y-4 border border-outline-variant"
        >
          <h3 className="text-lg font-semibold text-on-surface">Start new incubation batch</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="block space-y-2">
              <span className="text-sm text-on-surface-variant">Batch name</span>
              <input
                required
                className="w-full bg-surface-container-highest p-4 rounded-2xl text-on-surface"
                placeholder="e.g. Setter A — July week 1"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="block space-y-2">
              <span className="text-sm text-on-surface-variant">Number of eggs</span>
              <input
                type="number"
                min={1}
                required
                className="w-full bg-surface-container-highest p-4 rounded-2xl text-on-surface"
                value={eggCount}
                onChange={(e) => setEggCount(Number(e.target.value))}
              />
            </label>
            <label className="block space-y-2">
              <span className="text-sm text-on-surface-variant">Start date (set day)</span>
              <input
                type="date"
                required
                className="w-full bg-surface-container-highest p-4 rounded-2xl text-on-surface"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </label>
            <label className="block space-y-2">
              <span className="text-sm text-on-surface-variant">Incubation days</span>
              <input
                type="number"
                min={1}
                max={40}
                required
                className="w-full bg-surface-container-highest p-4 rounded-2xl text-on-surface"
                value={incubationDays}
                onChange={(e) => setIncubationDays(Number(e.target.value))}
              />
              <span className="text-xs text-on-surface-variant">Chickens usually 21 days</span>
            </label>
          </div>
          <label className="block space-y-2">
            <span className="text-sm text-on-surface-variant">Notes (optional)</span>
            <textarea
              className="w-full bg-surface-container-highest p-4 rounded-2xl text-on-surface min-h-[80px]"
              placeholder="Incubator ID, egg source, temperature notes…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          <button
            type="submit"
            className="bg-primary hover:bg-primary/90 px-8 py-3 rounded-2xl font-semibold transition"
          >
            Save batch
          </button>
        </form>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {(
          [
            ["active", "Active"],
            ["completed", "Completed"],
            ["all", "All"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition ${
              filter === key
                ? "bg-primary-container text-on-primary"
                : "bg-surface-container-highest text-on-surface hover:bg-surface-container-high"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Batch list */}
      {filtered.length === 0 ? (
        <div className="farm-card rounded-3xl p-12 text-center text-on-surface-variant border border-outline-variant">
          {filter === "active"
            ? "No active batches. Start a new batch to track incubation."
            : "No batches in this view yet."}
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((batch) => (
            <BatchCard
              key={batch.id}
              batch={batch}
              isHatching={hatchTargetId === batch.id}
              isCandling={candleTargetId === batch.id}
              isEditing={editTargetId === batch.id}
              hatchCount={hatchCount}
              hatchNotes={hatchNotes}
              removedEggs={removedEggs}
              candlingNotes={candlingNotes}
              editName={editName}
              editEggCount={editEggCount}
              editStartDate={editStartDate}
              editIncubationDays={editIncubationDays}
              editNotes={editNotes}
              syncToBrooder={syncToBrooder}
              hatchDate={hatchDate}
              setHatchDate={setHatchDate}
              editHatchDate={editHatchDate}
              setEditHatchDate={setEditHatchDate}
              onOpenHatch={() => openHatch(batch)}
              onOpenCandle={() => openCandle(batch)}
              onOpenEdit={() => openEdit(batch)}
              onDiscard={() => handleDiscard(batch)}
              onDelete={() => handleDelete(batch.id)}
              onCancelHatch={() => setHatchTargetId(null)}
              onCancelCandle={() => setCandleTargetId(null)}
              onCancelEdit={() => setEditTargetId(null)}
              onConfirmHatch={confirmHatch}
              onConfirmCandle={confirmCandle}
              onConfirmEdit={confirmEdit}
              setHatchCount={setHatchCount}
              setHatchNotes={setHatchNotes}
              setRemovedEggs={setRemovedEggs}
              setCandlingNotes={setCandlingNotes}
              setEditName={setEditName}
              setEditEggCount={setEditEggCount}
              setEditStartDate={setEditStartDate}
              setEditIncubationDays={setEditIncubationDays}
              setEditNotes={setEditNotes}
              setSyncToBrooder={setSyncToBrooder}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="farm-card p-5 rounded-3xl border border-outline-variant">
      <p className={`text-sm font-medium ${accent}`}>{label}</p>
      <p className="text-3xl font-bold text-on-surface mt-2">{value}</p>
    </div>
  );
}

function BatchCard({
  batch,
  isHatching,
  isCandling,
  isEditing,
  hatchCount,
  hatchNotes,
  removedEggs,
  candlingNotes,
  editName,
  editEggCount,
  editStartDate,
  editIncubationDays,
  editNotes,
  syncToBrooder,
  hatchDate,
  setHatchDate,
  editHatchDate,
  setEditHatchDate,
  onOpenHatch,
  onOpenCandle,
  onOpenEdit,
  onDiscard,
  onDelete,
  onCancelHatch,
  onCancelCandle,
  onCancelEdit,
  onConfirmHatch,
  onConfirmCandle,
  onConfirmEdit,
  setHatchCount,
  setHatchNotes,
  setRemovedEggs,
  setCandlingNotes,
  setEditName,
  setEditEggCount,
  setEditStartDate,
  setEditIncubationDays,
  setEditNotes,
  setSyncToBrooder,
}: {
  batch: IncubationBatch;
  isHatching: boolean;
  isCandling: boolean;
  isEditing: boolean;
  hatchCount: number;
  hatchNotes: string;
  removedEggs: number;
  candlingNotes: string;
  editName: string;
  editEggCount: number;
  editStartDate: string;
  editIncubationDays: number;
  editNotes: string;
  syncToBrooder: boolean;
  hatchDate: string;
  setHatchDate: (s: string) => void;
  editHatchDate: string;
  setEditHatchDate: (s: string) => void;
  onOpenHatch: () => void;
  onOpenCandle: () => void;
  onOpenEdit: () => void;
  onDiscard: () => void;
  onDelete: () => void;
  onCancelHatch: () => void;
  onCancelCandle: () => void;
  onCancelEdit: () => void;
  onConfirmHatch: () => void;
  onConfirmCandle: () => void;
  onConfirmEdit: () => void;
  setHatchCount: (n: number) => void;
  setHatchNotes: (s: string) => void;
  setRemovedEggs: (n: number) => void;
  setCandlingNotes: (s: string) => void;
  setEditName: (s: string) => void;
  setEditEggCount: (n: number) => void;
  setEditStartDate: (s: string) => void;
  setEditIncubationDays: (n: number) => void;
  setEditNotes: (s: string) => void;
  setSyncToBrooder: (b: boolean) => void;
}) {
  const day = getCurrentDay(batch);
  const progress = getProgressPercent(batch);
  const eggsIn = getEggsStillIn(batch);
  const due = isDueOrOverdue(batch);
  const expectedHatchDate = getExpectedHatchDate(batch);
  const metrics = batchHatchMetrics(batch);

  const statusBadge =
    batch.status === "incubating"
      ? due
        ? "bg-red-900/60 text-error"
        : "bg-orange-900/50 text-orange-300"
      : batch.status === "hatched"
        ? "bg-emerald-900/50 text-emerald-300"
        : "bg-surface-container-high text-on-surface";

  const statusLabel =
    batch.status === "incubating"
      ? due
        ? "Due / hatch window"
        : "Incubating"
      : batch.status === "hatched"
        ? "Hatched"
        : "Discarded";

  return (
    <article className="farm-card rounded-3xl p-6 border border-outline-variant space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-xl font-semibold text-on-surface">{batch.name}</h3>
            <span className={`text-xs px-3 py-1 rounded-full font-medium ${statusBadge}`}>
              {statusLabel}
            </span>
          </div>
          <p className="text-on-surface-variant text-sm mt-1">
            Started {formatDateKe(batch.startDate)} · Expected hatch{" "}
            {formatDateKe(expectedHatchDate)}
          </p>
        </div>
        {batch.status === "incubating" && (
          <div className="text-right">
            <p className="text-4xl font-bold text-on-surface">
              Day {Math.min(day, batch.incubationDays)}
              <span className="text-lg text-on-surface-variant font-medium">
                /{batch.incubationDays}
              </span>
            </p>
            {day > batch.incubationDays && (
              <p className="text-error text-sm">+{day - batch.incubationDays} days past due</p>
            )}
          </div>
        )}
      </div>

      {/* Progress */}
      {batch.status === "incubating" && (
        <div>
          <div className="h-2.5 bg-surface-container-highest rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                due ? "bg-red-500" : "bg-orange-500"
              }`}
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-xs text-on-surface-variant mt-1.5">{progress}% of cycle</p>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <Stat label="Set eggs" value={String(batch.eggCount)} />
        <Stat label="Still in" value={String(eggsIn)} />
        <Stat label="Removed (candle)" value={String(batch.removedEggs)} />
        <Stat
          label="Hatched"
          value={batch.hatchedCount != null ? String(batch.hatchedCount) : "—"}
        />
      </div>

      {(batch.status === "hatched" || batch.status === "discarded") && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm rounded-2xl bg-emerald-950/20 border border-emerald-900/30 p-3">
          <Stat
            label="Hatch rate (of set)"
            value={formatHatchRate(metrics.hatchRateOfSet)}
          />
          <Stat
            label="Hatch rate (after candle)"
            value={formatHatchRate(metrics.hatchRateOfFertile)}
          />
          <Stat label="Unhatched" value={String(metrics.unhatched)} />
        </div>
      )}

      {batch.notes && (
        <p className="text-sm text-on-surface-variant whitespace-pre-wrap">
          <span className="text-on-surface-variant">Notes: </span>
          {batch.notes}
        </p>
      )}
      {batch.candlingNotes && (
        <p className="text-sm text-on-surface-variant whitespace-pre-wrap">
          <span className="text-on-surface-variant">Candling: </span>
          {batch.candlingNotes}
        </p>
      )}

      {/* Edit batch panel */}
      {isEditing && (
        <div className="bg-surface-container-low rounded-2xl p-4 space-y-3 border border-outline-variant">
          <h4 className="font-medium text-on-surface">Edit batch details</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="text-sm text-on-surface-variant">Batch name</span>
              <input
                className="w-full bg-surface-container-highest p-3 rounded-xl text-on-surface text-sm"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-sm text-on-surface-variant">Number of eggs set</span>
              <input
                type="number"
                min={1}
                className="w-full bg-surface-container-highest p-3 rounded-xl text-on-surface text-sm"
                value={editEggCount}
                onChange={(e) => setEditEggCount(Number(e.target.value))}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-sm text-on-surface-variant">Start date</span>
              <input
                type="date"
                className="w-full bg-surface-container-highest p-3 rounded-xl text-on-surface text-sm"
                value={editStartDate}
                onChange={(e) => setEditStartDate(e.target.value)}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-sm text-on-surface-variant">Incubation days</span>
              <input
                type="number"
                min={1}
                max={40}
                className="w-full bg-surface-container-highest p-3 rounded-xl text-on-surface text-sm"
                value={editIncubationDays}
                onChange={(e) => setEditIncubationDays(Number(e.target.value))}
              />
            </label>
            {batch.status === "hatched" && (
              <label className="block space-y-1 sm:col-span-2">
                <span className="text-sm text-on-surface-variant">Hatch date</span>
                <input
                  type="date"
                  className="w-full bg-surface-container-highest p-3 rounded-xl text-on-surface text-sm"
                  value={editHatchDate}
                  onChange={(e) => setEditHatchDate(e.target.value)}
                />
              </label>
            )}
          </div>
          <label className="block space-y-1">
            <span className="text-sm text-on-surface-variant">Notes</span>
            <textarea
              className="w-full bg-surface-container-highest p-3 rounded-xl text-on-surface text-sm min-h-[80px]"
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
              placeholder="Batch notes…"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onConfirmEdit}
              className="bg-secondary-container text-on-secondary-container hover:opacity-90 px-5 py-2 rounded-xl font-medium text-sm"
            >
              Save changes
            </button>
            <button
              type="button"
              onClick={onCancelEdit}
              className="bg-surface-container-high hover:bg-surface-variant px-5 py-2 rounded-xl text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Candling panel */}
      {isCandling && (
        <div className="bg-surface-container-low rounded-2xl p-4 space-y-3 border border-outline-variant">
          <h4 className="font-medium text-on-surface">Update candling</h4>
          <label className="block space-y-1">
            <span className="text-sm text-on-surface-variant">Eggs removed (infertile / dead)</span>
            <input
              type="number"
              min={0}
              max={batch.eggCount}
              className="w-full bg-surface-container-highest p-3 rounded-xl text-on-surface"
              value={removedEggs}
              onChange={(e) => setRemovedEggs(Number(e.target.value))}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm text-on-surface-variant">Candling notes</span>
            <textarea
              className="w-full bg-surface-container-highest p-3 rounded-xl text-on-surface min-h-[70px]"
              value={candlingNotes}
              onChange={(e) => setCandlingNotes(e.target.value)}
              placeholder="Day 7: 12 clears removed…"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onConfirmCandle}
              className="bg-secondary-container text-on-secondary-container hover:opacity-90 px-5 py-2 rounded-xl font-medium"
            >
              Save candling
            </button>
            <button
              type="button"
              onClick={onCancelCandle}
              className="bg-surface-container-high hover:bg-surface-variant px-5 py-2 rounded-xl"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Hatch panel */}
      {isHatching && (
        <div className="bg-surface-container-low rounded-2xl p-4 space-y-3 border border-emerald-900/50">
          <h4 className="font-medium text-on-surface">Record hatch results</h4>
          <p className="text-sm text-on-surface-variant">
            Eggs still in setter/hatcher: <strong className="text-on-surface">{eggsIn}</strong>
            .
          </p>
          <label className="block space-y-1">
            <span className="text-sm text-on-surface-variant">Hatch date</span>
            <input
              type="date"
              required
              className="w-full bg-surface-container-highest p-3 rounded-xl text-on-surface"
              value={hatchDate}
              onChange={(e) => setHatchDate(e.target.value)}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm text-on-surface-variant">Chicks hatched</span>
            <input
              type="number"
              min={0}
              max={eggsIn}
              className="w-full bg-surface-container-highest p-3 rounded-xl text-on-surface"
              value={hatchCount}
              onChange={(e) => setHatchCount(Number(e.target.value))}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm text-on-surface-variant">Notes (optional)</span>
            <input
              className="w-full bg-surface-container-highest p-3 rounded-xl text-on-surface"
              value={hatchNotes}
              onChange={(e) => setHatchNotes(e.target.value)}
              placeholder="Hatch rate notes…"
            />
          </label>
          <label className="flex items-start gap-2.5 py-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 rounded border-outline-variant text-primary focus:ring-primary"
              checked={syncToBrooder}
              onChange={(e) => setSyncToBrooder(e.target.checked)}
            />
            <span className="text-sm text-on-surface">
              Automatically add hatched chicks to inventory stock and create a Brooder lot
              <span className="block text-xs text-on-surface-variant mt-0.5">
                (Uncheck this if you already manually recorded the day-old lot in FMS to avoid duplicates)
              </span>
            </span>
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onConfirmHatch}
              className="bg-tertiary-container text-on-primary hover:bg-tertiary-container text-on-primary px-5 py-2 rounded-xl font-medium"
            >
              Complete hatch
            </button>
            <button
              type="button"
              onClick={onCancelHatch}
              className="bg-surface-container-high hover:bg-surface-variant px-5 py-2 rounded-xl"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2 pt-1">
        {batch.status === "incubating" && !isHatching && !isCandling && !isEditing && (
          <>
            <button
              type="button"
              onClick={onOpenCandle}
              className="bg-surface-container-highest hover:bg-surface-container-high px-4 py-2 rounded-xl text-sm"
            >
              Candling
            </button>
            <button
              type="button"
              onClick={onOpenHatch}
              className="bg-tertiary-container text-on-primary hover:bg-tertiary-container text-on-primary px-4 py-2 rounded-xl text-sm font-medium"
            >
              Record hatch
            </button>
            <button
              type="button"
              onClick={onDiscard}
              className="bg-surface-container-highest hover:bg-surface-container-high px-4 py-2 rounded-xl text-sm text-error"
            >
              Discard
            </button>
          </>
        )}
        {!isHatching && !isCandling && !isEditing && (
          <button
            type="button"
            onClick={onOpenEdit}
            className="bg-surface-container-highest hover:bg-surface-container-high px-4 py-2 rounded-xl text-sm"
          >
            Edit
          </button>
        )}
        <button
          type="button"
          onClick={onDelete}
          className="bg-surface-container-lowest hover:bg-surface-container-highest border border-outline-variant px-4 py-2 rounded-xl text-sm text-on-surface-variant ml-auto"
        >
          Delete
        </button>
      </div>
    </article>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface-container-low rounded-2xl px-3 py-2">
      <p className="text-on-surface-variant text-xs">{label}</p>
      <p className="text-on-surface font-semibold mt-0.5">{value}</p>
    </div>
  );
}
