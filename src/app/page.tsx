"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  getActiveStats,
  getCurrentDay,
  type IncubationBatch,
} from "@/lib/incubation";
import {
  type InventoryItem,
  getChicksReadyCount,
  getLowStockItems,
  getParentStockCount,
  isLowStock,
} from "@/lib/inventory";
import {
  type Sale,
  formatMonthLabel,
  getMonthRevenue,
  monthKeyFromDate,
} from "@/lib/sales";
import { type Expense, getMonthExpenses } from "@/lib/expenses";
import { listBatches } from "@/lib/data/incubationRepo";
import { listItems } from "@/lib/data/inventoryRepo";
import { listSalesPaginated } from "@/lib/data/salesRepo";
import { listExpensesPaginated } from "@/lib/data/expensesRepo";
import { listOrdersPaginated } from "@/lib/data/ordersRepo";
import {
  type FarmerOrder,
  formatMoney,
  pendingOrders,
} from "@/lib/orders";
import {
  Badge,
  Card,
  CardBody,
  EmptyState,
  PageHeader,
  PageSkeleton,
} from "@/components/ui";
import FinanceChart from "@/components/FinanceChart";
import {
  applyDailyAgeUp,
  needsAgeUp,
  type BrooderLot,
  todayIsoLocal,
} from "@/lib/brooder";
import {
  loadVaccinationRecordsLocal,
  getVaccineSummary,
  type VaccinationRecord,
} from "@/lib/vaccines";
import {
  buildFollowUpTasks,
  generateFollowUpWhatsAppUrl,
  type FollowUpTask,
} from "@/lib/crm";
import { listLots, saveLots } from "@/lib/data/brooderRepo";
import {
  listMovements,
  saveItems,
  saveMovements,
} from "@/lib/data/inventoryRepo";

