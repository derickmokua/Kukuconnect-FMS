"use client";

import { useMemo, useState } from "react";
import type { Sale } from "@/lib/sales";
import type { Expense } from "@/lib/expenses";
import {
  buildDailyFinanceSeries,
  seriesTotals,
} from "@/lib/financeChart";
import Card, { CardBody } from "@/components/ui/Card";

type SeriesKey = "revenue" | "expenses" | "net";

const COLORS: Record<SeriesKey, string> = {
  revenue: "#015d16",
  expenses: "#780019",
  net: "#835400",
};

export default function FinanceChart({
  sales,
  expenses,
  days = 30,
}: {
  sales: Sale[];
  expenses: Expense[];
  days?: number;
}) {
  const [visible, setVisible] = useState<Record<SeriesKey, boolean>>({
    revenue: true,
    expenses: true,
    net: false,
  });

  const points = useMemo(
    () => buildDailyFinanceSeries(sales, expenses, days),
    [sales, expenses, days]
  );
  const totals = useMemo(() => seriesTotals(points), [points]);

  const maxY = useMemo(() => {
    let m = 1;
    for (const p of points) {
      if (visible.revenue) m = Math.max(m, p.revenue);
      if (visible.expenses) m = Math.max(m, p.expenses);
      if (visible.net) m = Math.max(m, Math.abs(p.net));
    }
    return m;
  }, [points, visible]);

  const w = 640;
  const h = 200;
  const padL = 8;
  const padR = 8;
  const padT = 12;
  const padB = 28;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const xAt = (i: number) =>
    padL + (points.length <= 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const yAt = (v: number) => padT + plotH - (v / maxY) * plotH;

  function pathFor(key: SeriesKey) {
    if (!visible[key] || points.length === 0) return "";
    return points
      .map((p, i) => {
        const val = key === "net" ? Math.abs(p.net) : p[key];
        const cmd = i === 0 ? "M" : "L";
        return `${cmd}${xAt(i).toFixed(1)},${yAt(val).toFixed(1)}`;
      })
      .join(" ");
  }

  function areaFor(key: "revenue" | "expenses") {
    if (!visible[key] || points.length === 0) return "";
    const line = points
      .map((p, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(1)},${yAt(p[key]).toFixed(1)}`)
      .join(" ");
    const last = points.length - 1;
    return `${line} L${xAt(last).toFixed(1)},${(padT + plotH).toFixed(1)} L${xAt(0).toFixed(1)},${(padT + plotH).toFixed(1)} Z`;
  }

  const toggle = (k: SeriesKey) =>
    setVisible((v) => ({ ...v, [k]: !v[k] }));

  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <p className="font-label-caps text-on-surface-variant">
              Last {days} days
            </p>
            <h3 className="text-lg font-semibold text-on-surface mt-0.5">
              Sales, revenue & expenses
            </h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["revenue", "Revenue"],
                ["expenses", "Expenses"],
                ["net", "Net"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => toggle(key)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition ${
                  visible[key]
                    ? "border-transparent text-white"
                    : "border-outline-variant bg-white text-on-surface-variant"
                }`}
                style={
                  visible[key]
                    ? { backgroundColor: COLORS[key] }
                    : undefined
                }
              >
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: COLORS[key] }}
                />
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Stat label="Revenue" value={totals.revenue} color={COLORS.revenue} />
          <Stat label="Expenses" value={totals.expenses} color={COLORS.expenses} />
          <Stat label="Net" value={totals.net} color={COLORS.net} />
        </div>

        <div className="w-full overflow-x-auto">
          <svg
            viewBox={`0 0 ${w} ${h}`}
            className="w-full min-w-[280px] h-auto"
            role="img"
            aria-label="Finance chart"
          >
            {/* grid */}
            {[0.25, 0.5, 0.75, 1].map((t) => (
              <line
                key={t}
                x1={padL}
                x2={w - padR}
                y1={yAt(maxY * t)}
                y2={yAt(maxY * t)}
                stroke="#e0bfbe"
                strokeWidth={0.5}
                strokeDasharray="4 4"
              />
            ))}
            {visible.revenue && (
              <path d={areaFor("revenue")} fill={COLORS.revenue} opacity={0.08} />
            )}
            {visible.expenses && (
              <path d={areaFor("expenses")} fill={COLORS.expenses} opacity={0.08} />
            )}
            {visible.revenue && (
              <path
                d={pathFor("revenue")}
                fill="none"
                stroke={COLORS.revenue}
                strokeWidth={2.5}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )}
            {visible.expenses && (
              <path
                d={pathFor("expenses")}
                fill="none"
                stroke={COLORS.expenses}
                strokeWidth={2.5}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )}
            {visible.net && (
              <path
                d={pathFor("net")}
                fill="none"
                stroke={COLORS.net}
                strokeWidth={2}
                strokeDasharray="6 4"
                strokeLinejoin="round"
              />
            )}
            {/* x labels every ~5 days */}
            {points.map((p, i) =>
              i % Math.ceil(points.length / 6) === 0 || i === points.length - 1 ? (
                <text
                  key={p.date}
                  x={xAt(i)}
                  y={h - 8}
                  textAnchor="middle"
                  className="fill-[#594141]"
                  style={{ fontSize: 9 }}
                >
                  {p.label}
                </text>
              ) : null
            )}
          </svg>
        </div>
        <p className="text-xs text-on-surface-variant">
          {totals.orders} sale{totals.orders === 1 ? "" : "s"} in period · amounts in
          KSh
        </p>
      </CardBody>
    </Card>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="rounded-xl bg-surface-container-low border border-outline-variant/50 px-3 py-2">
      <p className="font-label-caps text-[10px]" style={{ color }}>
        {label}
      </p>
      <p className="tabular-money text-sm sm:text-base text-on-surface mt-0.5">
        {value < 0 ? "-" : ""}KSh {Math.abs(value).toLocaleString()}
      </p>
    </div>
  );
}
