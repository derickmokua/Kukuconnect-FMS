/**
 * KukuConnect brand kit for PDF documents (pdf-lib).
 * Receipt-slip style: white page, monospace type, color as accents only.
 */
import {
  PDFDocument,
  PDFFont,
  PDFImage,
  PDFPage,
  StandardFonts,
  rgb,
  type RGB,
} from "pdf-lib";

/** A4 page (points) */
export const PAGE = {
  width: 595,
  height: 842,
  margin: 40,
} as const;

export const COLORS = {
  charcoal: rgb(0.12, 0.12, 0.12),
  cream: rgb(0.97, 0.95, 0.9),
  fence: rgb(0.72, 0.72, 0.72),
  slate: rgb(0.45, 0.45, 0.45),
  yellow: rgb(0.98, 0.66, 0.15), // brand accent
  green: rgb(0.15, 0.45, 0.28),
  orange: rgb(0.91, 0.36, 0.02),
  red: rgb(0.608, 0.11, 0.173), // #9B1C2C
  white: rgb(1, 1, 1),
  brandRed: rgb(0.608, 0.11, 0.173),
} as const;

export const PAYMENT_METHODS = [
  "Cash",
  "M-Pesa",
  "Bank transfer",
  "Credit",
  "Mixed",
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export interface BrandFonts {
  regular: PDFFont;
  bold: PDFFont;
  oblique: PDFFont;
}

/** Monospace fonts for classic till-slip receipts / sales reports. */
export async function loadReceiptFonts(
  pdfDoc: PDFDocument
): Promise<BrandFonts> {
  const [regular, bold, oblique] = await Promise.all([
    pdfDoc.embedFont(StandardFonts.Courier),
    pdfDoc.embedFont(StandardFonts.CourierBold),
    pdfDoc.embedFont(StandardFonts.CourierOblique),
  ]);
  return { regular, bold, oblique };
}

/** @deprecated Prefer loadReceiptFonts for slip-style docs */
export async function loadBrandFonts(
  pdfDoc: PDFDocument
): Promise<BrandFonts> {
  return loadReceiptFonts(pdfDoc);
}

export async function embedLogo(
  pdfDoc: PDFDocument,
  logoBytes: ArrayBuffer | Uint8Array
): Promise<PDFImage | null> {
  const bytes =
    logoBytes instanceof Uint8Array ? logoBytes : new Uint8Array(logoBytes);
  try {
    return await pdfDoc.embedPng(bytes);
  } catch {
    try {
      return await pdfDoc.embedJpg(bytes);
    } catch {
      return null;
    }
  }
}

/** Contact line used on receipts and sales reports */
export const BRAND_CONTACT = "kukuconnect@outlook.com  |  Kitui, Kenya";

export function formatKSh(amount: number): string {
  const n = Math.round(Number(amount) || 0);
  return `KSh ${n.toLocaleString("en-KE")}`;
}

export function fitText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number
): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, size) > maxWidth) {
    t = t.slice(0, -1);
  }
  return `${t}…`;
}

/** Load logo from public/ (browser). Prefers transparent PNG. */
export async function loadPublicLogoBytes(): Promise<ArrayBuffer | null> {
  if (typeof window === "undefined") return null;
  const candidates = ["/logo_transparent.png", "/logo.png"];
  for (const path of candidates) {
    try {
      const res = await fetch(`${path}?v=3`);
      if (res.ok) return await res.arrayBuffer();
    } catch {
      /* try next */
    }
  }
  return null;
}

export function downloadPdfBytes(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export type { RGB, PDFPage, PDFFont };