export default function Dashboard() {
  const [batches, setBatches] = useState<IncubationBatch[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [orders, setOrders] = useState<FarmerOrder[]>([]);
  const [brooderBirds, setBrooderBirds] = useState(0);
  const [vaccinesDue, setVaccinesDue] = useState<VaccinationRecord[]>([]);
  const [followUpsDue, setFollowUpsDue] = useState<FollowUpTask[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [b, i, sRes, eRes, oRes, lots] = await Promise.all([
          listBatches(),
          listItems(),
          listSalesPaginated(1, 200),
          listExpensesPaginated(1, 200),
          listOrdersPaginated(1, 200),
          listLots(),
        ]);
        if (cancelled) return;

        // Daily brooder age-up when opening dashboard
        let nextItems = i;
        let nextLots: BrooderLot[] = lots;
        if (needsAgeUp(lots)) {
          const mov = await listMovements();
          const aged = applyDailyAgeUp(lots, i, mov);
          nextLots = aged.lots;
          nextItems = aged.items;
          await saveLots(aged.lots);
          await saveItems(aged.items);
          await saveMovements(aged.movements);
        }

        setBatches(b);
        setItems(nextItems);
        setSales(sRes.data);
        setExpenses(eRes.data);
        setOrders(oRes.data);
        setBrooderBirds(
          nextLots
            .filter((l) => l.status === "active")
            .reduce((a, l) => a + l.quantity, 0)
        );

        // Compute vaccines and followups due
        const vacs = loadVaccinationRecordsLocal();
        const vacSummary = getVaccineSummary(vacs, nextLots.filter((l) => l.status === "active"));
        setVaccinesDue([...vacSummary.dueToday, ...vacSummary.overdue]);

        const tasks = buildFollowUpTasks(oRes.data, sRes.data);
        const today = todayIsoLocal();
        setFollowUpsDue(tasks.filter((t) => t.status === "pending" && t.dueDate <= today));
      } catch (err) {
        console.error(err);
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const month = monthKeyFromDate();
  const stats = getActiveStats(batches);
  const parentStock = hydrated ? getParentStockCount(items) : null;
  const chicksReady = hydrated ? getChicksReadyCount(items) : null;
  const lowStock = hydrated ? getLowStockItems(items) : [];
  const monthRevenue = hydrated ? getMonthRevenue(sales, month) : null;
  const monthCosts = hydrated ? getMonthExpenses(expenses, month) : null;
  const monthProfit =
    monthRevenue != null && monthCosts != null
      ? monthRevenue - monthCosts
      : null;

  const eggsLabel = hydrated ? stats.eggsIncubating.toLocaleString() : "—";
  const dayLabel =
    hydrated && stats.leadBatch && stats.leadDay != null
      ? `Day ${Math.min(stats.leadDay, stats.leadBatch.incubationDays)} of ${stats.leadBatch.incubationDays}`
      : hydrated
        ? "No active batches"
        : "…";

  const topStock = hydrated
    ? [...items]
        .filter((i) => i.quantity > 0 || isLowStock(i))
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, 6)
    : [];

  const recentSales = hydrated ? sales.slice(0, 5) : [];
  const pending = hydrated ? pendingOrders(orders).slice(0, 5) : [];
  const pendingCount = hydrated ? pendingOrders(orders).length : null;

  if (!hydrated) return <PageSkeleton />;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Farm dashboard"
        description="Stock, orders, hatch progress, and this month’s money at a glance."
        showBackHome={false}
        actions={
          <p className="text-sm text-on-surface-variant hidden sm:block">
            {new Date().toLocaleDateString("en-KE", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </p>
        }
      />

      {/* Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Metric
          label="Parent stock"
          value={parentStock?.toLocaleString() ?? "—"}
          hint="Breeders"
          icon="cruelty_free"
          accent="primary"
          href="/inventory"
        />
        <Metric
          label="Eggs incubating"
          value={eggsLabel}
          hint={dayLabel}
          icon="egg"
          accent="gold"
          href="/incubation"
        />
        <Metric
          label="Chicks ready"
          value={chicksReady?.toLocaleString() ?? "—"}
          hint="Sellable livestock"
          icon="pets"
          accent="success"
          href="/inventory"
        />
        <Metric
          label={`Profit · ${formatMonthLabel(month)}`}
          value={
            monthProfit == null
              ? "—"
              : `${monthProfit < 0 ? "-" : ""}KSh ${Math.abs(monthProfit).toLocaleString()}`
          }
          hint={
            monthRevenue != null && monthCosts != null
              ? `Rev ${monthRevenue.toLocaleString()} − Exp ${monthCosts.toLocaleString()}`
              : "Sales − expenses"
          }
          icon="payments"
          accent={monthProfit != null && monthProfit < 0 ? "danger" : "primary"}
          href="/sales"
        />
      </div>

      <FinanceChart sales={sales} expenses={expenses} days={30} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Mini
          label="Pending orders"
          value={String(pendingCount ?? 0)}
          href="/orders"
          tone="warning"
        />
        <Mini
          label="Low stock"
          value={String(lowStock.length)}
          href="/inventory"
          tone={lowStock.length ? "danger" : "neutral"}
        />
        <Mini
          label="In brooder"
          value={brooderBirds.toLocaleString()}
          href="/brooder"
          tone="neutral"
        />
        <Mini
          label="Week sales"
          value={`KSh ${sales
            .filter((s) => {
              const d = new Date(s.createdAt);
              const weekAgo = new Date();
              weekAgo.setDate(weekAgo.getDate() - 7);
              return d >= weekAgo;
            })
            .reduce((a, s) => a + s.total, 0)
            .toLocaleString()}`}
          href="/sales"
          tone="neutral"
        />
      </div>

      {/* Operational Action Banners */}
      {(vaccinesDue.length > 0 || followUpsDue.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {vaccinesDue.length > 0 && (
            <div className="bg-amber-50/70 border border-amber-300 rounded-3xl p-5 shadow-sm space-y-3 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-200 text-amber-900 rounded-full text-xs font-bold uppercase tracking-wider">
                    💉 Flock Health Alert
                  </span>
                  <span className="text-xs font-bold text-amber-800">
                    {vaccinesDue.length} due/overdue
                  </span>
                </div>
                <h3 className="font-bold text-lg text-amber-950 mt-2">
                  {vaccinesDue[0].vaccineName}
                </h3>
                <p className="text-xs text-amber-900/80 mt-0.5">
                  Flock: <span className="font-semibold">{vaccinesDue[0].lotName}</span> · Method: {vaccinesDue[0].method} (Due: {vaccinesDue[0].dueDate})
                </p>
              </div>
              <Link
                href="/brooder"
                className="inline-flex items-center justify-center gap-1.5 w-full h-11 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-2xl text-xs transition-colors"
              >
                Go to Vaccine Calendar →
              </Link>
            </div>
          )}

          {followUpsDue.length > 0 && (
            <div className="bg-emerald-50/70 border border-emerald-300 rounded-3xl p-5 shadow-sm space-y-3 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-200 text-emerald-900 rounded-full text-xs font-bold uppercase tracking-wider">
                    👥 Customer Care Check-in
                  </span>
                  <span className="text-xs font-bold text-emerald-800">
                    {followUpsDue.length} due today
                  </span>
                </div>
                <h3 className="font-bold text-lg text-emerald-950 mt-2">
                  {followUpsDue[0].customerName}
                </h3>
                <p className="text-xs text-emerald-900/80 mt-0.5">
                  {followUpsDue[0].title} · <span className="font-semibold">{followUpsDue[0].chickSummary}</span>
                </p>
              </div>
              <div className="flex gap-2">
                <a
                  href={generateFollowUpWhatsAppUrl(followUpsDue[0])}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-1 inline-flex items-center justify-center gap-1.5 h-11 bg-[#25D366] hover:bg-[#20bd5a] text-white font-bold rounded-2xl text-xs transition-colors shadow-sm"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 00-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                  WhatsApp
                </a>
                <Link
                  href="/customers"
                  className="inline-flex items-center justify-center px-4 h-11 bg-surface-container text-on-surface hover:bg-surface-container-high font-bold rounded-2xl text-xs transition-colors"
                >
                  View All ({followUpsDue.length}) →
                </Link>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="space-y-3">
          <SectionLink title="Awaiting payment" href="/orders" />
          {pending.length === 0 ? (
            <EmptyState icon="shopping_bag" title="No pending orders">
              Share{" "}
              <Link href="/order" className="text-primary font-medium">
                /order
              </Link>{" "}
              with farmers.
            </EmptyState>
          ) : (
            <Card className="overflow-hidden divide-y divide-outline-variant/50">
              {pending.map((order) => (
                <Link
                  key={order.id}
                  href="/orders"
                  className="flex items-center justify-between gap-3 px-5 py-4 hover:bg-primary-fixed/25 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-on-surface truncate">
                      {order.customerName}
                    </p>
                    <p className="text-sm text-on-surface-variant truncate">
                      {order.customerPhone}
                    </p>
                  </div>
                  <p className="tabular-money text-secondary shrink-0">
                    {formatMoney(order.total)}
                  </p>
                </Link>
              ))}
            </Card>
          )}
        </section>

        <section className="space-y-3">
          <SectionLink title="Recent sales" href="/sales" />
          {recentSales.length === 0 ? (
            <EmptyState icon="receipt_long" title="No sales yet">
              <Link href="/sales" className="text-primary font-medium">
                Record a sale
              </Link>
            </EmptyState>
          ) : (
            <Card className="overflow-hidden divide-y divide-outline-variant/50">
              {recentSales.map((sale) => (
                <div
                  key={sale.id}
                  className="flex items-center justify-between gap-3 px-5 py-4"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-on-surface truncate">
                      {sale.customer || "Walk-in"}
                    </p>
                    <p className="text-sm text-on-surface-variant">
                      {sale.dateLabel}
                    </p>
                  </div>
                  <p className="tabular-money text-tertiary-container shrink-0">
                    KSh {sale.total.toLocaleString()}
                  </p>
                </div>
              ))}
            </Card>
          )}
        </section>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="space-y-3">
          <SectionLink title="Inventory" href="/inventory" />
          {topStock.length === 0 ? (
            <EmptyState icon="inventory_2" title="No stock recorded">
              <Link href="/settings" className="text-primary font-medium">
                Quick start stock
              </Link>
            </EmptyState>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {topStock.map((item) => (
                <Card key={item.id} variant="metric">
                  <CardBody className="!p-4">
                    <div className="flex justify-between gap-1">
                      <p className="text-sm font-semibold text-on-surface line-clamp-2">
                        {item.name}
                      </p>
                      {isLowStock(item) && <Badge tone="danger">Low</Badge>}
                    </div>
                    <p className="tabular-money text-2xl text-primary mt-2">
                      {item.quantity.toLocaleString()}
                    </p>
                    <p className="text-xs text-on-surface-variant">{item.unit}</p>
                  </CardBody>
                </Card>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <SectionLink title="Incubation" href="/incubation" />
          {stats.activeCount === 0 ? (
            <EmptyState icon="egg" title="Nothing incubating">
              <Link href="/incubation" className="text-primary font-medium">
                Start a batch
              </Link>
            </EmptyState>
          ) : (
            <div className="space-y-3">
              {batches
                .filter((b) => b.status === "incubating")
                .sort((a, b) => getCurrentDay(b) - getCurrentDay(a))
                .slice(0, 4)
                .map((batch) => {
                  const day = getCurrentDay(batch);
                  const eggs = Math.max(0, batch.eggCount - batch.removedEggs);
                  const pct = Math.min(
                    100,
                    Math.round((day / batch.incubationDays) * 100)
                  );
                  return (
                    <Card key={batch.id}>
                      <CardBody className="!p-4">
                        <div className="flex justify-between gap-2">
                          <div>
                            <p className="font-semibold text-on-surface">
                              {batch.name}
                            </p>
                            <p className="text-sm text-on-surface-variant">
                              {eggs.toLocaleString()} eggs · Day{" "}
                              {Math.min(day, batch.incubationDays)}/
                              {batch.incubationDays}
                            </p>
                          </div>
                          {day >= batch.incubationDays && (
                            <Badge tone="danger">Due</Badge>
                          )}
                        </div>
                        <div className="h-2 bg-surface-container-high rounded-full mt-3 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              day >= batch.incubationDays
                                ? "bg-error"
                                : "bg-secondary-container"
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </CardBody>
                    </Card>
                  );
                })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
  icon,
  accent,
  href,
}: {
  label: string;
  value: string;
  hint: string;
  icon: string;
  accent: "primary" | "gold" | "success" | "danger";
  href: string;
}) {
  const bar = {
    primary: "border-l-primary",
    gold: "border-l-secondary-container",
    success: "border-l-tertiary-container",
    danger: "border-l-error",
  }[accent];
  const labelC = {
    primary: "text-primary",
    gold: "text-secondary",
    success: "text-tertiary-container",
    danger: "text-error",
  }[accent];
  const valC = {
    primary: "text-primary",
    gold: "text-secondary",
    success: "text-tertiary-container",
    danger: "text-error",
  }[accent];

  return (
    <Link href={href}>
      <Card variant="metric" className={`border-l-4 ${bar} h-full`}>
        <CardBody className="relative overflow-hidden min-h-[140px] flex flex-col justify-between">
          <span className="material-symbols-outlined absolute -right-1 -bottom-1 text-[88px] opacity-[0.06]">
            {icon}
          </span>
          <div>
            <p className={`font-label-caps ${labelC}`}>{label}</p>
            <p className={`tabular-money text-3xl mt-2 tracking-tight ${valC}`}>
              {value}
            </p>
          </div>
          <p className="text-xs text-on-surface-variant mt-3 relative z-10">
            {hint}
          </p>
        </CardBody>
      </Card>
    </Link>
  );
}

function Mini({
  label,
  value,
  href,
  tone,
}: {
  label: string;
  value: string;
  href: string;
  tone: "warning" | "danger" | "neutral";
}) {
  const c = {
    warning: "text-secondary",
    danger: "text-error",
    neutral: "text-on-surface-variant",
  }[tone];
  return (
    <Link href={href}>
      <Card variant="metric" className="h-full">
        <CardBody className="!p-4">
          <p className={`font-label-caps ${c}`}>{label}</p>
          <p className="tabular-money text-2xl text-on-surface mt-1">{value}</p>
        </CardBody>
      </Card>
    </Link>
  );
}

function SectionLink({ title, href }: { title: string; href: string }) {
  return (
    <div className="flex items-center justify-between">
      <h3 className="text-lg font-semibold text-on-surface tracking-tight">
        {title}
      </h3>
      <Link
        href={href}
        className="font-label-caps text-primary flex items-center gap-1 hover:gap-1.5 transition-all"
      >
        Open
        <span className="material-symbols-outlined text-sm">arrow_forward</span>
      </Link>
    </div>
  );
}
