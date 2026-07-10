"use client";

import { useEffect, useMemo, useState } from "react";
import {
  type InventoryItem,
  deductForSale,
  getSellableItems,
} from "@/lib/inventory";
import {
  type Sale,
  type SalePaymentMethod,
  addSale,
  availableSaleMonths,
  createSale,
  deleteSale,
  filterSalesByMonth,
  formatMonthLabel,
  lineCount,
  monthKeyFromDate,
  sumSales,
} from "@/lib/sales";
import { generateReceiptPdf } from "@/lib/receipt";
import { downloadSalesReportPdf } from "@/lib/salesReport";
import { PAYMENT_METHODS } from "@/lib/brand";
import {
  listItems,
  listMovements,
  saveItems,
  saveMovements,
} from "@/lib/data/inventoryRepo";
import { listSales, saveSales } from "@/lib/data/salesRepo";
import {
  Button,
  Card,
  CardBody,
  EmptyState,
  Field,
  Input,
  PageHeader,
  PageSkeleton,
  Select,
} from "@/components/ui";
import Tabs from "@/components/ui/Tabs";

interface CartItem {
  id: number;
  itemId: string;
  name: string;
  qty: number;
  price: number;
}

type Tab = "record" | "history";

export default function Sales() {
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [tab, setTab] = useState<Tab>("record");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [qty, setQty] = useState(1);
  const [price, setPrice] = useState(0);
  const [customer, setCustomer] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [paymentMethod, setPaymentMethod] =
    useState<SalePaymentMethod>("Cash");
  const [mpesaCode, setMpesaCode] = useState("");
  const [servedBy, setServedBy] = useState("");
  const [receiptBusy, setReceiptBusy] = useState(false);
  const [monthFilter, setMonthFilter] = useState(monthKeyFromDate());
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [items, nextSales] = await Promise.all([listItems(), listSales()]);
        if (cancelled) return;
        setInventory(items);
        setSales(nextSales);
        const sellable = getSellableItems(items);
        if (sellable.length > 0) {
          setSelectedId(sellable[0].id);
          setPrice(sellable[0].defaultPrice);
          setQty(Math.min(50, Math.max(1, sellable[0].quantity || 1)));
        }
      } catch (err) {
        alert(err instanceof Error ? err.message : "Failed to load sales data");
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const sellable = useMemo(() => getSellableItems(inventory), [inventory]);
  const selected = sellable.find((i) => i.id === selectedId) ?? sellable[0];

  const cartReserved = useMemo(() => {
    const map = new Map<string, number>();
    for (const line of cart) {
      map.set(line.itemId, (map.get(line.itemId) ?? 0) + line.qty);
    }
    return map;
  }, [cart]);

  const availableForSelected = selected
    ? selected.quantity - (cartReserved.get(selected.id) ?? 0)
    : 0;

  const total = cart.reduce((sum, item) => sum + item.qty * item.price, 0);
  const months = useMemo(() => availableSaleMonths(sales), [sales]);
  const filteredSales = useMemo(
    () => filterSalesByMonth(sales, monthFilter),
    [sales, monthFilter]
  );
  const monthTotal = useMemo(() => sumSales(filteredSales), [filteredSales]);
  const allTimeTotal = useMemo(() => sumSales(sales), [sales]);

  const onSelectItem = (itemId: string) => {
    setSelectedId(itemId);
    const item = sellable.find((i) => i.id === itemId);
    if (item) {
      setPrice(item.defaultPrice);
      const avail = item.quantity - (cartReserved.get(item.id) ?? 0);
      setQty(Math.min(50, Math.max(1, avail || 1)));
    }
  };

  const addToCart = () => {
    if (!selected) return alert("No sellable inventory items.");
    if (qty <= 0) return alert("Quantity must be greater than zero.");
    if (qty > availableForSelected) {
      return alert(
        `Only ${availableForSelected} ${selected.name} available (after cart).`
      );
    }
    setCart([
      ...cart,
      {
        id: Date.now(),
        itemId: selected.id,
        name: selected.name,
        qty,
        price,
      },
    ]);
    setQty(1);
  };

  const recordSale = async () => {
    if (cart.length === 0) return alert("Cart is empty");
    const saleId = `sale-${Date.now()}`;
    try {
      const items = await listItems();
      const movements = await listMovements();
      const result = deductForSale(
        items,
        movements,
        cart.map((c) => ({ itemId: c.itemId, qty: c.qty })),
        saleId
      );
      if (!result.ok) {
        alert(result.error ?? "Could not deduct stock");
        setInventory(await listItems());
        return;
      }
      await saveItems(result.items);
      await saveMovements(result.movements);
      setInventory(result.items);

      const sale = createSale({
        id: saleId,
        customer,
        customerPhone,
        items: cart.map((c) => ({
          itemId: c.itemId,
          name: c.name,
          qty: c.qty,
          price: c.price,
        })),
        total,
        paymentMethod,
        mpesaCode: paymentMethod === "M-Pesa" ? mpesaCode : "",
        servedBy,
      });

      const nextSales = addSale(sales, sale);
      await saveSales(nextSales);
      setSales(nextSales);

      setReceiptBusy(true);
      try {
        await generateReceiptPdf(sale, {
          openWhatsApp: Boolean(sale.customerPhone),
        });
      } finally {
        setReceiptBusy(false);
      }

      setCart([]);
      setCustomer("");
      setCustomerPhone("");
      setMpesaCode("");
      setMonthFilter(monthKeyFromDate());
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to record sale");
    }
  };

  const reprint = async (sale: Sale, withWhatsApp = false) => {
    setReceiptBusy(true);
    try {
      await generateReceiptPdf(sale, { openWhatsApp: withWhatsApp });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Could not generate receipt");
    } finally {
      setReceiptBusy(false);
    }
  };

  if (!hydrated) return <PageSkeleton />;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <PageHeader
        title="Sales & receipts"
        description="Record sales, print branded slips, export monthly reports."
        actions={
          <Tabs
            tabs={[
              { id: "record", label: "Record" },
              { id: "history", label: "History" },
            ]}
            value={tab}
            onChange={setTab}
          />
        }
      />

      {tab === "record" ? (
        <>
          <Card variant="inset">
            <CardBody className="space-y-4">
              <h3 className="font-semibold text-on-surface">Add to cart</h3>
              {sellable.length === 0 ? (
                <p className="text-sm text-on-surface-variant">
                  No sellable items — add stock in Inventory first.
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <Field label="Product" className="sm:col-span-2 lg:col-span-1">
                    <Select
                      value={selected?.id ?? ""}
                      onChange={(e) => onSelectItem(e.target.value)}
                    >
                      {sellable.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} ({item.quantity})
                        </option>
                      ))}
                    </Select>
                    {selected && (
                      <p className="text-xs text-on-surface-variant mt-1">
                        Available: {availableForSelected} {selected.unit}
                      </p>
                    )}
                  </Field>
                  <Field label="Qty">
                    <Input
                      type="number"
                      min={1}
                      value={qty}
                      onChange={(e) => setQty(Number(e.target.value))}
                    />
                  </Field>
                  <Field label="Unit price (KSh)">
                    <Input
                      type="number"
                      min={0}
                      value={price}
                      onChange={(e) => setPrice(Number(e.target.value))}
                    />
                  </Field>
                  <div className="flex items-end">
                    <Button
                      variant="gold"
                      className="w-full"
                      onClick={addToCart}
                    >
                      Add
                    </Button>
                  </div>
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardBody className="space-y-4">
              <h3 className="font-semibold text-on-surface">
                Cart · {cart.length} line{cart.length === 1 ? "" : "s"}
              </h3>
              {cart.length === 0 ? (
                <p className="text-sm text-on-surface-variant">Cart is empty.</p>
              ) : (
                <ul className="divide-y divide-outline-variant/50">
                  {cart.map((item) => (
                    <li
                      key={item.id}
                      className="flex justify-between py-3 text-sm text-on-surface"
                    >
                      <span>
                        {item.name} × {item.qty}
                      </span>
                      <span className="tabular-money">
                        KSh {(item.qty * item.price).toLocaleString()}{" "}
                        <button
                          type="button"
                          className="text-error ml-3 text-xs font-medium"
                          onClick={() =>
                            setCart(cart.filter((c) => c.id !== item.id))
                          }
                        >
                          Remove
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                <Field label="Customer">
                  <Input
                    value={customer}
                    onChange={(e) => setCustomer(e.target.value)}
                    placeholder="Name"
                  />
                </Field>
                <Field label="Phone">
                  <Input
                    type="tel"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="07…"
                  />
                </Field>
                <Field label="Payment">
                  <Select
                    value={paymentMethod}
                    onChange={(e) =>
                      setPaymentMethod(e.target.value as SalePaymentMethod)
                    }
                  >
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Served by">
                  <Input
                    value={servedBy}
                    onChange={(e) => setServedBy(e.target.value)}
                    placeholder="Staff name"
                  />
                </Field>
                {paymentMethod === "M-Pesa" && (
                  <Field label="M-Pesa code" className="sm:col-span-2">
                    <Input
                      value={mpesaCode}
                      onChange={(e) => setMpesaCode(e.target.value)}
                      placeholder="e.g. QHG7…"
                    />
                  </Field>
                )}
              </div>

              <div className="pt-4 border-t border-outline-variant/50 text-center space-y-4">
                <p className="tabular-money text-3xl text-on-surface">
                  Total KSh {total.toLocaleString()}
                </p>
                <Button
                  size="lg"
                  className="w-full sm:w-auto min-w-[240px]"
                  disabled={receiptBusy}
                  onClick={recordSale}
                >
                  {receiptBusy
                    ? "Generating receipt…"
                    : "Record sale & receipt"}
                </Button>
              </div>
            </CardBody>
          </Card>
        </>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Card variant="metric">
              <CardBody>
                <p className="font-label-caps text-tertiary-container">
                  {formatMonthLabel(monthFilter)}
                </p>
                <p className="tabular-money text-2xl text-on-surface mt-2">
                  KSh {monthTotal.toLocaleString()}
                </p>
                <p className="text-xs text-on-surface-variant mt-1">
                  {filteredSales.length} sale
                  {filteredSales.length === 1 ? "" : "s"}
                </p>
              </CardBody>
            </Card>
            <Card variant="metric">
              <CardBody>
                <p className="font-label-caps text-secondary">All time</p>
                <p className="tabular-money text-2xl text-on-surface mt-2">
                  KSh {allTimeTotal.toLocaleString()}
                </p>
              </CardBody>
            </Card>
            <Card>
              <CardBody className="space-y-3">
                <Field label="Month">
                  <Select
                    value={monthFilter}
                    onChange={(e) => setMonthFilter(e.target.value)}
                  >
                    {months.map((m) => (
                      <option key={m} value={m}>
                        {formatMonthLabel(m)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Button
                  variant="gold"
                  className="w-full"
                  disabled={receiptBusy || filteredSales.length === 0}
                  onClick={async () => {
                    setReceiptBusy(true);
                    try {
                      await downloadSalesReportPdf({
                        sales: filteredSales,
                        monthKey: monthFilter,
                      });
                    } catch (err) {
                      alert(
                        err instanceof Error
                          ? err.message
                          : "Could not generate report"
                      );
                    } finally {
                      setReceiptBusy(false);
                    }
                  }}
                >
                  Export report PDF
                </Button>
              </CardBody>
            </Card>
          </div>

          {filteredSales.length === 0 ? (
            <EmptyState icon="receipt_long" title="No sales this month">
              Switch to Record to log a sale.
            </EmptyState>
          ) : (
            <div className="space-y-3">
              {filteredSales.map((sale) => (
                <Card key={sale.id}>
                  <CardBody className="space-y-3">
                    <div className="flex flex-col sm:flex-row sm:justify-between gap-2">
                      <div>
                        <p className="font-semibold text-on-surface">
                          {sale.customer || "Walk-in customer"}
                        </p>
                        <p className="text-sm text-on-surface-variant">
                          {sale.dateLabel}
                          {sale.paymentMethod
                            ? ` · ${sale.paymentMethod}`
                            : ""}
                        </p>
                        <p className="text-xs text-on-surface-variant mt-0.5">
                          {lineCount(sale)} items
                          {sale.receiptNumber
                            ? ` · ${sale.receiptNumber}`
                            : ""}
                        </p>
                      </div>
                      <p className="tabular-money text-xl text-tertiary-container">
                        KSh {sale.total.toLocaleString()}
                      </p>
                    </div>
                    {expandedId === sale.id && (
                      <div className="rounded-xl bg-surface-container-low border border-outline-variant/50 p-3 space-y-1.5 text-sm">
                        {sale.items.map((line, idx) => (
                          <div
                            key={idx}
                            className="flex justify-between text-on-surface"
                          >
                            <span>
                              {line.name} × {line.qty}
                            </span>
                            <span className="tabular-money">
                              KSh {(line.qty * line.price).toLocaleString()}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          setExpandedId(
                            expandedId === sale.id ? null : sale.id
                          )
                        }
                      >
                        {expandedId === sale.id ? "Hide" : "Items"}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={receiptBusy}
                        onClick={() => reprint(sale)}
                      >
                        Reprint PDF
                      </Button>
                      {sale.customerPhone && (
                        <Button
                          size="sm"
                          variant="success"
                          disabled={receiptBusy}
                          onClick={() => reprint(sale, true)}
                        >
                          WhatsApp
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="sm:ml-auto text-error"
                        onClick={async () => {
                          if (
                            !window.confirm(
                              "Delete history only? Stock is not restored."
                            )
                          )
                            return;
                          const next = deleteSale(sales, sale.id);
                          await saveSales(next);
                          setSales(next);
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  </CardBody>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
