import { loadJson, saveJson } from "./storage";

export const INCUBATION_STORAGE_KEY = "kukuconnect-incubation-batches";

/** Standard chicken incubation length (days). */
export const DEFAULT_INCUBATION_DAYS = 21;

export type BatchStatus = "incubating" | "hatched" | "discarded";

export interface IncubationBatch {
  id: string;
  name: string;
  eggCount: number;
  /** ISO date string YYYY-MM-DD (local calendar day set). */
  startDate: string;
  incubationDays: number;
  status: BatchStatus;
  notes: string;
  /** Candling / mid-cycle notes */
  candlingNotes: string;
  /** Eggs removed after candling (infertile / dead). */
  removedEggs: number;
  hatchedCount: number | null;
  hatchedAt: string | null;
  createdAt: string;
}

export interface HatchResult {
  hatchedCount: number;
  notes?: string;
}

export function createBatch(input: {
  name: string;
  eggCount: number;
  startDate: string;
  incubationDays?: number;
  notes?: string;
}): IncubationBatch {
  return {
    id: `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: input.name.trim() || "Unnamed batch",
    eggCount: Math.max(0, Math.floor(input.eggCount)),
    startDate: input.startDate,
    incubationDays: input.incubationDays ?? DEFAULT_INCUBATION_DAYS,
    status: "incubating",
    notes: input.notes?.trim() ?? "",
    candlingNotes: "",
    removedEggs: 0,
    hatchedCount: null,
    hatchedAt: null,
    createdAt: new Date().toISOString(),
  };
}

/** Calendar-day difference in local time (start of day). */
export function daysBetween(startIsoDate: string, end: Date = new Date()): number {
  const [y, m, d] = startIsoDate.split("-").map(Number);
  const start = new Date(y, m - 1, d);
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  const ms = endDay.getTime() - start.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

/** Day number of incubation (day 1 = start date). Clamped at 0 if start is in the future. */
export function getCurrentDay(batch: IncubationBatch, now: Date = new Date()): number {
  const elapsed = daysBetween(batch.startDate, now);
  return Math.max(0, elapsed + 1);
}

export function getEggsStillIn(batch: IncubationBatch): number {
  return Math.max(0, batch.eggCount - batch.removedEggs);
}

export function getExpectedHatchDate(batch: IncubationBatch): string {
  const [y, m, d] = batch.startDate.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + batch.incubationDays - 1);
  return date.toISOString().slice(0, 10);
}

export function getProgressPercent(batch: IncubationBatch, now: Date = new Date()): number {
  if (batch.status !== "incubating") {
    return batch.status === "hatched" ? 100 : 0;
  }
  const day = getCurrentDay(batch, now);
  return Math.min(100, Math.round((day / batch.incubationDays) * 100));
}

export function isDueOrOverdue(batch: IncubationBatch, now: Date = new Date()): boolean {
  if (batch.status !== "incubating") return false;
  return getCurrentDay(batch, now) >= batch.incubationDays;
}

export function hatchBatch(batch: IncubationBatch, result: HatchResult): IncubationBatch {
  const remaining = getEggsStillIn(batch);
  const hatched = Math.min(remaining, Math.max(0, Math.floor(result.hatchedCount)));
  return {
    ...batch,
    status: "hatched",
    hatchedCount: hatched,
    hatchedAt: new Date().toISOString(),
    notes: result.notes?.trim()
      ? [batch.notes, result.notes.trim()].filter(Boolean).join("\n")
      : batch.notes,
  };
}

export function discardBatch(batch: IncubationBatch, reason?: string): IncubationBatch {
  return {
    ...batch,
    status: "discarded",
    hatchedCount: 0,
    hatchedAt: new Date().toISOString(),
    notes: reason?.trim()
      ? [batch.notes, `Discarded: ${reason.trim()}`].filter(Boolean).join("\n")
      : batch.notes,
  };
}

export function loadBatches(): IncubationBatch[] {
  return loadJson<IncubationBatch[]>(INCUBATION_STORAGE_KEY, []);
}

export function saveBatches(batches: IncubationBatch[]): void {
  saveJson(INCUBATION_STORAGE_KEY, batches);
}

export function getActiveStats(batches: IncubationBatch[], now: Date = new Date()) {
  const active = batches.filter((b) => b.status === "incubating");
  const eggsIncubating = active.reduce((sum, b) => sum + getEggsStillIn(b), 0);
  const dueSoon = active.filter((b) => {
    const day = getCurrentDay(b, now);
    return day >= b.incubationDays - 3;
  });
  const earliest = active
    .map((b) => ({ batch: b, day: getCurrentDay(b, now) }))
    .sort((a, b) => b.day - a.day)[0];

  return {
    activeCount: active.length,
    eggsIncubating,
    dueSoonCount: dueSoon.length,
    leadBatch: earliest?.batch ?? null,
    leadDay: earliest?.day ?? null,
  };
}

export function formatDateKe(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-KE", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function todayIsoDate(): string {
  const n = new Date();
  const y = n.getFullYear();
  const m = String(n.getMonth() + 1).padStart(2, "0");
  const d = String(n.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
