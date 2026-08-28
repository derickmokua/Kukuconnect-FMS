/**
 * Single/multi-page branded KukuConnect sales receipt.
 * White background, clean Helvetica type — WinAnsi-safe for reliable printing.
 */
import { PDFDocument, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import {
  BRAND_CONTACT,
  COLORS,
  PAGE,
  PAYMENT_METHODS,
  type PaymentMethod,
  downloadPdfBytes,
  embedLogo,
  formatKSh,
  loadPublicLogoBytes,
  loadReceiptFonts,
  pdfSafeText,
  type BrandFonts,
} from "./brand";
import type { Sale } from "./sales";

export interface ReceiptItem {
  description: string;
  qty: number;
  unitPrice: number;
}

export interface ReceiptInput {
  receiptNumber: string;
  refNumber?: string;
  date?: Date | string;
  customerName?: string;
  customerPhone?: string;
  items?: ReceiptItem[];
  paymentMethod?: PaymentMethod | string;
  mpesaCode?: string;
  servedBy?: string;
  logoBytes?: ArrayBuffer | Uint8Array | null;
}

const MARGIN = 48;
const LOGO_SIZE = 72;
const FOOTER_RESERVE = 72;

export async function generateReceipt(data: ReceiptInput): Promise<Uint8Array> {
  const {
    receiptNumber,
    refNumber,
    date = new Date(),
    customerName = "Walk-in Customer",
    customerPhone = "",
    items = [],
    paymentMethod = "Cash",
    mpesaCode = "",
    servedBy = "",
    logoBytes = null,
  } = data;

  const method = normalizePayment(paymentMethod);

  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(pdfSafeText(`KukuConnect Receipt ${receiptNumber}`));
  pdfDoc.setProducer("KukuConnect");
  pdfDoc.setCreator("KukuConnect FMS");

  const fonts = await loadReceiptFonts(pdfDoc);

  let logoImage = null;
  if (logoBytes) {
    logoImage = await embedLogo(pdfDoc, logoBytes);
  }

  const lines = items.map((item) => ({
    description: pdfSafeText(item.description || "Item"),
    qty: Math.max(0, Number(item.qty) || 0),
    unitPrice: Math.max(0, Number(item.unitPrice) || 0),
    lineTotal: Math.max(0, (Number(item.qty) || 0) * (Number(item.unitPrice) || 0)),
  }));
  const subtotal = lines.reduce((s, it) => s + it.lineTotal, 0);

  let page = pdfDoc.addPage([PAGE.width, PAGE.height]);
  let y = PAGE.height - MARGIN;

  const ensureSpace = (need: number) => {
    if (y - need < FOOTER_RESERVE) {
      drawPageFooter(page, fonts);
      page = pdfDoc.addPage([PAGE.width, PAGE.height]);
      y = PAGE.height - MARGIN;
      y = drawContinuedHeader(page, fonts, y, receiptNumber);
    }
  };

  // ---- Header ----
  if (logoImage) {
    const dims = logoImage.scale(1);
    const scale = Math.min(LOGO_SIZE / dims.width, LOGO_SIZE / dims.height, 1);
    const w = dims.width * scale;
    const h = dims.height * scale;
    page.drawImage(logoImage, {
      x: PAGE.width / 2 - w / 2,
      y: y - h,
      width: w,
      height: h,
    });
    y -= h + 12;
  } else {
    drawCentered(page, "KukuConnect", {
      y,
      size: 18,
      font: fonts.bold,
      color: COLORS.charcoal,
    });
    y -= 24;
  }

  drawDashedRule(page, y, PAGE.width, COLORS.yellow, MARGIN);
  y -= 20;

  drawCentered(page, "RECEIPT", {
    y,
    size: 14,
    font: fonts.bold,
    color: COLORS.charcoal,
  });
  y -= 22;

  const leftX = MARGIN;
  const rightX = PAGE.width - MARGIN;
  const dateObj = safeDate(date);
  const dateStr = dateObj.toLocaleDateString("en-KE", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  y = drawKV(page, fonts, y, leftX, rightX, "Receipt #", pdfSafeText(receiptNumber || "-"));
  if (refNumber) {
    y = drawKV(page, fonts, y, leftX, rightX, "Ref #", pdfSafeText(refNumber));
  }
  y = drawKV(page, fonts, y, leftX, rightX, "Date", pdfSafeText(dateStr));
  y = drawKV(page, fonts, y, leftX, rightX, "Served by", pdfSafeText(servedBy || "-"));
  y = drawKV(page, fonts, y, leftX, rightX, "Customer", pdfSafeText(customerName || "Walk-in Customer"));
  if (customerPhone) {
    y = drawKV(page, fonts, y, leftX, rightX, "Phone", pdfSafeText(customerPhone));
  }

  const paymentValue =
    method === "M-Pesa" && mpesaCode
      ? `M-Pesa (${pdfSafeText(mpesaCode)})`
      : method;
  y = drawKV(page, fonts, y, leftX, rightX, "Payment", paymentValue, {
    valueColor: method === "M-Pesa" ? COLORS.green : COLORS.charcoal,
  });

  y -= 6;
  drawDashedRule(page, y, PAGE.width, COLORS.fence, MARGIN);
  y -= 18;

  drawReceiptRow(page, fonts.bold, y, leftX, rightX, "ITEM", "AMOUNT", COLORS.charcoal);
  y -= 12;
  drawDashedRule(page, y, PAGE.width, COLORS.fence, MARGIN);
  y -= 16;

  if (lines.length === 0) {
    ensureSpace(20);
    drawReceiptRow(page, fonts.regular, y, leftX, rightX, "(No line items)", "", COLORS.slate);
    y -= 18;
  }

  for (const item of lines) {
    ensureSpace(36);
    drawReceiptRow(
      page,
      fonts.regular,
      y,
      leftX,
      rightX,
      truncate(item.description, 40),
      formatKSh(item.lineTotal),
      COLORS.charcoal
    );
    y -= 14;
    drawReceiptRow(
      page,
      fonts.oblique,
      y,
      leftX,
      rightX,
      `  ${item.qty} x ${formatKSh(item.unitPrice)}`,
      "",
      COLORS.slate,
      9
    );
    y -= 18;
  }

  ensureSpace(90);
  drawDashedRule(page, y, PAGE.width, COLORS.fence, MARGIN);
  y -= 20;

  drawReceiptRow(
    page,
    fonts.regular,
    y,
    leftX,
    rightX,
    "Subtotal",
    formatKSh(subtotal),
    COLORS.charcoal
  );
  y -= 18;
  drawReceiptRow(
    page,
    fonts.bold,
    y,
    leftX,
    rightX,
    "TOTAL PAID",
    formatKSh(subtotal),
    COLORS.green,
    13
  );
  y -= 28;

  drawDashedRule(page, y, PAGE.width, COLORS.yellow, MARGIN);
  y -= 24;

  drawCentered(page, "Thank you for farming with KukuConnect!", {
    y,
    size: 10,
    font: fonts.oblique,
    color: COLORS.orange,
  });
  y -= 16;
  drawCentered(page, pdfSafeText(BRAND_CONTACT), {
    y,
    size: 8,
    font: fonts.regular,
    color: COLORS.slate,
  });

  drawPageFooter(page, fonts);

  return pdfDoc.save();
}

function normalizePayment(method: string | undefined): string {
  const m = pdfSafeText(method || "Cash");
  if ((PAYMENT_METHODS as readonly string[]).includes(m)) return m;
  // Accept free-text methods without failing the whole PDF
  return m || "Cash";
}

function safeDate(date: Date | string): Date {
  const d = date instanceof Date ? date : new Date(date);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function drawContinuedHeader(
  page: PDFPage,
  fonts: BrandFonts,
  y: number,
  receiptNumber: string
): number {
  drawCentered(page, "RECEIPT (continued)", {
    y,
    size: 11,
    font: fonts.bold,
    color: COLORS.charcoal,
  });
  y -= 14;
  drawCentered(page, pdfSafeText(receiptNumber), {
    y,
    size: 9,
    font: fonts.regular,
    color: COLORS.slate,
  });
  y -= 12;
  drawDashedRule(page, y, PAGE.width, COLORS.fence, MARGIN);
  return y - 16;
}

function drawPageFooter(page: PDFPage, fonts: BrandFonts) {
  page.drawText(pdfSafeText("KukuConnect · Kitui, Kenya"), {
    x: MARGIN,
    y: 28,
    size: 8,
    font: fonts.regular,
    color: COLORS.slate,
  });
}

// ---- helpers -----------------------------------------------------------

function drawCentered(
  page: PDFPage,
  text: string,
  opts: {
    y: number;
    size: number;
    font: PDFFont;
    color: RGB;
  }
) {
  const { y, size, font, color } = opts;
  const display = pdfSafeText(text);
  const w = font.widthOfTextAtSize(display, size);
  page.drawText(display, {
    x: PAGE.width / 2 - w / 2,
    y,
    size,
    font,
    color,
  });
}

function drawKV(
  page: PDFPage,
  fonts: BrandFonts,
  y: number,
  leftX: number,
  rightX: number,
  label: string,
  value: string,
  opts: { valueColor?: RGB } = {}
) {
  const size = 10;
  const safeLabel = pdfSafeText(label);
  const safeValue = pdfSafeText(value);
  page.drawText(safeLabel, {
    x: leftX,
    y,
    size,
    font: fonts.regular,
    color: COLORS.slate,
  });
  const valueColor = opts.valueColor || COLORS.charcoal;
  const valueWidth = fonts.bold.widthOfTextAtSize(safeValue, size);
  page.drawText(safeValue, {
    x: rightX - valueWidth,
    y,
    size,
    font: fonts.bold,
    color: valueColor,
  });
  return y - 16;
}

function drawReceiptRow(
  page: PDFPage,
  font: PDFFont,
  y: number,
  leftX: number,
  rightX: number,
  left: string,
  right: string,
  color: RGB,
  size = 10.5
) {
  page.drawText(pdfSafeText(left), { x: leftX, y, size, font, color });
  if (right) {
    const safeRight = pdfSafeText(right);
    const rightWidth = font.widthOfTextAtSize(safeRight, size);
    page.drawText(safeRight, {
      x: rightX - rightWidth,
      y,
      size,
      font,
      color,
    });
  }
}

function drawDashedRule(
  page: PDFPage,
  y: number,
  pageWidth: number,
  color: RGB,
  margin = MARGIN
) {
  page.drawLine({
    start: { x: margin, y },
    end: { x: pageWidth - margin, y },
    thickness: 1,
    color,
    dashArray: [3, 3],
  });
}

function truncate(str: string, max: number) {
  const s = pdfSafeText(str);
  if (!s) return "";
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}

function receiptNumberFromSale(sale: Sale): string {
  if (sale.receiptNumber) return sale.receiptNumber;
  const digits = sale.id.replace(/\D/g, "").slice(-5).padStart(5, "0");
  return `KC-RCT-${digits}`;
}

/** Generate + download branded till-slip PDF from a Sale. */
export async function generateReceiptPdf(
  sale: Sale,
  options?: { openWhatsApp?: boolean }
): Promise<void> {
  try {
    const logoBytes = await loadPublicLogoBytes();
    const bytes = await generateReceipt({
      receiptNumber: receiptNumberFromSale(sale),
      refNumber: sale.id,
      date: sale.createdAt ? new Date(sale.createdAt) : new Date(),
      customerName: sale.customer || "Walk-in Customer",
      customerPhone: sale.customerPhone || "",
      items: (sale.items || []).map((i) => ({
        description: i.name,
        qty: i.qty,
        unitPrice: i.price,
      })),
      paymentMethod: sale.paymentMethod || "Cash",
      mpesaCode: sale.mpesaCode || "",
      servedBy: sale.servedBy || "",
      logoBytes,
    });

    downloadPdfBytes(
      bytes,
      `KukuConnect-Receipt-${receiptNumberFromSale(sale)}.pdf`
    );
  } catch (err) {
    console.error("Receipt PDF failed", err);
    throw new Error(
      err instanceof Error
        ? `Could not create receipt PDF: ${err.message}`
        : "Could not create receipt PDF"
    );
  }

  if (options?.openWhatsApp && sale.customerPhone) {
    const total = formatKSh(sale.total);
    const msg =
      `KukuConnect Receipt\n` +
      `No: ${receiptNumberFromSale(sale)}\n` +
      `Date: ${sale.dateLabel}\n` +
      `Total: *${total}*\n\nAsante! - KukuConnect Kitui`;
    const phone = sale.customerPhone.replace(/[^\d+]/g, "");
    const normalized = phone.startsWith("0")
      ? `254${phone.slice(1)}`
      : phone.startsWith("7") && phone.length === 9
        ? `254${phone}`
        : phone;
    window.open(
      `https://wa.me/${normalized}?text=${encodeURIComponent(msg)}`,
      "_blank"
    );
  }
}
