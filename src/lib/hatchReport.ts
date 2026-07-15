/**
 * Hatch performance: rates from eggs set → chicks hatched, plus PDF report.
 */
import { PDFDocument, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import {
  COLORS,
  PAGE,
  downloadPdfBytes,
  embedLogo,
  loadPublicLogoBytes,
  loadReceiptFonts,
} from "./brand";
import {
  type IncubationBatch,
  formatDateKe,
  getCurrentDay,
  getEggsStillIn,
} from "./incubation";

/** Per-batch hatch metrics (for completed or in-progress display). */
export interface BatchHatchMetrics {
  batchId: string;
  name: string;
  status: IncubationBatch["status"];
  startDate: string;
  hatchedAt: string | null;
  eggsSet: number;
  removedEggs: number;
  eggsToHatch: number;
  chicksHatched: number;
  unhatched: number;
  /** Chicks / eggs set × 100 */
  hatchRateOfSet: number | null;
  /** Chicks / eggs remaining after candling × 100 */
  hatchRateOfFertile: number | null;
  /** Removed at candling / eggs set × 100 */
  candlingLossPct: number | null;
}

export interface HatchReportSummary {
  /** All batches in period (incubating + completed), by filter basis */
  batchesInPeriod: number;
  batchesIncubating: number;
  batchesCompleted: number;
  /** Eggs set on every batch in the period (including incubating) */
  eggsSetInPeriod: number;
  /** Eggs set on completed hatches only (hatch-rate denominator) */
  eggsSetCompleted: number;
  removedEggs: number;
  eggsToHatch: number;
  chicksHatched: number;
  unhatched: number;
  /** Overall: total chicks / eggs set on completed batches */
  hatchRateOfSet: number | null;
  /** Overall: total chicks / eggs left after candling */
  hatchRateOfFertile: number | null;
  bestBatchName: string | null;
  bestBatchRate: number | null;
  worstBatchName: string | null;
  worstBatchRate: number | null;
}

export interface HatchReport {
  periodLabel: string;
  periodKey: string;
  basis: PeriodBasis;
  basisLabel: string;
  generatedAt: string;
  rows: BatchHatchMetrics[];
  summary: HatchReportSummary;
  /** Batches still incubating in this period (not in hatch-rate until completed). */
  inProgress: {
    count: number;
    eggsSet: number;
    eggsStillIn: number;
    batches: { name: string; eggsSet: number; dayLabel: string; startDate: string }[];
  };
}

/** "all" | "2026" (year) | "2026-07" (month) */
export type PeriodKey = string;
/** Which date assigns a batch to a month/year */
export type PeriodBasis = "start" | "hatch";

export interface HatchReportOptions {
  /** all | YYYY | YYYY-MM */
  period?: PeriodKey;
  /** Count by set date (default) or hatch completion date */
  basis?: PeriodBasis;
}

function pct(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

export function formatHatchRate(rate: number | null): string {
  if (rate == null) return "—";
  return `${rate.toFixed(1)}%`;
}

/** Metrics for one batch. In-progress uses hatchedCount if any (usually null). */
export function batchHatchMetrics(batch: IncubationBatch): BatchHatchMetrics {
  const eggsSet = Math.max(0, batch.eggCount);
  const removedEggs = Math.max(0, batch.removedEggs);
  const eggsToHatch = getEggsStillIn(batch);
  const chicksHatched =
    batch.status === "hatched" || batch.status === "discarded"
      ? Math.max(0, batch.hatchedCount ?? 0)
      : Math.max(0, batch.hatchedCount ?? 0);

  const unhatched =
    batch.status === "hatched" || batch.status === "discarded"
      ? Math.max(0, eggsToHatch - chicksHatched)
      : 0;

  return {
    batchId: batch.id,
    name: batch.name,
    status: batch.status,
    startDate: batch.startDate,
    hatchedAt: batch.hatchedAt,
    eggsSet,
    removedEggs,
    eggsToHatch,
    chicksHatched,
    unhatched,
    hatchRateOfSet:
      batch.status === "hatched" || batch.status === "discarded"
        ? pct(chicksHatched, eggsSet)
        : null,
    hatchRateOfFertile:
      batch.status === "hatched" || batch.status === "discarded"
        ? pct(chicksHatched, eggsToHatch)
        : null,
    candlingLossPct: pct(removedEggs, eggsSet),
  };
}

export function hatchedBatches(batches: IncubationBatch[]): IncubationBatch[] {
  return batches.filter(
    (b) => b.status === "hatched" || b.status === "discarded"
  );
}

/** Date used to place a batch in a month/year bucket. */
export function batchPeriodDate(
  batch: IncubationBatch,
  basis: PeriodBasis
): string {
  if (basis === "hatch") {
    return (batch.hatchedAt?.slice(0, 10) || batch.startDate).slice(0, 10);
  }
  return batch.startDate.slice(0, 10);
}

/** period: "all" | "2026" | "2026-07" */
export function matchesPeriod(isoDate: string, period: PeriodKey): boolean {
  if (!period || period === "all") return true;
  const d = isoDate.slice(0, 10);
  if (/^\d{4}$/.test(period)) return d.startsWith(period);
  if (/^\d{4}-\d{2}$/.test(period)) return d.startsWith(period);
  return d.startsWith(period);
}

export function filterBatchesByPeriod(
  batches: IncubationBatch[],
  period: PeriodKey,
  basis: PeriodBasis = "start"
): IncubationBatch[] {
  if (period === "all") return batches;
  return batches.filter((b) =>
    matchesPeriod(batchPeriodDate(b, basis), period)
  );
}

/** @deprecated use filterBatchesByPeriod */
export function filterHatchesByMonth(
  batches: IncubationBatch[],
  monthKey: string | "all"
): IncubationBatch[] {
  return filterBatchesByPeriod(hatchedBatches(batches), monthKey, "hatch");
}

export function availableHatchMonths(batches: IncubationBatch[]): string[] {
  const keys = new Set<string>();
  for (const b of batches) {
    keys.add(batchPeriodDate(b, "start").slice(0, 7));
    if (b.hatchedAt) keys.add(b.hatchedAt.slice(0, 7));
  }
  return [...keys].sort((a, b) => b.localeCompare(a));
}

/** Years present in data, plus current year if empty. */
export function availableYears(batches: IncubationBatch[]): number[] {
  const years = new Set<number>();
  const current = new Date().getFullYear();
  years.add(current);
  for (const b of batches) {
    const y1 = Number(b.startDate.slice(0, 4));
    if (y1) years.add(y1);
    if (b.hatchedAt) {
      const y2 = Number(b.hatchedAt.slice(0, 4));
      if (y2) years.add(y2);
    }
  }
  // allow previous year for reports
  years.add(current - 1);
  years.add(current + 1);
  return [...years].sort((a, b) => b - a);
}

export const MONTH_OPTIONS: { value: string; label: string }[] = [
  { value: "01", label: "January" },
  { value: "02", label: "February" },
  { value: "03", label: "March" },
  { value: "04", label: "April" },
  { value: "05", label: "May" },
  { value: "06", label: "June" },
  { value: "07", label: "July" },
  { value: "08", label: "August" },
  { value: "09", label: "September" },
  { value: "10", label: "October" },
  { value: "11", label: "November" },
  { value: "12", label: "December" },
];

export function monthLabel(monthKey: string): string {
  if (monthKey === "all") return "All time";
  if (/^\d{4}$/.test(monthKey)) return monthKey;
  const [y, m] = monthKey.split("-").map(Number);
  if (!y || !m) return monthKey;
  return new Date(y, m - 1, 1).toLocaleDateString("en-KE", {
    month: "long",
    year: "numeric",
  });
}

export function basisLabel(basis: PeriodBasis): string {
  return basis === "hatch"
    ? "By hatch date"
    : "By set date (when batch started)";
}

/** Build period key from UI: all | year only | year-month */
export function makePeriodKey(
  mode: "all" | "year" | "month",
  year: number,
  month: string
): PeriodKey {
  if (mode === "all") return "all";
  if (mode === "year") return String(year);
  return `${year}-${month.padStart(2, "0")}`;
}

export function buildHatchReport(
  batches: IncubationBatch[],
  periodOrOptions: PeriodKey | HatchReportOptions = "all"
): HatchReport {
  const opts: HatchReportOptions =
    typeof periodOrOptions === "string"
      ? { period: periodOrOptions, basis: "start" }
      : periodOrOptions;
  const period = opts.period ?? "all";
  const basis = opts.basis ?? "start";

  const inPeriod = filterBatchesByPeriod(batches, period, basis);
  const completed = inPeriod.filter(
    (b) => b.status === "hatched" || b.status === "discarded"
  );
  const incubating = inPeriod.filter((b) => b.status === "incubating");

  const rows = completed
    .map(batchHatchMetrics)
    .sort((a, b) => {
      const da = a.hatchedAt ?? a.startDate;
      const db = b.hatchedAt ?? b.startDate;
      return db.localeCompare(da);
    });

  const eggsSet = rows.reduce((s, r) => s + r.eggsSet, 0);
  const removedEggs = rows.reduce((s, r) => s + r.removedEggs, 0);
  const eggsToHatch = rows.reduce((s, r) => s + r.eggsToHatch, 0);
  const chicksHatched = rows.reduce((s, r) => s + r.chicksHatched, 0);
  const unhatched = rows.reduce((s, r) => s + r.unhatched, 0);

  const eggsSetInPeriod = inPeriod.reduce((s, b) => s + b.eggCount, 0);

  const withRate = rows.filter(
    (r) => r.status === "hatched" && r.hatchRateOfSet != null && r.eggsSet > 0
  );
  let best: BatchHatchMetrics | null = null;
  let worst: BatchHatchMetrics | null = null;
  for (const r of withRate) {
    if (!best || (r.hatchRateOfSet ?? 0) > (best.hatchRateOfSet ?? 0)) best = r;
    if (!worst || (r.hatchRateOfSet ?? 0) < (worst.hatchRateOfSet ?? 0))
      worst = r;
  }

  const inProgress = {
    count: incubating.length,
    eggsSet: incubating.reduce((s, b) => s + b.eggCount, 0),
    eggsStillIn: incubating.reduce((s, b) => s + getEggsStillIn(b), 0),
    batches: incubating.map((b) => ({
      name: b.name,
      eggsSet: b.eggCount,
      dayLabel: `Day ${Math.min(getCurrentDay(b), b.incubationDays)}/${b.incubationDays}`,
      startDate: b.startDate,
    })),
  };

  return {
    periodLabel: monthLabel(period),
    periodKey: period,
    basis,
    basisLabel: basisLabel(basis),
    generatedAt: new Date().toISOString(),
    rows,
    summary: {
      batchesInPeriod: inPeriod.length,
      batchesIncubating: incubating.length,
      batchesCompleted: rows.length,
      eggsSetInPeriod,
      eggsSetCompleted: eggsSet,
      removedEggs,
      eggsToHatch,
      chicksHatched,
      unhatched,
      hatchRateOfSet: pct(chicksHatched, eggsSet),
      hatchRateOfFertile: pct(chicksHatched, eggsToHatch),
      bestBatchName: best?.name ?? null,
      bestBatchRate: best?.hatchRateOfSet ?? null,
      worstBatchName: worst?.name ?? null,
      worstBatchRate: worst?.hatchRateOfSet ?? null,
    },
    inProgress,
  };
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

const MARGIN_X = 48;
const ROWS_PER_PAGE = 18;

function drawCentered(
  page: PDFPage,
  text: string,
  opts: { y: number; size: number; font: PDFFont; color: RGB }
) {
  const { width } = page.getSize();
  const w = opts.font.widthOfTextAtSize(text, opts.size);
  page.drawText(text, {
    x: (width - w) / 2,
    y: opts.y,
    size: opts.size,
    font: opts.font,
    color: opts.color,
  });
}

function drawDashedRule(
  page: PDFPage,
  y: number,
  width: number,
  color: RGB
) {
  const start = MARGIN_X;
  const end = width - MARGIN_X;
  const dash = 4;
  const gap = 3;
  let x = start;
  while (x < end) {
    const x2 = Math.min(x + dash, end);
    page.drawLine({
      start: { x, y },
      end: { x: x2, y },
      thickness: 1,
      color,
    });
    x = x2 + gap;
  }
}

export async function generateHatchReportPdf(
  report: HatchReport,
  logoBytes?: ArrayBuffer | Uint8Array | null
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(`KukuConnect Hatch Report - ${report.periodLabel}`);
  pdfDoc.setProducer("KukuConnect");
  const fonts = await loadReceiptFonts(pdfDoc);

  let logoImage = null;
  if (logoBytes) {
    logoImage = await embedLogo(pdfDoc, logoBytes);
  } else {
    try {
      const bytes = await loadPublicLogoBytes();
      if (bytes) logoImage = await embedLogo(pdfDoc, bytes);
    } catch {
      /* optional */
    }
  }

  const chunks =
    report.rows.length === 0
      ? [[] as BatchHatchMetrics[]]
      : chunk(report.rows, ROWS_PER_PAGE);
  const pageCount = chunks.length;

  for (let i = 0; i < pageCount; i++) {
    const page = pdfDoc.addPage([PAGE.width, PAGE.height]);
    const { width } = page.getSize();
    let y = PAGE.height - 48;

    if (i === 0) {
      if (logoImage) {
        const logoSize = 72;
        page.drawImage(logoImage, {
          x: width / 2 - logoSize / 2,
          y: y - logoSize,
          width: logoSize,
          height: logoSize,
        });
        y -= logoSize + 10;
      }
      drawCentered(page, "KukuConnect", {
        y,
        size: 14,
        font: fonts.bold,
        color: COLORS.charcoal,
      });
      y -= 18;
      drawCentered(page, "HATCHING REPORT", {
        y,
        size: 16,
        font: fonts.bold,
        color: COLORS.charcoal,
      });
      y -= 16;
      drawCentered(page, report.periodLabel, {
        y,
        size: 11,
        font: fonts.regular,
        color: COLORS.slate,
      });
      y -= 14;
      drawDashedRule(page, y, width, COLORS.yellow);
      y -= 22;

      const s = report.summary;
      const lines = [
        `Period: ${report.periodLabel} · ${report.basisLabel}`,
        `Batches in period: ${s.batchesInPeriod} (incubating ${s.batchesIncubating}, completed ${s.batchesCompleted})`,
        `Eggs set (all in period): ${s.eggsSetInPeriod.toLocaleString()}  ·  Eggs on completed: ${s.eggsSetCompleted.toLocaleString()}`,
        `Candled out: ${s.removedEggs.toLocaleString()}  ·  Chicks hatched: ${s.chicksHatched.toLocaleString()}  ·  Unhatched: ${s.unhatched.toLocaleString()}`,
        `Hatch rate (of eggs set): ${formatHatchRate(s.hatchRateOfSet)}`,
        `Hatch rate (of eggs after candling): ${formatHatchRate(s.hatchRateOfFertile)}`,
      ];
      if (s.bestBatchName && s.bestBatchRate != null) {
        lines.push(
          `Best: ${s.bestBatchName} (${formatHatchRate(s.bestBatchRate)})`
        );
      }
      if (
        s.worstBatchName &&
        s.worstBatchRate != null &&
        s.worstBatchName !== s.bestBatchName
      ) {
        lines.push(
          `Lowest: ${s.worstBatchName} (${formatHatchRate(s.worstBatchRate)})`
        );
      }

      for (const line of lines) {
        page.drawText(line, {
          x: MARGIN_X,
          y,
          size: 9,
          font: fonts.regular,
          color: COLORS.charcoal,
        });
        y -= 13;
      }
      y -= 6;
      drawDashedRule(page, y, width, COLORS.slate);
      y -= 18;
    } else {
      page.drawText(`Hatch report · ${report.periodLabel} · p.${i + 1}`, {
        x: MARGIN_X,
        y,
        size: 9,
        font: fonts.regular,
        color: COLORS.slate,
      });
      y -= 20;
    }

    // Table header
    page.drawText("Batch", {
      x: MARGIN_X,
      y,
      size: 8,
      font: fonts.bold,
      color: COLORS.slate,
    });
    page.drawText("Set", {
      x: MARGIN_X + 150,
      y,
      size: 8,
      font: fonts.bold,
      color: COLORS.slate,
    });
    page.drawText("Hatched", {
      x: MARGIN_X + 195,
      y,
      size: 8,
      font: fonts.bold,
      color: COLORS.slate,
    });
    page.drawText("Rate (set)", {
      x: MARGIN_X + 255,
      y,
      size: 8,
      font: fonts.bold,
      color: COLORS.slate,
    });
    page.drawText("Rate (candled)", {
      x: MARGIN_X + 330,
      y,
      size: 8,
      font: fonts.bold,
      color: COLORS.slate,
    });
    page.drawText("Date", {
      x: MARGIN_X + 420,
      y,
      size: 8,
      font: fonts.bold,
      color: COLORS.slate,
    });
    y -= 14;

    if (chunks[i].length === 0) {
      page.drawText("No completed hatches in this period.", {
        x: MARGIN_X,
        y,
        size: 10,
        font: fonts.regular,
        color: COLORS.slate,
      });
    }

    for (const row of chunks[i]) {
      if (y < 60) break;
      const name =
        row.name.length > 22 ? `${row.name.slice(0, 20)}…` : row.name;
      const hatchDate = row.hatchedAt
        ? formatDateKe(row.hatchedAt.slice(0, 10))
        : formatDateKe(row.startDate);

      page.drawText(name, {
        x: MARGIN_X,
        y,
        size: 8,
        font: fonts.regular,
        color: COLORS.charcoal,
      });
      page.drawText(String(row.eggsSet), {
        x: MARGIN_X + 150,
        y,
        size: 8,
        font: fonts.regular,
        color: COLORS.charcoal,
      });
      page.drawText(String(row.chicksHatched), {
        x: MARGIN_X + 195,
        y,
        size: 8,
        font: fonts.regular,
        color: COLORS.charcoal,
      });
      page.drawText(formatHatchRate(row.hatchRateOfSet), {
        x: MARGIN_X + 255,
        y,
        size: 8,
        font: fonts.bold,
        color: COLORS.charcoal,
      });
      page.drawText(formatHatchRate(row.hatchRateOfFertile), {
        x: MARGIN_X + 330,
        y,
        size: 8,
        font: fonts.regular,
        color: COLORS.charcoal,
      });
      page.drawText(hatchDate, {
        x: MARGIN_X + 420,
        y,
        size: 8,
        font: fonts.regular,
        color: COLORS.slate,
      });
      y -= 13;
    }

    page.drawText(
      "Hatch rate (of set) = chicks ÷ eggs set. Rate (candled) = chicks ÷ eggs after removing clears.",
      {
        x: MARGIN_X,
        y: 36,
        size: 7,
        font: fonts.regular,
        color: COLORS.slate,
      }
    );
    page.drawText(`Generated ${new Date(report.generatedAt).toLocaleString("en-KE")}`, {
      x: MARGIN_X,
      y: 24,
      size: 7,
      font: fonts.regular,
      color: COLORS.slate,
    });
  }

  return pdfDoc.save();
}

export async function downloadHatchReport(
  report: HatchReport,
  filename?: string
): Promise<void> {
  const bytes = await generateHatchReportPdf(report);
  const safe = (filename ?? `KukuConnect-Hatch-Report-${report.periodLabel}`)
    .replace(/[^\w\-]+/g, "_")
    .slice(0, 80);
  downloadPdfBytes(bytes, `${safe}.pdf`);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
