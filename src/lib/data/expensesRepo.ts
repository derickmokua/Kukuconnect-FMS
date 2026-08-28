import {
  type Expense,
  loadExpenses as localLoadExpenses,
  saveExpenses as localSaveExpenses,
} from "@/lib/expenses";
import { getSupabase } from "@/lib/supabase/client";
import { getDataMode } from "./mode";
import { getCache, setCache } from "./idbStore";
import { enqueueMutation, isNetworkError } from "./outbox";

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
  if (!supabase) throw new Error("Supabase client is not configured");

  try {
    const { data, error } = await supabase
      .from("expenses")
      .select("*")
      .order("date", { ascending: false })
      .limit(1000);

    if (error) throw new Error(error.message);
    const expenses = (data as ExpenseRow[]).map(rowToExpense);
    await setCache("expenses", expenses);
    return expenses;
  } catch (err) {
    if (isNetworkError(err)) {
      const cached = await getCache("expenses");
      if (cached) return cached;
    }
    throw err;
  }
}

export async function listExpensesPaginated(
  page = 1,
  pageSize = 50,
  query = ""
): Promise<{ data: Expense[]; count: number }> {
  if (getDataMode() === "local") {
    let all = localLoadExpenses();
    if (query) {
      const q = query.toLowerCase();
      all = all.filter(
        (e) =>
          e.description.toLowerCase().includes(q) ||
          e.category.toLowerCase().includes(q)
      );
    }
    const count = all.length;
    const data = all.slice((page - 1) * pageSize, page * pageSize);
    return { data, count };
  }

  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase client is not configured");

  try {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      throw new Error("Failed to fetch");
    }

    let qb = supabase
      .from("expenses")
      .select("*", { count: "exact" })
      .order("date", { ascending: false });

    if (query) {
      qb = qb.or(`description.ilike.%${query}%,category.ilike.%${query}%`);
    }

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    const { data, error, count } = await qb.range(from, to);

    if (error) throw new Error(error.message);

    const expenses = (data as ExpenseRow[]).map(rowToExpense);
    
    // Upsert into cache
    const cached = (await getCache("expenses")) || [];
    const cacheMap = new Map((cached as Expense[]).map((e) => [e.id, e]));
    for (const e of expenses) {
      cacheMap.set(e.id, e);
    }
    await setCache("expenses", Array.from(cacheMap.values()).sort((a, b) => b.date.localeCompare(a.date)));

    return { data: expenses, count: count ?? 0 };
  } catch (err) {
    if (isNetworkError(err)) {
      // Offline fallback: filter cache
      let all = ((await getCache("expenses")) || []) as Expense[];
      if (query) {
        const q = query.toLowerCase();
        all = all.filter(
          (e) =>
            e.description.toLowerCase().includes(q) ||
            e.category.toLowerCase().includes(q)
        );
      }
      const count = all.length;
      const data = all.slice((page - 1) * pageSize, page * pageSize);
      return { data, count };
    }
    throw err;
  }
}


export async function saveExpenses(expenses: Expense[]): Promise<void> {
  if (getDataMode() === "local") {
    localSaveExpenses(expenses);
    return;
  }

  const supabase = getSupabase();
  if (!supabase) {
    throw new Error("Supabase client is not configured");
  }

  const rows: ExpenseRow[] = expenses.map((e) => ({
    id: e.id,
    date: e.date,
    category: e.category,
    amount: e.amount,
    description: e.description,
    created_at: e.createdAt,
  }));

  await setCache("expenses", expenses);
  
  try {
    if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error("Failed to fetch");
    const { error } = await supabase.from("expenses").upsert(rows);
    if (error) throw new Error(error.message);
  } catch (err) {
    if (isNetworkError(err)) {
      await enqueueMutation("expenses", "UPSERT", rows);
      return;
    }
    throw err;
  }

  // REMOVED: Bulk delete logic that destroyed cloud records missing from the local cache.
}

export async function insertExpense(expense: Expense): Promise<void> {
  if (getDataMode() === "local") {
    const all = localLoadExpenses();
    localSaveExpenses([expense, ...all]);
    return;
  }

  const supabase = getSupabase();
  if (!supabase) {
    throw new Error("Supabase client is not configured");
  }

  const row: ExpenseRow = {
    id: expense.id,
    date: expense.date,
    category: expense.category,
    amount: expense.amount,
    description: expense.description,
    created_at: expense.createdAt,
  };

  const cached = await getCache("expenses") || [];
  await setCache("expenses", [expense, ...cached]);

  try {
    if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error("Failed to fetch");
    const { error } = await supabase.from("expenses").insert(row);
    if (error) throw new Error(error.message);
  } catch (err) {
    if (isNetworkError(err)) {
      await enqueueMutation("expenses", "INSERT", row);
      return;
    }
    throw err;
  }
}

export async function updateExpense(expense: Expense): Promise<void> {
  if (getDataMode() === "local") {
    const all = localLoadExpenses().map(e => e.id === expense.id ? expense : e);
    localSaveExpenses(all);
    return;
  }

  const supabase = getSupabase();
  if (!supabase) {
    throw new Error("Supabase client is not configured");
  }

  const row: ExpenseRow = {
    id: expense.id,
    date: expense.date,
    category: expense.category,
    amount: expense.amount,
    description: expense.description,
    created_at: expense.createdAt,
  };

  const cached = (await getCache("expenses") || []) as Expense[];
  await setCache("expenses", cached.map(e => e.id === expense.id ? expense : e));

  try {
    if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error("Failed to fetch");
    const { error } = await supabase.from("expenses").update(row).eq("id", expense.id);
    if (error) throw new Error(error.message);
  } catch (err) {
    if (isNetworkError(err)) {
      await enqueueMutation("expenses", "UPDATE", row);
      return;
    }
    throw err;
  }
}

export async function deleteExpenseCloud(id: string): Promise<void> {
  if (getDataMode() === "local") {
    const all = localLoadExpenses().filter(e => e.id !== id);
    localSaveExpenses(all);
    return;
  }
  
  const supabase = getSupabase();
  if (!supabase) {
    throw new Error("Supabase client is not configured");
  }
  
  const cached = (await getCache("expenses") || []) as Expense[];
  await setCache("expenses", cached.filter(e => e.id !== id));

  try {
    if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error("Failed to fetch");
    const { error } = await supabase.from("expenses").delete().eq("id", id);
    if (error) throw new Error(error.message);
  } catch (err) {
    if (isNetworkError(err)) {
      await enqueueMutation("expenses", "DELETE", { id });
      return;
    }
    throw err;
  }
}

export async function migrateLocalExpensesToCloud(): Promise<number> {
  const expenses = localLoadExpenses();
  if (!expenses.length) return 0;
  await saveExpenses(expenses);
  return expenses.length;
}
