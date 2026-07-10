import { loadJson, saveJson } from "./storage";
import { monthKeyFromDate } from "./sales";

export const EXPENSES_STORAGE_KEY = "kukuconnect-expenses";

export type ExpenseCategory =
  | "feed"
  | "medicine"
  | "labour"
  | "transport"
  | "utilities"
  | "equipment"
  | "other";

export interface Expense {
  id: string;
  /** Calendar date YYYY-MM-DD */
  date: string;
  category: ExpenseCategory;
  amount: number;
  description: string;
  createdAt: string;
}

export const EXPENSE_CATEGORIES: {
  id: ExpenseCategory;
  label: string;
}[] = [
  { id: "feed", label: "Feed" },
  { id: "medicine", label: "Medicine / vaccines" },
  { id: "labour", label: "Labour" },
  { id: "transport", label: "Transport" },
  { id: "utilities", label: "Utilities" },
  { id: "equipment", label: "Equipment" },
  { id: "other", label: "Other" },
];

export function categoryLabel(category: ExpenseCategory): string {
  return EXPENSE_CATEGORIES.find((c) => c.id === category)?.label ?? category;
}

export function loadExpenses(): Expense[] {
  return loadJson<Expense[]>(EXPENSES_STORAGE_KEY, []);
}

export function saveExpenses(expenses: Expense[]): void {
  saveJson(EXPENSES_STORAGE_KEY, expenses.slice(0, 1000));
}

export function createExpense(input: {
  date: string;
  category: ExpenseCategory;
  amount: number;
  description?: string;
}): Expense {
  return {
    id: `exp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    date: input.date,
    category: input.category,
    amount: Math.max(0, Math.round(input.amount)),
    description: input.description?.trim() ?? "",
    createdAt: new Date().toISOString(),
  };
}

export function addExpense(expenses: Expense[], expense: Expense): Expense[] {
  return [expense, ...expenses].slice(0, 1000);
}

export function deleteExpense(expenses: Expense[], id: string): Expense[] {
  return expenses.filter((e) => e.id !== id);
}

export function monthKeyFromExpenseDate(date: string): string {
  // date is YYYY-MM-DD
  return date.slice(0, 7);
}

export function filterExpensesByMonth(
  expenses: Expense[],
  monthKey: string
): Expense[] {
  return expenses.filter((e) => monthKeyFromExpenseDate(e.date) === monthKey);
}

export function sumExpenses(expenses: Expense[]): number {
  return expenses.reduce((sum, e) => sum + e.amount, 0);
}

export function getMonthExpenses(
  expenses: Expense[],
  monthKey?: string
): number {
  const key = monthKey ?? monthKeyFromDate();
  return sumExpenses(filterExpensesByMonth(expenses, key));
}

export function availableExpenseMonths(expenses: Expense[]): string[] {
  const set = new Set(
    expenses.map((e) => monthKeyFromExpenseDate(e.date)).filter(Boolean)
  );
  set.add(monthKeyFromDate());
  return Array.from(set).sort((a, b) => b.localeCompare(a));
}

export function expensesByCategory(
  expenses: Expense[]
): { category: ExpenseCategory; total: number }[] {
  const map = new Map<ExpenseCategory, number>();
  for (const e of expenses) {
    map.set(e.category, (map.get(e.category) ?? 0) + e.amount);
  }
  return EXPENSE_CATEGORIES.map((c) => ({
    category: c.id,
    total: map.get(c.id) ?? 0,
  })).filter((r) => r.total > 0);
}

export function todayIsoDate(): string {
  const n = new Date();
  const y = n.getFullYear();
  const m = String(n.getMonth() + 1).padStart(2, "0");
  const d = String(n.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function formatExpenseDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-KE", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
