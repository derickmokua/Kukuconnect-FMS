/**
 * Single-page branded KukuConnect sales receipt (classic printed till slip).
 * White background, monospace type, centered logo, dashed accent rules.
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

  if (!PAYMENT_METHODS.includes(paymentMethod as PaymentMethod)) {
    throw new Error(
      `paymentMethod must be one of: ${PAYMENT_METHODS.join(", ")}`
    );
  }

  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(`KukuConnect Receipt ${receiptNumber}`);
  pdfDoc.setProducer("KukuConnect");

  const fonts = await loadReceiptFonts(pdfDoc);

  let logoImage = null;
  if (logoBytes) {
    logoImage = await embedLogo(pdfDoc, logoBytes);
  }

  const page = pdfDoc.addPage([PAGE.width, PAGE.height]);
  const { width } = page.getSize();
  const centerX = width / 2;

  // Plain white background (default) — no solid header band
  let y = PAGE.height - 56;

  // Centered logo
  if (logoImage) {
    const logoSize = 130;
    page.drawImage(logoImage, {
      x: centerX - logoSize / 2,
      y: y - logoSize,
      width: logoSize,
      height: logoSize,
    });
    y -= logoSize + 14;
  } else {
    // Text wordmark fallback if logo missing
    drawCentered(page, "KukuConnect", {
      y,
      size: 16,
      font: fonts.bold,
      color: COLORS.charcoal,
    });
    y -= 22;
  }

  drawDashedRule(page, y, width, COLORS.yellow, 90);
  y -= 22;

  drawCentered(page, "RECEIPT", {
    y,
    size: 13,
    font: fonts.bold,
    color: COLORS.charcoal,
    tracking: 3,
  });
  y -= 18;

  const metaLeftX = 90;
  const metaRightX = width - 90;

  y = drawKV(page, fonts, y, metaLeftX, metaRightX, "Receipt #", receiptNumber || "—");
  if (refNumber) {
    y = drawKV(page, fonts, y, metaLeftX, metaRightX, "Ref #", refNumber);
  }
  const dateStr = new Date(date).toLocaleDateString("en-KE", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  y = drawKV(page, fonts, y, metaLeftX, metaRightX, "Date", dateStr);
  y = drawKV(page, fonts, y, metaLeftX, metaRightX, "Served by", servedBy || "—");
  y = drawKV(page, fonts, y, metaLeftX, metaRightX, "Customer", customerName);
  if (customerPhone) {
    y = drawKV(page, fonts, y, metaLeftX, metaRightX, "Phone", customerPhone);
  }

  const paymentValue =
    paymentMethod === "M-Pesa" && mpesaCode
      ? `M-Pesa (${mpesaCode})`
      : String(paymentMethod);
  y = drawKV(page, fonts, y, metaLeftX, metaRightX, "Payment", paymentValue, {
    valueColor: paymentMethod === "M-Pesa" ? COLORS.green : COLORS.charcoal,
  });

  y -= 6;
  drawDashedRule(page, y, width, COLORS.fence, 90);
  y -= 20;

  const itemsLeftX = 90;
  const itemsRightX = width - 90;

  drawReceiptRow(
    page,
    fonts.bold,
    y,
    itemsLeftX,
    itemsRightX,
    "ITEM",
    "AMOUNT",
    COLORS.charcoal
  );
  y -= 14;
  drawDashedRule(page, y, width, COLORS.fence, 90);
  y -= 16;

  let subtotal = 0;
  for (const item of items) {
    if (y < 100) break;
    const lineTotal = item.qty * item.unitPrice;
    subtotal += lineTotal;

    drawReceiptRow(
      page,
      fonts.regular,
      y,
      itemsLeftX,
      itemsRightX,
      truncate(item.description, 36),
      formatKSh(lineTotal),
      COLORS.charcoal
    );
    y -= 13;
    drawReceiptRow(
      page,
      fonts.oblique,
      y,
      itemsLeftX,
      itemsRightX,
      `  ${item.qty} x ${formatKSh(item.unitPrice)}`,
      "",
      COLORS.slate,
      9
    );
    y -= 18;
  }

  // Full total even if some lines skipped for space
  subtotal = items.reduce((s, it) => s + it.qty * it.unitPrice, 0);

  drawDashedRule(page, y, width, COLORS.fence, 90);
  y -= 22;

  drawReceiptRow(
    page,
    fonts.regular,
    y,
    itemsLeftX,
    itemsRightX,
    "Subtotal",
    formatKSh(subtotal),
    COLORS.charcoal
  );
  y -= 20;
  drawReceiptRow(
    page,
    fonts.bold,
    y,
    itemsLeftX,
    itemsRightX,
    "TOTAL PAID",
    formatKSh(subtotal),
    COLORS.green,
    13
  );
  y -= 30;

  drawDashedRule(page, y, width, COLORS.yellow, 90);
  y -= 26;

  drawCentered(page, "Thank you for farming with KukuConnect!", {
    y,
    size: 10,
    font: fonts.oblique,
    color: COLORS.orange,
  });
  y -= 16;
  drawCentered(page, BRAND_CONTACT, {
    y,
    size: 8,
    font: fonts.regular,
    color: COLORS.slate,
  });

  return pdfDoc.save();
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
    tracking?: number;
  }
) {
  const { y, size, font, color, tracking = 0 } = opts;
  const { width } = page.getSize();
  const display = tracking >= 2 ? text.split("").join(" ") : text;
  const w = font.widthOfTextAtSize(display, size);
  page.drawText(display, {
    x: width / 2 - w / 2,
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
  const size = 9.5;
  page.drawText(label, {
    x: leftX,
    y,
    size,
    font: fonts.regular,
    color: COLORS.slate,
  });
  const valueColor = opts.valueColor || COLORS.charcoal;
  const valueWidth = fonts.bold.widthOfTextAtSize(value, size);
  page.drawText(value, {
    x: rightX - valueWidth,
    y,
    size,
    font: fonts.bold,
    color: valueColor,
  });
  return y - 15;
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
  page.drawText(left, { x: leftX, y, size, font, color });
  if (right) {
    const rightWidth = font.widthOfTextAtSize(right, size);
    page.drawText(right, {
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
  margin = 90
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
  if (!str) return "";
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
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
  const logoBytes = await loadPublicLogoBytes();
  const bytes = await generateReceipt({
    receiptNumber: receiptNumberFromSale(sale),
    refNumber: sale.id,
    date: sale.createdAt ? new Date(sale.createdAt) : new Date(),
    customerName: sale.customer || "Walk-in Customer",
    customerPhone: sale.customerPhone || "",
    items: sale.items.map((i) => ({
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

  if (options?.openWhatsApp && sale.customerPhone) {
    const total = formatKSh(sale.total);
    const msg =
      `KukuConnect Receipt\n` +
      `No: ${receiptNumberFromSale(sale)}\n` +
      `Date: ${sale.dateLabel}\n` +
      `Total: *${total}*\n\nAsante! — KukuConnect Kitui`;
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
