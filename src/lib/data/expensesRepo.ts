import {
  type Expense,
  loadExpenses as localLoadExpenses,
  saveExpenses as localSaveExpenses,
} from "@/lib/expenses";
import { getSupabase } from "@/lib/supabase/client";
import { getDataMode } from "./mode";

type ExpenseRow = {
  id: string;
  date: string;
  category: Expense["category"];
  amount: number;
  description: string;
  created_at: string;
};

function rowToExpense(row: ExpenseRow): Expense {
  return {
    id: row.id,
    date: row.date,
    category: row.category,
    amount: Number(row.amount),
    description: row.description ?? "",
    createdAt: row.created_at,
  };
}

export async function listExpenses(): Promise<Expense[]> {
  if (getDataMode() === "local") return localLoadExpenses();

  const supabase = getSupabase();
  if (!supabase) return localLoadExpenses();

  const { data, error } = await supabase
    .from("expenses")
    .select("*")
    .order("date", { ascending: false })
    .limit(1000);

  if (error) throw new Error(error.message);
  return (data as ExpenseRow[]).map(rowToExpense);
}

export async function saveExpenses(expenses: Expense[]): Promise<void> {
  if (getDataMode() === "local") {
    localSaveExpenses(expenses);
    return;
  }

  const supabase = getSupabase();
  if (!supabase) {
    localSaveExpenses(expenses);
    return;
  }

  const rows: ExpenseRow[] = expenses.map((e) => ({
    id: e.id,
    date: e.date,
    category: e.category,
    amount: e.amount,
    description: e.description,
    created_at: e.createdAt,
  }));

  const { error } = await supabase.from("expenses").upsert(rows);
  if (error) throw new Error(error.message);

  const ids = expenses.map((e) => e.id);
  const { data: existing } = await supabase.from("expenses").select("id");
  const toDelete = (existing ?? [])
    .map((r) => r.id as string)
    .filter((id) => !ids.includes(id));
  if (toDelete.length) {
    await supabase.from("expenses").delete().in("id", toDelete);
  }
}

export async function migrateLocalExpensesToCloud(): Promise<number> {
  const expenses = localLoadExpenses();
  if (!expenses.length) return 0;
  await saveExpenses(expenses);
  return expenses.length;
}
