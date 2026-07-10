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

type Filter = "active" | "all" | "completed";

export default function IncubationPage() {
  const [batches, setBatches] = useState<IncubationBatch[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [filter, setFilter] = useState<Filter>("active");
  const [showForm, setShowForm] = useState(false);

  const [name, setName] = useState("");
  const [eggCount, setEggCount] = useState(100);
  const [startDate, setStartDate] = useState(todayIsoDate());
  const [incubationDays, setIncubationDays] = useState(DEFAULT_INCUBATION_DAYS);
  const [notes, setNotes] = useState("");

  const [hatchTargetId, setHatchTargetId] = useState<string | null>(null);
  const [hatchCount, setHatchCount] = useState(0);
  const [hatchNotes, setHatchNotes] = useState("");

  const [candleTargetId, setCandleTargetId] = useState<string | null>(null);
  const [removedEggs, setRemovedEggs] = useState(0);
  const [candlingNotes, setCandlingNotes] = useState("");

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
    setCandleTargetId(null);
  };

  const confirmHatch = async () => {
    if (!hatchTargetId) return;
    const target = batches.find((b) => b.id === hatchTargetId);
    if (!target) return;

    const hatched = hatchBatch(target, {
      hatchedCount: hatchCount,
      notes: hatchNotes,
    });
    const next = batches.map((b) => (b.id === hatchTargetId ? hatched : b));
    await persist(next);

    // Day-old chicks → inventory + brooder lot (for daily age-up / mortality)
    if ((hatched.hatchedCount ?? 0) > 0) {
      try {
        const invResult = addFromHatch(
          await listItems(),
          await listMovements(),
          hatched.hatchedCount ?? 0,
          hatched.name,
          hatched.id
        );
        if (invResult.ok) {
          await saveItems(invResult.items);
          await saveMovements(invResult.movements);
        }
        const lot = lotFromHatch({
          batchName: hatched.name,
          hatchedCount: hatched.hatchedCount ?? 0,
          batchId: hatched.id,
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

    setHatchTargetId(null);
  };

  const openCandle = (batch: IncubationBatch) => {
    setCandleTargetId(batch.id);
    setRemovedEggs(batch.removedEggs);
    setCandlingNotes(batch.candlingNotes);
    setHatchTargetId(null);
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
              hatchCount={hatchCount}
              hatchNotes={hatchNotes}
              removedEggs={removedEggs}
              candlingNotes={candlingNotes}
              onOpenHatch={() => openHatch(batch)}
              onOpenCandle={() => openCandle(batch)}
              onDiscard={() => handleDiscard(batch)}
              onDelete={() => handleDelete(batch.id)}
              onCancelHatch={() => setHatchTargetId(null)}
              onCancelCandle={() => setCandleTargetId(null)}
              onConfirmHatch={confirmHatch}
              onConfirmCandle={confirmCandle}
              setHatchCount={setHatchCount}
              setHatchNotes={setHatchNotes}
              setRemovedEggs={setRemovedEggs}
              setCandlingNotes={setCandlingNotes}
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
  hatchCount,
  hatchNotes,
  removedEggs,
  candlingNotes,
  onOpenHatch,
  onOpenCandle,
  onDiscard,
  onDelete,
  onCancelHatch,
  onCancelCandle,
  onConfirmHatch,
  onConfirmCandle,
  setHatchCount,
  setHatchNotes,
  setRemovedEggs,
  setCandlingNotes,
}: {
  batch: IncubationBatch;
  isHatching: boolean;
  isCandling: boolean;
  hatchCount: number;
  hatchNotes: string;
  removedEggs: number;
  candlingNotes: string;
  onOpenHatch: () => void;
  onOpenCandle: () => void;
  onDiscard: () => void;
  onDelete: () => void;
  onCancelHatch: () => void;
  onCancelCandle: () => void;
  onConfirmHatch: () => void;
  onConfirmCandle: () => void;
  setHatchCount: (n: number) => void;
  setHatchNotes: (s: string) => void;
  setRemovedEggs: (n: number) => void;
  setCandlingNotes: (s: string) => void;
}) {
  const day = getCurrentDay(batch);
  const progress = getProgressPercent(batch);
  const eggsIn = getEggsStillIn(batch);
  const due = isDueOrOverdue(batch);
  const hatchDate = getExpectedHatchDate(batch);

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
            {formatDateKe(hatchDate)}
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
            . Hatched chicks are added to inventory as 1 Day Old Chicks.
          </p>
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
        {batch.status === "incubating" && !isHatching && !isCandling && (
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
