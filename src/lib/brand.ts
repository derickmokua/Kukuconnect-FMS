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

/**
 * Standard PDF fonts only support WinAnsi. Strip / replace chars that make
 * pdf-lib throw (smart quotes, ellipsis, em dash, etc.) so receipts always print.
 */
export function pdfSafeText(input: unknown): string {
  const s = String(input ?? "");
  return s
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2013\u2014\u2015]/g, "-")
    .replace(/[\u2026]/g, "...")
    .replace(/[\u00A0\u202F\u2007]/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "?")
    .trim();
}

/** Monospace fonts for classic till-slip receipts / sales reports. */
export async function loadReceiptFonts(
  pdfDoc: PDFDocument
): Promise<BrandFonts> {
  // Helvetica prints more cleanly on phones/thermal-style A4 than Courier
  const [regular, bold, oblique] = await Promise.all([
    pdfDoc.embedFont(StandardFonts.Helvetica),
    pdfDoc.embedFont(StandardFonts.HelveticaBold),
    pdfDoc.embedFont(StandardFonts.HelveticaOblique),
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
  // Avoid locale quirks; plain ASCII for pdf-lib
  return `KSh ${n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

export function fitText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number
): string {
  const safe = pdfSafeText(text);
  if (font.widthOfTextAtSize(safe, size) <= maxWidth) return safe;
  let t = safe;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}...`, size) > maxWidth) {
    t = t.slice(0, -1);
  }
  return `${t}...`;
}

/** Load logo from public/ (browser). Prefers transparent PNG. */
export async function loadPublicLogoBytes(): Promise<ArrayBuffer | null> {
  if (typeof window === "undefined") return null;
  const candidates = ["/logo_transparent.png", "/logo.png"];
  for (const path of candidates) {
    try {
      const res = await fetch(`${path}?v=4`);
      if (!res.ok) continue;
      const buf = await res.arrayBuffer();
      // Skip empty / tiny broken assets
      if (buf.byteLength < 100) continue;
      return buf;
    } catch {
      /* try next */
    }
  }
  return null;
}

export function downloadPdfBytes(bytes: Uint8Array, filename: string) {
  // Copy into a fresh ArrayBuffer-backed Uint8Array (avoids SharedArrayBuffer issues)
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = pdfSafeText(filename).replace(/[^\w.\-]+/g, "_") || "document.pdf";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Delay revoke so mobile browsers finish the download
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export type { RGB, PDFPage, PDFFont };
