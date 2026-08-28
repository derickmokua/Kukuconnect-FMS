"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
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
  saleDateYmd,
  sumSales,
  updateSaleDate,
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
import { listSalesPaginated, updateSale, deleteSaleCloud } from "@/lib/data/salesRepo";
import { listLots, saveLots } from "@/lib/data/brooderRepo";
import { recordSaleTransaction } from "@/lib/data/transactions";
import { deductBrooderLotsForSale, todayIsoLocal } from "@/lib/brooder";
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
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [searchQuery, setSearchQuery] = useState("");
  const [totalCount, setTotalCount] = useState(0);

  const [saleDate, setSaleDate] = useState(todayIsoLocal());
  const [editDateSaleId, setEditDateSaleId] = useState<string | null>(null);
  const [editDateValue, setEditDateValue] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const items = await listItems();
        if (cancelled) return;
        setInventory(items);
        const sellable = getSellableItems(items);
        if (sellable.length > 0) {
          setSelectedId(sellable[0].id);
          setPrice(sellable[0].defaultPrice);
          setQty(Math.min(50, Math.max(1, sellable[0].quantity || 1)));
        }
      } catch (err) {
        alert(err instanceof Error ? err.message : "Failed to load inventory");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadData = useCallback(async () => {
    try {
      const { data, count } = await listSalesPaginated(page, pageSize, searchQuery);
      setSales(data);
      setTotalCount(count);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to load sales data");
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
  const pageTotal = useMemo(() => sumSales(sales), [sales]);

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
    const saleCreatedAt = new Date(saleDate + "T12:00:00").toISOString();
    try {
      const items = await listItems();
      const fullCart = cart.map((c) => {
        const item = items.find((i) => i.id === c.itemId);
        const isDiscounted = item ? c.price < item.defaultPrice : false;
        return { ...c, isDiscounted };
      });

      const sale = createSale({
        id: saleId,
        customer,
        customerPhone,
        items: fullCart.map((c) => ({
          itemId: c.itemId,
          name: c.name,
          qty: c.qty,
          price: c.price,
        })),
        total,
        paymentMethod,
        mpesaCode: paymentMethod === "M-Pesa" ? mpesaCode : "",
        servedBy,
        createdAt: saleCreatedAt,
        dateLabel: new Date(saleCreatedAt).toLocaleString("en-KE"),
      });

      await recordSaleTransaction(sale, fullCart);

      setInventory(await listItems());
      loadData();

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
      setSaleDate(todayIsoLocal());
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to record sale");
    }
  };

  const handleSaveSaleDate = async (saleId: string) => {
    if (!editDateValue) return;
    try {
      const nextSales = updateSaleDate(sales, saleId, editDateValue);
      setSales(nextSales);
      const updatedSale = nextSales.find(s => s.id === saleId);
      if (updatedSale) {
        await updateSale(updatedSale);
      }

      // Keep stock movement history aligned with the corrected business date
      const when = new Date(editDateValue + "T12:00:00").toISOString();
      const movements = await listMovements();
      const nextMovements = movements.map((m) =>
        m.refId === saleId && m.type === "sale"
          ? { ...m, createdAt: when }
          : m
      );
      await saveMovements(nextMovements);

      setEditDateSaleId(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save sale date");
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
                <Field label="Sale Date">
                  <Input
                    type="date"
                    required
                    value={saleDate}
                    onChange={(e) => setSaleDate(e.target.value)}
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Card variant="metric">
              <CardBody>
                <p className="font-label-caps text-tertiary-container">Page Total</p>
                <p className="tabular-money text-2xl text-on-surface mt-2">
                  KSh {pageTotal.toLocaleString()}
                </p>
                <p className="text-xs text-on-surface-variant mt-1">
                  {sales.length} sale{sales.length === 1 ? "" : "s"}
                </p>
              </CardBody>
            </Card>
            <Card>
              <CardBody className="space-y-3">
                <Field label="Search Sales">
                  <Input
                    placeholder="Search by customer or receipt..."
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setPage(1);
                    }}
                  />
                </Field>
                <Button
                  variant="gold"
                  className="w-full"
                  disabled={receiptBusy || sales.length === 0}
                  onClick={async () => {
                    setReceiptBusy(true);
                    try {
                      await downloadSalesReportPdf({
                        sales: sales,
                        monthKey: "Current Page",
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

          {sales.length === 0 ? (
            <EmptyState icon="receipt_long" title="No sales found">
              Adjust search or switch to Record to log a sale.
            </EmptyState>
          ) : (
            <div className="space-y-3">
              {sales.map((sale) => (
                <Card key={sale.id}>
                  <CardBody className="space-y-3">
                    <div className="flex flex-col sm:flex-row sm:justify-between gap-2">
                      <div>
                        <p className="font-semibold text-on-surface">
                          {sale.customer || "Walk-in customer"}
                        </p>
                        <div className="text-sm text-on-surface-variant flex flex-wrap items-center gap-1.5">
                          {editDateSaleId === sale.id ? (
                            <span className="flex items-center gap-1.5">
                              <input
                                type="date"
                                value={editDateValue}
                                onChange={(e) => setEditDateValue(e.target.value)}
                                className="bg-surface-container-highest text-on-surface rounded px-2 py-0.5 text-xs border border-outline-variant focus:outline-none"
                              />
                              <button
                                type="button"
                                className="text-primary text-xs font-semibold hover:underline"
                                onClick={() => handleSaveSaleDate(sale.id)}
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                className="text-on-surface-variant text-xs hover:underline"
                                onClick={() => setEditDateSaleId(null)}
                              >
                                Cancel
                              </button>
                            </span>
                          ) : (
                            <>
                              <span>{sale.dateLabel}</span>
                              <button
                                type="button"
                                className="text-primary text-[11px] font-medium hover:underline opacity-80 hover:opacity-100 flex items-center gap-0.5"
                                onClick={() => {
                                  setEditDateSaleId(sale.id);
                                  setEditDateValue(
                                    saleDateYmd(sale) || sale.createdAt.slice(0, 10)
                                  );
                                }}
                              >
                                <span className="material-symbols-outlined text-[12px]">edit</span>
                                edit date
                              </button>
                            </>
                          )}
                          {sale.paymentMethod
                            ? ` · ${sale.paymentMethod}`
                            : ""}
                        </div>
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
                          try {
                            await deleteSaleCloud(sale.id);
                          } catch (e) {
                            console.error("Failed to delete sale from cloud", e);
                          }
                          setSales(next);
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  </CardBody>
                </Card>
              ))}
              {totalCount > pageSize && (
                <div className="flex justify-between items-center py-4">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-4 py-2 bg-surface-container-highest rounded-xl disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <span className="text-sm text-on-surface-variant">
                    Page {page} of {Math.ceil(totalCount / pageSize)} ({totalCount} total)
                  </span>
                  <button
                    onClick={() => setPage((p) => p + 1)}
                    disabled={page >= Math.ceil(totalCount / pageSize)}
                    className="px-4 py-2 bg-surface-container-highest rounded-xl disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
