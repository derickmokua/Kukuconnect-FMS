/**
 * Multi-page branded KukuConnect sales report (same slip styling as receipt).
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
  type BrandFonts,
} from "./brand";
import type { Sale } from "./sales";
import { formatMonthLabel, sumSales } from "./sales";
import { ITEM_IDS } from "./inventory";

const ROWS_PER_PAGE = 26;
const MARGIN_X = 60;

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
  pdfDoc.setTitle(`KukuConnect Sales Report - ${periodLabel}`);
  pdfDoc.setProducer("KukuConnect");

  const fonts = await loadReceiptFonts(pdfDoc);

  let logoImage = null;
  if (logoBytes) {
    logoImage = await embedLogo(pdfDoc, logoBytes);
  }

  const chunks = chunk(sales, ROWS_PER_PAGE);
  const pageCount = Math.max(chunks.length, 1);

  for (let i = 0; i < pageCount; i++) {
    const page = pdfDoc.addPage([PAGE.width, PAGE.height]);
    const { width } = page.getSize();
    const centerX = width / 2;
    let y = PAGE.height - 56;

    if (logoImage) {
      const logoSize = 110;
      page.drawImage(logoImage, {
        x: centerX - logoSize / 2,
        y: y - logoSize,
        width: logoSize,
        height: logoSize,
      });
      y -= logoSize + 12;
    } else {
      drawCentered(page, "KukuConnect", {
        y,
        size: 14,
        font: fonts.bold,
        color: COLORS.charcoal,
      });
      y -= 20;
    }

    drawDashedRule(page, y, width, COLORS.yellow);
    y -= 22;

    drawCentered(page, "SALES REPORT", {
      y,
      size: 13,
      font: fonts.bold,
      color: COLORS.charcoal,
    });
    y -= 16;
    drawCentered(page, `${periodLabel}  -  ${generatedFor}`, {
      y,
      size: 9,
      font: fonts.oblique,
      color: COLORS.orange,
    });
    y -= 20;

    drawDashedRule(page, y, width, COLORS.fence);
    y -= 22;

    if (i === 0) {
      y = drawSummaryRow(page, { fonts, y, summary, width });
      y -= 6;
      drawDashedRule(page, y, width, COLORS.fence);
      y -= 20;
    }

    y = drawTableHeader(page, { fonts, y, width });

    const rows = chunks[i] || [];
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
    page.drawText(card.value, {
      x,
      y: y - 18,
      size: 13,
      font: fonts.bold,
      color: card.color,
    });
  });

  return y - 34;
}

function drawTableHeader(
  page: PDFPage,
  opts: { fonts: BrandFonts; y: number; width: number }
) {
  const { fonts, width } = opts;
  let { y } = opts;
  const cols = getColumns();
  page.drawText("DATE", {
    x: cols.date,
    y,
    size: 8.5,
    font: fonts.bold,
    color: COLORS.charcoal,
  });
  page.drawText("RECEIPT #", {
    x: cols.receipt,
    y,
    size: 8.5,
    font: fonts.bold,
    color: COLORS.charcoal,
  });
  page.drawText("CUSTOMER", {
    x: cols.customer,
    y,
    size: 8.5,
    font: fonts.bold,
    color: COLORS.charcoal,
  });
  page.drawText("ITEM", {
    x: cols.item,
    y,
    size: 8.5,
    font: fonts.bold,
    color: COLORS.charcoal,
  });
  const amountLabel = "AMOUNT";
  const amountWidth = fonts.bold.widthOfTextAtSize(amountLabel, 8.5);
  page.drawText(amountLabel, {
    x: width - MARGIN_X - amountWidth,
    y,
    size: 8.5,
    font: fonts.bold,
    color: COLORS.charcoal,
  });
  y -= 10;
  drawDashedRule(page, y, width, COLORS.fence);
  return y - 14;
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
  const cols = getColumns();
  const dateStr = new Date(row.date).toLocaleDateString("en-KE", {
    month: "short",
    day: "numeric",
  });

  page.drawText(dateStr, {
    x: cols.date,
    y,
    size: 9,
    font: fonts.regular,
    color: COLORS.charcoal,
  });
  page.drawText(row.receiptNumber || "-", {
    x: cols.receipt,
    y,
    size: 9,
    font: fonts.regular,
    color: COLORS.slate,
  });
  page.drawText(truncate(row.customer, 18), {
    x: cols.customer,
    y,
    size: 9,
    font: fonts.regular,
    color: COLORS.charcoal,
  });
  page.drawText(truncate(row.item, 20), {
    x: cols.item,
    y,
    size: 9,
    font: fonts.regular,
    color: COLORS.charcoal,
  });

  const amountStr = formatKSh(row.amount);
  const amountWidth = fonts.bold.widthOfTextAtSize(amountStr, 9);
  page.drawText(amountStr, {
    x: width - MARGIN_X - amountWidth,
    y,
    size: 9,
    font: fonts.bold,
    color: COLORS.green,
  });

  return y - 18;
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
  const y = 40;
  drawDashedRule(page, y + 16, width, COLORS.fence);
  page.drawText(BRAND_CONTACT, {
    x: MARGIN_X,
    y,
    size: 8,
    font: fonts.regular,
    color: COLORS.slate,
  });
  const pageLabel = `Page ${pageNumber} of ${pageCount}`;
  const labelWidth = fonts.regular.widthOfTextAtSize(pageLabel, 8);
  page.drawText(pageLabel, {
    x: width - MARGIN_X - labelWidth,
    y,
    size: 8,
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
  const w = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: width / 2 - w / 2, y, size, font, color });
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

function getColumns() {
  return {
    date: MARGIN_X,
    receipt: MARGIN_X + 60,
    customer: MARGIN_X + 165,
    item: MARGIN_X + 290,
  };
}

function truncate(str = "", max: number) {
  return str.length > max ? `${str.slice(0, max - 1)}...` : str;
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
    if (sale.items.length === 0) {
      rows.push({
        date: sale.createdAt,
        receiptNumber: receipt,
        customer: sale.customer || "Walk-in",
        item: "—",
        amount: sale.total,
      });
      continue;
    }
    for (const line of sale.items) {
      rows.push({
        date: sale.createdAt,
        receiptNumber: receipt,
        customer: sale.customer || "Walk-in",
        item: line.name,
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
    for (const line of sale.items) {
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
}
