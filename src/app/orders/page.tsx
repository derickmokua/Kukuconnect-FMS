"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  type FarmerOrder,
  type OrderStatus,
  createOrder,
  formatMoney,
  lineFromProduct,
  markCancelled,
  markFulfilled,
  markPaid,
  ORDER_PRODUCTS,
  statusLabel,
} from "@/lib/orders";
import { listOrders, insertOrder, updateOrder } from "@/lib/data/ordersRepo";
import {
  listItems,
  listMovements,
  saveItems,
  saveMovements,
} from "@/lib/data/inventoryRepo";
import { deductForSale } from "@/lib/inventory";
import { addSale, createSale } from "@/lib/sales";
import { listSales, saveSales } from "@/lib/data/salesRepo";
import { listLots, saveLots } from "@/lib/data/brooderRepo";
import { deductBrooderLotsForSale } from "@/lib/brooder";
import NotifyButtons from "@/components/NotifyButtons";
import {
  describeNotifyResult,
  notifyFarmer,
} from "@/lib/notifyClient";
import {
  Badge,
  Button,
  Card,
  CardBody,
  EmptyState,
  Field,
  Input,
  orderStatusTone,
  PageHeader,
  PageSkeleton,
  Select,
} from "@/components/ui";

type Filter = OrderStatus | "all";

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<FarmerOrder[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [filter, setFilter] = useState<Filter>("pending");
  const [paymentRefs, setPaymentRefs] = useState<Record<string, string>>({});
  const [showManual, setShowManual] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notifyLog, setNotifyLog] = useState("");
  const [mName, setMName] = useState("");
  const [mPhone, setMPhone] = useState("");
  const [mLocation, setMLocation] = useState("");
  const [mProductId, setMProductId] = useState(ORDER_PRODUCTS[0].id);
  const [mQty, setMQty] = useState(50);

  const reload = useCallback(async () => {
    setOrders(await listOrders());
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const next = await listOrders();
        if (!cancelled) setOrders(next);
      } catch (err) {
        alert(err instanceof Error ? err.message : "Failed to load orders");
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const list =
      filter === "all" ? orders : orders.filter((o) => o.status === filter);
    return [...list].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }, [orders, filter]);

  const counts = useMemo(
    () => ({
      pending: orders.filter((o) => o.status === "pending").length,
      paid: orders.filter((o) => o.status === "paid").length,
      fulfilled: orders.filter((o) => o.status === "fulfilled").length,
      cancelled: orders.filter((o) => o.status === "cancelled").length,
    }),
    [orders]
  );

  const confirmPaid = async (order: FarmerOrder) => {
    if (order.status !== "pending") return;
    const ref = paymentRefs[order.id] || order.paymentRef;
    if (
      !window.confirm(
        `Mark PAID ${formatMoney(order.total)}?\nDeducts stock and logs a sale.`
      )
    )
      return;
    setBusyId(order.id);
    try {
      const byItem = new Map<string, number>();
      for (const line of order.items) {
        byItem.set(line.itemId, (byItem.get(line.itemId) ?? 0) + line.qty);
      }
      const items = await listItems();
      const movements = await listMovements();
      const result = deductForSale(
        items,
        movements,
        Array.from(byItem.entries()).map(([itemId, qty]) => ({ itemId, qty })),
        order.id
      );
      if (!result.ok) {
        alert(result.error ?? "Not enough stock");
        return;
      }
      await saveItems(result.items);
      await saveMovements(result.movements);

      // Deduct sold chicks from active brooder lots
      const activeLots = await listLots();
      const nextLots = deductBrooderLotsForSale(
        activeLots,
        Array.from(byItem.entries()).map(([itemId, qty]) => ({ itemId, qty }))
      );
      await saveLots(nextLots);

      const sale = createSale({
        id: `sale-from-${order.id}`,
        customer: order.customerName,
        customerPhone: order.customerPhone,
        items: order.items.map((i) => ({
          itemId: i.itemId,
          name: i.name,
          qty: i.qty,
          price: i.unitPrice,
        })),
        total: order.total,
        paymentMethod: "M-Pesa",
        mpesaCode: ref,
      });
      await saveSales(addSale(await listSales(), sale));

      const paid = markPaid(order, ref);
      await updateOrder(paid);
      await reload();
      setNotifyLog(describeNotifyResult(await notifyFarmer(paid, "payment_confirmed")));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to confirm payment");
    } finally {
      setBusyId(null);
    }
  };

  const fulfill = async (order: FarmerOrder) => {
    if (order.status !== "paid") return;
    setBusyId(order.id);
    try {
      const fulfilled = markFulfilled(order);
      await updateOrder(fulfilled);
      await reload();
      setNotifyLog(
        describeNotifyResult(await notifyFarmer(fulfilled, "ready_pickup"))
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to fulfill");
    } finally {
      setBusyId(null);
    }
  };

  const cancel = async (order: FarmerOrder) => {
    if (order.status === "fulfilled" || order.status === "cancelled") return;
    if (order.status === "paid") {
      if (
        !window.confirm(
          "Paid order — cancel without restocking? Fix stock in Inventory if needed."
        )
      )
        return;
    } else if (!window.confirm("Cancel this pending order?")) {
      return;
    }
    setBusyId(order.id);
    try {
      const cancelled = markCancelled(order);
      await updateOrder(cancelled);
      await reload();
      setNotifyLog(
        describeNotifyResult(await notifyFarmer(cancelled, "cancelled"))
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to cancel");
    } finally {
      setBusyId(null);
    }
  };

  const submitManual = async (e: React.FormEvent) => {
    e.preventDefault();
    const product = ORDER_PRODUCTS.find((p) => p.id === mProductId);
    if (!product || !mName.trim() || !mPhone.trim() || mQty <= 0) {
      alert("Name, phone, and qty required");
      return;
    }
    try {
      const order = createOrder({
        customerName: mName,
        customerPhone: mPhone,
        location: mLocation,
        items: [lineFromProduct(product, mQty)],
        source: "phone",
      });
      await insertOrder(order);
      setShowManual(false);
      setMName("");
      setMPhone("");
      setMLocation("");
      setMQty(50);
      await reload();
      setFilter("pending");
      setNotifyLog(
        describeNotifyResult(await notifyFarmer(order, "order_received"))
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to create order");
    }
  };

  if (!hydrated) return <PageSkeleton />;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <PageHeader
        title="Farmer orders"
        description="Confirm M-Pesa, notify farmers, fulfill pickups."
        actions={
          <>
            <Link href="/order" target="_blank">
              <Button variant="secondary" size="sm">
                Public form ↗
              </Button>
            </Link>
            <Button
              variant="gold"
              size="sm"
              onClick={() => setShowManual((v) => !v)}
            >
              {showManual ? "Close" : "+ Phone order"}
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {(
          [
            ["pending", counts.pending],
            ["paid", counts.paid],
            ["fulfilled", counts.fulfilled],
            ["cancelled", counts.cancelled],
          ] as const
        ).map(([key, n]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className="text-left"
          >
            <Card
              variant="metric"
              className={
                filter === key
                  ? "ring-2 ring-primary/30 border-primary/40"
                  : ""
              }
            >
              <CardBody className="!p-4">
                <p className="font-label-caps text-on-surface-variant">
                  {statusLabel(key)}
                </p>
                <p className="tabular-money text-2xl text-on-surface mt-1">
                  {n}
                </p>
              </CardBody>
            </Card>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={filter === "all" ? "primary" : "secondary"}
          onClick={() => setFilter("all")}
        >
          All ({orders.length})
        </Button>
        {notifyLog && (
          <p className="text-xs text-tertiary-container sm:ml-2">{notifyLog}</p>
        )}
      </div>

      {showManual && (
        <Card variant="inset">
          <CardBody>
            <form onSubmit={submitManual} className="space-y-4">
              <h3 className="font-semibold text-on-surface">
                Log phone / WhatsApp order
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Customer">
                  <Input
                    required
                    value={mName}
                    onChange={(e) => setMName(e.target.value)}
                  />
                </Field>
                <Field label="Phone">
                  <Input
                    required
                    value={mPhone}
                    onChange={(e) => setMPhone(e.target.value)}
                  />
                </Field>
                <Field label="Location">
                  <Input
                    value={mLocation}
                    onChange={(e) => setMLocation(e.target.value)}
                  />
                </Field>
                <Field label="Product">
                  <Select
                    value={mProductId}
                    onChange={(e) => setMProductId(e.target.value)}
                  >
                    {ORDER_PRODUCTS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} — {formatMoney(p.unitPrice)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Qty">
                  <Input
                    type="number"
                    min={1}
                    value={mQty}
                    onChange={(e) => setMQty(Number(e.target.value))}
                  />
                </Field>
              </div>
              <Button type="submit" variant="primary">
                Save as pending
              </Button>
            </form>
          </CardBody>
        </Card>
      )}

      {filtered.length === 0 ? (
        <EmptyState icon="shopping_bag" title="No orders here">
          Share{" "}
          <Link href="/order" className="text-primary font-medium">
            /order
          </Link>{" "}
          or log a phone order.
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {filtered.map((order) => (
            <Card key={order.id}>
              <CardBody className="space-y-3">
                <div className="flex flex-col sm:flex-row sm:justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-on-surface text-lg">
                        {order.customerName}
                      </h3>
                      <Badge tone={orderStatusTone(order.status)}>
                        {statusLabel(order.status)}
                      </Badge>
                      <span className="text-xs text-on-surface-variant">
                        {order.source}
                      </span>
                    </div>
                    <p className="text-sm text-on-surface-variant mt-1">
                      {order.customerPhone}
                      {order.location ? ` · ${order.location}` : ""}
                    </p>
                    <p className="text-xs text-on-surface-variant mt-0.5">
                      {new Date(order.createdAt).toLocaleString("en-KE")} ·{" "}
                      {order.id}
                    </p>
                  </div>
                  <p className="tabular-money text-xl text-secondary">
                    {formatMoney(order.total)}
                  </p>
                </div>

                <ul className="text-sm text-on-surface space-y-0.5">
                  {order.items.map((line, i) => (
                    <li key={i}>
                      {line.name} × {line.qty} @ {formatMoney(line.unitPrice)}
                    </li>
                  ))}
                </ul>

                {order.notes && (
                  <p className="text-sm text-on-surface-variant">
                    Note: {order.notes}
                  </p>
                )}
                {order.paymentRef && (
                  <p className="text-sm text-tertiary-container">
                    M-Pesa: {order.paymentRef}
                  </p>
                )}

                {order.status === "pending" && (
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Input
                      placeholder="M-Pesa code (optional)"
                      value={paymentRefs[order.id] ?? ""}
                      onChange={(e) =>
                        setPaymentRefs((prev) => ({
                          ...prev,
                          [order.id]: e.target.value,
                        }))
                      }
                    />
                    <Button
                      variant="success"
                      disabled={busyId === order.id}
                      onClick={() => confirmPaid(order)}
                      className="shrink-0"
                    >
                      Confirm paid
                    </Button>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  {order.status === "paid" && (
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={busyId === order.id}
                      onClick={() => fulfill(order)}
                    >
                      Mark ready + notify
                    </Button>
                  )}
                  {(order.status === "pending" || order.status === "paid") && (
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={busyId === order.id}
                      onClick={() => cancel(order)}
                      className="sm:ml-auto"
                    >
                      Cancel + notify
                    </Button>
                  )}
                </div>

                <div className="pt-1 border-t border-outline-variant/40">
                  <NotifyButtons order={order} />
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
