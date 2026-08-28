/**
 * Multi-page branded KukuConnect sales report (same styling as receipt).
 * WinAnsi-safe text so PDFs always generate and print.
 */
import { PDFDocument, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import {
  BRAND_CONTACT,
  COLORS,
  PAGE,
  downloadPdfBytes,
  embedLogo,
  formatKSh,
  loadPublicLogoBytes,
  loadReceiptFonts,
  pdfSafeText,
  type BrandFonts,
} from "./brand";
import type { Sale } from "./sales";
import { formatMonthLabel, sumSales } from "./sales";
import { ITEM_IDS } from "./inventory";

const ROWS_PER_PAGE = 22;
const MARGIN_X = 40;
const LOGO_SIZE = 56;

export interface SalesReportRow {
  date: string;
  receiptNumber: string;
  customer: string;
  item: string;
  amount: number;
}

export interface SalesReportSummary {
  totalRevenue: number;
  totalOrders: number;
  birdsSold: number;
  eggsSold: number;
}

export interface SalesReportInput {
  periodLabel?: string;
  generatedFor?: string;
  summary?: Partial<SalesReportSummary>;
  sales?: SalesReportRow[];
  logoBytes?: ArrayBuffer | Uint8Array | null;
}

export async function generateSalesReport(
  data: SalesReportInput
): Promise<Uint8Array> {
  const {
    periodLabel = "This Month",
    generatedFor = "KukuConnect Farm",
    summary = {},
    sales = [],
    logoBytes = null,
  } = data;

  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(pdfSafeText(`KukuConnect Sales Report - ${periodLabel}`));
  pdfDoc.setProducer("KukuConnect");
  pdfDoc.setCreator("KukuConnect FMS");

  const fonts = await loadReceiptFonts(pdfDoc);

  let logoImage = null;
  if (logoBytes) {
    logoImage = await embedLogo(pdfDoc, logoBytes);
  }

  const safeRows = sales.map((r) => ({
    date: r.date,
    receiptNumber: pdfSafeText(r.receiptNumber || "-"),
    customer: pdfSafeText(r.customer || "Walk-in"),
    item: pdfSafeText(r.item || "-"),
    amount: Number(r.amount) || 0,
  }));

  const chunks = chunk(safeRows, ROWS_PER_PAGE);
  const pageCount = Math.max(chunks.length, 1);

  for (let i = 0; i < pageCount; i++) {
    const page = pdfDoc.addPage([PAGE.width, PAGE.height]);
    const { width } = page.getSize();
    const centerX = width / 2;
    let y = PAGE.height - 40;

    if (logoImage) {
      const dims = logoImage.scale(1);
      const scale = Math.min(LOGO_SIZE / dims.width, LOGO_SIZE / dims.height, 1);
      const w = dims.width * scale;
      const h = dims.height * scale;
      page.drawImage(logoImage, {
        x: centerX - w / 2,
        y: y - h,
        width: w,
        height: h,
      });
      y -= h + 10;
    } else {
      drawCentered(page, "KukuConnect", {
        y,
        size: 16,
        font: fonts.bold,
        color: COLORS.charcoal,
      });
      y -= 20;
    }

    drawDashedRule(page, y, width, COLORS.yellow);
    y -= 18;

    drawCentered(page, "SALES REPORT", {
      y,
      size: 13,
      font: fonts.bold,
      color: COLORS.charcoal,
    });
    y -= 14;
    drawCentered(
      page,
      pdfSafeText(`${periodLabel} - ${generatedFor}`),
      {
        y,
        size: 9,
        font: fonts.oblique,
        color: COLORS.orange,
      }
    );
    y -= 18;

    drawDashedRule(page, y, width, COLORS.fence);
    y -= 18;

    if (i === 0) {
      y = drawSummaryRow(page, { fonts, y, summary, width });
      y -= 6;
      drawDashedRule(page, y, width, COLORS.fence);
      y -= 16;
    } else {
      drawCentered(page, `(continued - page ${i + 1})`, {
        y,
        size: 8,
        font: fonts.regular,
        color: COLORS.slate,
      });
      y -= 14;
    }

    y = drawTableHeader(page, { fonts, y, width });

    const rows = chunks[i] || [];
    if (rows.length === 0 && i === 0) {
      page.drawText("No sales in this period.", {
        x: MARGIN_X,
        y,
        size: 10,
        font: fonts.regular,
        color: COLORS.slate,
      });
    }
    for (const row of rows) {
      y = drawTableRow(page, { fonts, y, width, row });
    }

    drawFooter(page, {
      fonts,
      pageNumber: i + 1,
      pageCount,
      width,
    });
  }

  return pdfDoc.save();
}

// ---- section builders ---------------------------------------------------

function drawSummaryRow(
  page: PDFPage,
  opts: {
    fonts: BrandFonts;
    y: number;
    summary: Partial<SalesReportSummary>;
    width: number;
  }
) {
  const { fonts, y, summary, width } = opts;
  const cards = [
    {
      label: "REVENUE",
      value: formatKSh(summary.totalRevenue || 0),
      color: COLORS.green,
    },
    {
      label: "ORDERS",
      value: String(summary.totalOrders ?? 0),
      color: COLORS.charcoal,
    },
    {
      label: "BIRDS SOLD",
      value: String(summary.birdsSold ?? 0),
      color: COLORS.orange,
    },
    {
      label: "EGGS SOLD",
      value: String(summary.eggsSold ?? 0),
      color: COLORS.red,
    },
  ];

  const colWidth = (width - MARGIN_X * 2) / cards.length;

  cards.forEach((card, i) => {
    const x = MARGIN_X + i * colWidth;
    page.drawText(card.label, {
      x,
      y,
      size: 8,
      font: fonts.regular,
      color: COLORS.slate,
    });
    // Fit long KSh values into column
    let size = 11;
    let value = card.value;
    while (
      size > 8 &&
      fonts.bold.widthOfTextAtSize(value, size) > colWidth - 6
    ) {
      size -= 0.5;
    }
    page.drawText(value, {
      x,
      y: y - 16,
      size,
      font: fonts.bold,
      color: card.color,
    });
  });

  return y - 32;
}

function drawTableHeader(
  page: PDFPage,
  opts: { fonts: BrandFonts; y: number; width: number }
) {
  const { fonts, width } = opts;
  let { y } = opts;
  const cols = getColumns(width);
  page.drawText("DATE", {
    x: cols.date,
    y,
    size: 8,
    font: fonts.bold,
    color: COLORS.charcoal,
  });
  page.drawText("RECEIPT", {
    x: cols.receipt,
    y,
    size: 8,
    font: fonts.bold,
    color: COLORS.charcoal,
  });
  page.drawText("CUSTOMER", {
    x: cols.customer,
    y,
    size: 8,
    font: fonts.bold,
    color: COLORS.charcoal,
  });
  page.drawText("ITEM", {
    x: cols.item,
    y,
    size: 8,
    font: fonts.bold,
    color: COLORS.charcoal,
  });
  const amountLabel = "AMOUNT";
  const amountWidth = fonts.bold.widthOfTextAtSize(amountLabel, 8);
  page.drawText(amountLabel, {
    x: width - MARGIN_X - amountWidth,
    y,
    size: 8,
    font: fonts.bold,
    color: COLORS.charcoal,
  });
  y -= 8;
  drawDashedRule(page, y, width, COLORS.fence);
  return y - 12;
}

function drawTableRow(
  page: PDFPage,
  opts: {
    fonts: BrandFonts;
    y: number;
    width: number;
    row: SalesReportRow;
  }
) {
  const { fonts, width, row } = opts;
  const y = opts.y;
  const cols = getColumns(width);
  const d = new Date(row.date);
  const dateStr = Number.isNaN(d.getTime())
    ? "-"
    : d.toLocaleDateString("en-KE", {
        month: "short",
        day: "numeric",
      });

  page.drawText(pdfSafeText(dateStr), {
    x: cols.date,
    y,
    size: 8.5,
    font: fonts.regular,
    color: COLORS.charcoal,
  });
  page.drawText(truncate(row.receiptNumber || "-", 12), {
    x: cols.receipt,
    y,
    size: 8.5,
    font: fonts.regular,
    color: COLORS.slate,
  });
  page.drawText(truncate(row.customer, 16), {
    x: cols.customer,
    y,
    size: 8.5,
    font: fonts.regular,
    color: COLORS.charcoal,
  });
  page.drawText(truncate(row.item, 18), {
    x: cols.item,
    y,
    size: 8.5,
    font: fonts.regular,
    color: COLORS.charcoal,
  });

  const amountStr = formatKSh(row.amount);
  const amountWidth = fonts.bold.widthOfTextAtSize(amountStr, 8.5);
  page.drawText(amountStr, {
    x: width - MARGIN_X - amountWidth,
    y,
    size: 8.5,
    font: fonts.bold,
    color: COLORS.green,
  });

  return y - 16;
}

function drawFooter(
  page: PDFPage,
  opts: {
    fonts: BrandFonts;
    pageNumber: number;
    pageCount: number;
    width: number;
  }
) {
  const { fonts, pageNumber, pageCount, width } = opts;
  const y = 32;
  drawDashedRule(page, y + 14, width, COLORS.fence);
  page.drawText(pdfSafeText(BRAND_CONTACT), {
    x: MARGIN_X,
    y,
    size: 7.5,
    font: fonts.regular,
    color: COLORS.slate,
  });
  const pageLabel = `Page ${pageNumber} of ${pageCount}`;
  const labelWidth = fonts.regular.widthOfTextAtSize(pageLabel, 7.5);
  page.drawText(pageLabel, {
    x: width - MARGIN_X - labelWidth,
    y,
    size: 7.5,
    font: fonts.regular,
    color: COLORS.slate,
  });
}

// ---- helpers --------------------------------------------------------------

function drawCentered(
  page: PDFPage,
  text: string,
  opts: { y: number; size: number; font: PDFFont; color: RGB }
) {
  const { y, size, font, color } = opts;
  const { width } = page.getSize();
  const display = pdfSafeText(text);
  const w = font.widthOfTextAtSize(display, size);
  page.drawText(display, { x: width / 2 - w / 2, y, size, font, color });
}

function drawDashedRule(
  page: PDFPage,
  y: number,
  pageWidth: number,
  color: RGB
) {
  page.drawLine({
    start: { x: MARGIN_X, y },
    end: { x: pageWidth - MARGIN_X, y },
    thickness: 1,
    color,
    dashArray: [3, 3],
  });
}

function getColumns(pageWidth: number) {
  // Spread columns across usable width
  const usable = pageWidth - MARGIN_X * 2;
  return {
    date: MARGIN_X,
    receipt: MARGIN_X + usable * 0.14,
    customer: MARGIN_X + usable * 0.34,
    item: MARGIN_X + usable * 0.56,
  };
}

function truncate(str = "", max: number) {
  const s = pdfSafeText(str);
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Build report rows from Sale records (one row per line item). */
export function salesToReportRows(sales: Sale[]): SalesReportRow[] {
  const rows: SalesReportRow[] = [];
  for (const sale of sales) {
    const receipt =
      sale.receiptNumber ||
      `KC-RCT-${sale.id.replace(/\D/g, "").slice(-5).padStart(5, "0")}`;
    if (!sale.items || sale.items.length === 0) {
      rows.push({
        date: sale.createdAt,
        receiptNumber: receipt,
        customer: sale.customer || "Walk-in",
        item: "-",
        amount: sale.total,
      });
      continue;
    }
    for (const line of sale.items) {
      rows.push({
        date: sale.createdAt,
        receiptNumber: receipt,
        customer: sale.customer || "Walk-in",
        item: `${line.name} x${line.qty}`,
        amount: line.qty * line.price,
      });
    }
  }
  return rows;
}

export function summarizeSales(sales: Sale[]): SalesReportSummary {
  let birdsSold = 0;
  let eggsSold = 0;
  for (const sale of sales) {
    for (const line of sale.items || []) {
      if (line.itemId === ITEM_IDS.trayEggs || /egg/i.test(line.name)) {
        eggsSold += line.qty;
      } else if (line.itemId !== ITEM_IDS.hatchingEggs) {
        birdsSold += line.qty;
      }
    }
  }
  return {
    totalRevenue: sumSales(sales),
    totalOrders: sales.length,
    birdsSold,
    eggsSold,
  };
}

/** Download a sales report PDF for the given month of sales. */
export async function downloadSalesReportPdf(opts: {
  sales: Sale[];
  monthKey: string;
  generatedFor?: string;
}): Promise<void> {
  try {
    const logoBytes = await loadPublicLogoBytes();
    const periodLabel = formatMonthLabel(opts.monthKey);
    const rows = salesToReportRows(opts.sales);
    const summary = summarizeSales(opts.sales);
    const bytes = await generateSalesReport({
      periodLabel,
      generatedFor: opts.generatedFor ?? "KukuConnect · Kitui",
      summary,
      sales: rows,
      logoBytes,
    });
    const safe = periodLabel.replace(/\s+/g, "-");
    downloadPdfBytes(bytes, `KukuConnect-Sales-Report-${safe}.pdf`);
  } catch (err) {
    console.error("Sales report PDF failed", err);
    throw new Error(
      err instanceof Error
        ? `Could not create sales report: ${err.message}`
        : "Could not create sales report"
    );
  }
}
