import { loadJson, saveJson } from "./storage";

export const SALES_STORAGE_KEY = "kukuconnect-sales";

export interface SaleLine {
  itemId: string;
  name: string;
  qty: number;
  price: number;
}

export type SalePaymentMethod =
  | "Cash"
  | "M-Pesa"
  | "Bank transfer"
  | "Credit"
  | "Mixed";

export interface Sale {
  id: string;
  /** ISO timestamp for sorting/filtering */
  createdAt: string;
  /** Human-readable en-KE datetime */
  dateLabel: string;
  customer: string;
  customerPhone: string;
  items: SaleLine[];
  total: number;
  /** Branded receipt number e.g. KC-RCT-00231 */
  receiptNumber?: string;
  paymentMethod?: SalePaymentMethod | string;
  mpesaCode?: string;
  servedBy?: string;
}

export function loadSales(): Sale[] {
  return loadJson<Sale[]>(SALES_STORAGE_KEY, []);
}

export function saveSales(sales: Sale[]): void {
  saveJson(SALES_STORAGE_KEY, sales.slice(0, 1000));
}

export function nextReceiptNumber(): string {
  const n = Date.now() % 100000;
  return `KC-RCT-${String(n).padStart(5, "0")}`;
}

export function createSale(input: {
  customer: string;
  customerPhone: string;
  items: SaleLine[];
  total: number;
  id?: string;
  paymentMethod?: SalePaymentMethod | string;
  mpesaCode?: string;
  servedBy?: string;
  receiptNumber?: string;
  createdAt?: string;
  dateLabel?: string;
}): Sale {
  const now = input.createdAt ? new Date(input.createdAt) : new Date();
  return {
    id: input.id ?? `sale-${Date.now()}`,
    createdAt: now.toISOString(),
    dateLabel: input.dateLabel ?? now.toLocaleString("en-KE"),
    customer: input.customer.trim(),
    customerPhone: input.customerPhone.trim(),
    items: input.items,
    total: Math.max(0, input.total),
    receiptNumber: input.receiptNumber ?? nextReceiptNumber(),
    paymentMethod: input.paymentMethod ?? "Cash",
    mpesaCode: input.mpesaCode?.trim() ?? "",
    servedBy: input.servedBy?.trim() ?? "",
  };
}

export function addSale(sales: Sale[], sale: Sale): Sale[] {
  return [sale, ...sales].slice(0, 1000);
}

export function deleteSale(sales: Sale[], id: string): Sale[] {
  return sales.filter((s) => s.id !== id);
}

/**
 * Correct the business date of an existing sale (e.g. logged a day late).
 * Accepts YYYY-MM-DD; stores noon local → ISO for stable month filters.
 */
export function updateSaleDate(
  sales: Sale[],
  id: string,
  dateYmd: string
): Sale[] {
  const ymd = dateYmd.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return sales;
  const when = new Date(`${ymd}T12:00:00`);
  if (Number.isNaN(when.getTime())) return sales;
  return sales.map((s) =>
    s.id === id
      ? {
          ...s,
          createdAt: when.toISOString(),
          dateLabel: when.toLocaleString("en-KE"),
        }
      : s
  );
}

/** Local calendar YYYY-MM-DD from a sale timestamp */
export function saleDateYmd(sale: Sale): string {
  const d = new Date(sale.createdAt);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** YYYY-MM for a Date or ISO string */
export function monthKeyFromDate(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function monthKeyFromIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return monthKeyFromDate(d);
}

export function filterSalesByMonth(sales: Sale[], monthKey: string): Sale[] {
  return sales.filter((s) => monthKeyFromIso(s.createdAt) === monthKey);
}

export function sumSales(sales: Sale[]): number {
  return sales.reduce((sum, s) => sum + s.total, 0);
}

export function getMonthRevenue(sales: Sale[], monthKey?: string): number {
  const key = monthKey ?? monthKeyFromDate();
  return sumSales(filterSalesByMonth(sales, key));
}

export function formatMonthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  if (!y || !m) return monthKey;
  return new Date(y, m - 1, 1).toLocaleDateString("en-KE", {
    month: "long",
    year: "numeric",
  });
}

/** Unique months present in sales, newest first */
export function availableSaleMonths(sales: Sale[]): string[] {
  const set = new Set(sales.map((s) => monthKeyFromIso(s.createdAt)).filter(Boolean));
  const current = monthKeyFromDate();
  set.add(current);
  return Array.from(set).sort((a, b) => b.localeCompare(a));
}

export function lineCount(sale: Sale): number {
  return sale.items.reduce((n, i) => n + i.qty, 0);
}
