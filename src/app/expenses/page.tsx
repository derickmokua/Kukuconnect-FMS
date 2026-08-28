"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Nav from "@/components/Nav";
import {
  type Expense,
  type ExpenseCategory,
  EXPENSE_CATEGORIES,
  addExpense,
  availableExpenseMonths,
  categoryLabel,
  createExpense,
  deleteExpense,
  expensesByCategory,
  filterExpensesByMonth,
  formatExpenseDate,
  getMonthExpenses,
  sumExpenses,
  todayIsoDate,
} from "@/lib/expenses";
import { formatMonthLabel, monthKeyFromDate } from "@/lib/sales";
import { listExpensesPaginated, insertExpense, deleteExpenseCloud } from "@/lib/data/expensesRepo";

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [showForm, setShowForm] = useState(false);
  
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [totalCount, setTotalCount] = useState(0);
  const pageSize = 20;

  const [date, setDate] = useState(todayIsoDate());
  const [category, setCategory] = useState<ExpenseCategory>("feed");
  const [amount, setAmount] = useState(0);
  const [description, setDescription] = useState("");

  const loadData = useCallback(async () => {
    try {
      const { data, count } = await listExpensesPaginated(page, pageSize, searchQuery);
      setExpenses(data);
      setTotalCount(count);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to load expenses");
    } finally {
      setHydrated(true);
    }
  }, [page, pageSize, searchQuery]);

  useEffect(() => {
    let timeout = setTimeout(() => {
      loadData();
    }, 300);
    return () => clearTimeout(timeout);
  }, [loadData]);

  const pageTotal = useMemo(() => sumExpenses(expenses), [expenses]);
  const byCategory = useMemo(() => expensesByCategory(expenses), [expenses]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (amount <= 0) {
      alert("Enter an amount greater than zero.");
      return;
    }
    const expense = createExpense({ date, category, amount, description });
    const next = addExpense(expenses, expense);
    setExpenses(next);
    try {
      await insertExpense(expense);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save expense");
    }
    setAmount(0);
    setDescription("");
    setDate(todayIsoDate());
    setShowForm(false);
    loadData();
  };

  const handleDelete = async (expense: Expense) => {
    if (!window.confirm(`Delete expense of KSh ${expense.amount.toLocaleString()}?`)) {
      return;
    }
    const next = deleteExpense(expenses, expense.id);
    setExpenses(next);
    try {
      await deleteExpenseCloud(expense.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete expense");
    }
  };

  if (!hydrated) {
    return (
      <div className="max-w-4xl mx-auto">
        <Nav />
        <p className="text-on-surface-variant">Loading expenses…</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <Nav />

      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 border-b border-outline-variant pb-6">
        <div>
          <h2 className="text-3xl font-bold text-on-surface">Expenses</h2>
          <p className="text-on-surface-variant mt-1">
            Track feed, meds, labour, and other farm costs
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="bg-secondary-container text-on-secondary-container hover:opacity-90 px-6 py-3 rounded-2xl font-medium transition"
        >
          {showForm ? "Cancel" : "+ Add expense"}
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="farm-card p-5 rounded-3xl border border-outline-variant">
          <p className="text-sm text-error font-medium">Page Total</p>
          <p className="text-2xl font-bold text-on-surface mt-2">
            KSh {pageTotal.toLocaleString()}
          </p>
          <p className="text-xs text-on-surface-variant mt-1">
            {expenses.length} expense{expenses.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="farm-card p-5 rounded-3xl border border-outline-variant">
          <label className="block space-y-2">
            <span className="text-sm text-on-surface-variant">Search Expenses</span>
            <input
              type="text"
              placeholder="Search by description or category..."
              className="w-full bg-surface-container-highest p-3 rounded-2xl text-on-surface"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1); // Reset to page 1 on search
              }}
            />
          </label>
        </div>
      </div>

      {byCategory.length > 0 && (
        <div className="farm-card rounded-3xl p-5 border border-outline-variant">
          <h3 className="text-sm font-medium text-on-surface-variant mb-3">
            By category (this page)
          </h3>
          <div className="flex flex-wrap gap-2">
            {byCategory.map((row) => (
              <span
                key={row.category}
                className="bg-surface-container-highest text-gray-200 text-sm px-3 py-1.5 rounded-full"
              >
                {categoryLabel(row.category)}: KSh {row.total.toLocaleString()}
              </span>
            ))}
          </div>
        </div>
      )}

      {showForm && (
        <form
          onSubmit={handleAdd}
          className="farm-card p-6 rounded-3xl border border-outline-variant space-y-4"
        >
          <h3 className="text-lg font-semibold text-on-surface">New expense</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="block space-y-1">
              <span className="text-sm text-on-surface-variant">Date</span>
              <input
                type="date"
                required
                className="w-full bg-surface-container-highest p-3 rounded-2xl text-on-surface"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-sm text-on-surface-variant">Category</span>
              <select
                className="w-full bg-surface-container-highest p-3 rounded-2xl text-on-surface"
                value={category}
                onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
              >
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-sm text-on-surface-variant">Amount (KSh)</span>
              <input
                type="number"
                min={1}
                required
                className="w-full bg-surface-container-highest p-3 rounded-2xl text-on-surface"
                value={amount || ""}
                onChange={(e) => setAmount(Number(e.target.value))}
                placeholder="0"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-sm text-on-surface-variant">Description</span>
              <input
                className="w-full bg-surface-container-highest p-3 rounded-2xl text-on-surface"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Chick mash 50kg × 2"
              />
            </label>
          </div>
          <button
            type="submit"
            className="bg-primary hover:bg-primary/90 px-6 py-3 rounded-2xl font-semibold"
          >
            Save expense
          </button>
        </form>
      )}

      {expenses.length === 0 ? (
        <div className="farm-card rounded-3xl p-12 text-center text-on-surface-variant border border-outline-variant">
          No expenses found.
        </div>
      ) : (
        <div className="space-y-3">
          {expenses.map((expense) => (
            <article
              key={expense.id}
              className="farm-card rounded-3xl p-5 border border-outline-variant flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
            >
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold text-on-surface">
                    {expense.description || categoryLabel(expense.category)}
                  </h3>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-surface-container-highest text-on-surface-variant">
                    {categoryLabel(expense.category)}
                  </span>
                </div>
                <p className="text-sm text-on-surface-variant mt-1">
                  {formatExpenseDate(expense.date)}
                </p>
              </div>
              <div className="flex items-center gap-4">
                <p className="text-xl font-bold text-error">
                  − KSh {expense.amount.toLocaleString()}
                </p>
                <button
                  type="button"
                  onClick={() => handleDelete(expense)}
                  className="text-sm text-on-surface-variant hover:text-error"
                >
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {totalCount > pageSize && (
        <div className="flex justify-between items-center py-4">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-4 py-2 bg-surface-container-highest rounded-xl disabled:opacity-50"
          >
            Previous
          </button>
          <span className="text-sm text-on-surface-variant">
            Page {page} of {Math.ceil(totalCount / pageSize)} ({totalCount} total)
          </span>
          <button
            onClick={() => setPage(p => p + 1)}
            disabled={page >= Math.ceil(totalCount / pageSize)}
            className="px-4 py-2 bg-surface-container-highest rounded-xl disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
