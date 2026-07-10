import type { Sale } from "./sales";
import type { Expense } from "./expenses";

export interface DayPoint {
  date: string; // YYYY-MM-DD
  label: string;
  revenue: number;
  expenses: number;
  /** net = revenue - expenses */
  net: number;
  orders: number;
}

/** Last N calendar days of revenue (from sales) + expenses */
export function buildDailyFinanceSeries(
  sales: Sale[],
  expenses: Expense[],
  days = 30
): DayPoint[] {
  const points: DayPoint[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = isoLocal(d);
    const daySales = sales.filter((s) => s.createdAt.slice(0, 10) === key);
    const dayExp = expenses.filter((e) => e.date === key);
    const revenue = daySales.reduce((a, s) => a + s.total, 0);
    const exp = dayExp.reduce((a, e) => a + e.amount, 0);
    points.push({
      date: key,
      label: d.toLocaleDateString("en-KE", { day: "numeric", month: "short" }),
      revenue,
      expenses: exp,
      net: revenue - exp,
      orders: daySales.length,
    });
  }
  return points;
}

function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function seriesTotals(points: DayPoint[]) {
  return {
    revenue: points.reduce((a, p) => a + p.revenue, 0),
    expenses: points.reduce((a, p) => a + p.expenses, 0),
    net: points.reduce((a, p) => a + p.net, 0),
    orders: points.reduce((a, p) => a + p.orders, 0),
  };
}
