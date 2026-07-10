"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Nav from "@/components/Nav";
import {
  type InventoryCategory,
  type InventoryItem,
  type MovementType,
  type StockMovement,
  addCustomItem,
  applyStockChange,
  categoryLabel,
  deleteItem,
  formatMovementType,
  getLowStockItems,
  isLowStock,
  setAbsoluteQuantity,
  updateItemMeta,
} from "@/lib/inventory";
import {
  listItems,
  listMovements,
  saveItems,
  saveMovements,
} from "@/lib/data/inventoryRepo";

type Tab = "stock" | "history";

export default function InventoryPage() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [tab, setTab] = useState<Tab>("stock");
  const [categoryFilter, setCategoryFilter] = useState<"all" | InventoryCategory>("all");

  const [adjustId, setAdjustId] = useState<string | null>(null);
  const [adjustMode, setAdjustMode] = useState<"in" | "out" | "set" | "loss">("in");
  const [adjustQty, setAdjustQty] = useState(0);
  const [adjustNote, setAdjustNote] = useState("");

  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState<InventoryCategory>("other");
  const [newQty, setNewQty] = useState(0);
  const [newUnit, setNewUnit] = useState("units");
  const [newPrice, setNewPrice] = useState(0);
  const [newLow, setNewLow] = useState(5);
  const [newSellable, setNewSellable] = useState(true);

  const [editId, setEditId] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState(0);
  const [editLow, setEditLow] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [nextItems, nextMovements] = await Promise.all([
          listItems(),
          listMovements(),
        ]);
        if (cancelled) return;
        setItems(nextItems);
        setMovements(nextMovements);
      } catch (err) {
        console.error(err);
        alert(err instanceof Error ? err.message : "Failed to load inventory");
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback(
    async (nextItems: InventoryItem[], nextMovements?: StockMovement[]) => {
      setItems(nextItems);
      try {
        await saveItems(nextItems);
        if (nextMovements) {
          setMovements(nextMovements);
          await saveMovements(nextMovements);
        }
      } catch (err) {
        alert(err instanceof Error ? err.message : "Failed to save inventory");
      }
    },
    []
  );

  const filtered = useMemo(() => {
    const list =
      categoryFilter === "all"
        ? items
        : items.filter((i) => i.category === categoryFilter);
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [items, categoryFilter]);

  const lowStock = useMemo(() => getLowStockItems(items), [items]);
  const totalBirds = useMemo(
    () =>
      items
        .filter((i) => i.category === "livestock")
        .reduce((s, i) => s + i.quantity, 0),
    [items]
  );

  const openAdjust = (item: InventoryItem, mode: "in" | "out" | "set" | "loss" = "in") => {
    setAdjustId(item.id);
    setAdjustMode(mode);
    setAdjustQty(mode === "set" ? item.quantity : 0);
    setAdjustNote("");
    setEditId(null);
  };

  const confirmAdjust = () => {
    if (!adjustId) return;
    const qty = Math.floor(adjustQty);
    if (qty < 0 || (adjustMode !== "set" && qty === 0)) {
      alert("Enter a valid quantity.");
      return;
    }

    let result;
    if (adjustMode === "set") {
      result = setAbsoluteQuantity(items, movements, adjustId, qty, adjustNote || undefined);
    } else if (adjustMode === "in") {
      result = applyStockChange(items, movements, {
        itemId: adjustId,
        delta: qty,
        type: "in",
        note: adjustNote || "Stock received",
      });
    } else if (adjustMode === "out") {
      result = applyStockChange(items, movements, {
        itemId: adjustId,
        delta: -qty,
        type: "out",
        note: adjustNote || "Stock removed",
      });
    } else {
      result = applyStockChange(items, movements, {
        itemId: adjustId,
        delta: -qty,
        type: "loss",
        note: adjustNote || "Loss / mortality",
      });
    }

    if (!result.ok) {
      alert(result.error ?? "Could not update stock");
      return;
    }
    persist(result.items, result.movements);
    setAdjustId(null);
  };

  const openEdit = (item: InventoryItem) => {
    setEditId(item.id);
    setEditPrice(item.defaultPrice);
    setEditLow(item.lowStockAt);
    setAdjustId(null);
  };

  const confirmEdit = () => {
    if (!editId) return;
    const next = updateItemMeta(items, editId, {
      defaultPrice: editPrice,
      lowStockAt: editLow,
    });
    persist(next);
    setEditId(null);
  };

  const handleAddItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    const { items: next, item } = addCustomItem(items, {
      name: newName,
      category: newCategory,
      quantity: newQty,
      unit: newUnit,
      defaultPrice: newPrice,
      lowStockAt: newLow,
      sellable: newSellable,
    });
    // Quantity already set on the item — log opening stock without double-counting
    const nextMovements =
      newQty > 0
        ? [
            {
              id: `mov-${Date.now()}-open`,
              itemId: item.id,
              itemName: item.name,
              type: "in" as MovementType,
              delta: newQty,
              balanceAfter: newQty,
              note: "Opening stock",
              createdAt: new Date().toISOString(),
            },
            ...movements,
          ].slice(0, 500)
        : movements;
    persist(next, nextMovements);
    setShowAdd(false);
    setNewName("");
    setNewQty(0);
    setNewUnit("units");
    setNewPrice(0);
    setNewLow(5);
    setNewSellable(true);
    setNewCategory("other");
  };

  const handleDelete = (item: InventoryItem) => {
    if (!window.confirm(`Delete "${item.name}" from inventory?`)) return;
    const result = deleteItem(items, item.id);
    if (!result.ok) {
      alert(result.error);
      return;
    }
    persist(result.items);
  };

  if (!hydrated) {
    return (
      <div className="max-w-5xl mx-auto">
        <Nav />
        <p className="text-on-surface-variant">Loading inventory…</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <Nav />

      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 border-b border-outline-variant pb-6">
        <div>
          <h2 className="text-3xl font-bold text-on-surface">Inventory</h2>
          <p className="text-on-surface-variant mt-1">
            Stock levels, adjustments, and movement history
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowAdd((v) => !v)}
          className="bg-secondary-container text-on-secondary-container hover:opacity-90 px-6 py-3 rounded-2xl font-medium transition"
        >
          {showAdd ? "Cancel" : "+ Custom item"}
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="farm-card p-5 rounded-3xl border border-outline-variant">
          <p className="text-sm text-error font-medium">Total livestock</p>
          <p className="text-3xl font-bold text-on-surface mt-2">
            {totalBirds.toLocaleString()}
          </p>
        </div>
        <div className="farm-card p-5 rounded-3xl border border-outline-variant">
          <p className="text-sm text-secondary font-medium">SKU count</p>
          <p className="text-3xl font-bold text-on-surface mt-2">{items.length}</p>
        </div>
        <div className="farm-card p-5 rounded-3xl border border-outline-variant col-span-2 lg:col-span-1">
          <p className="text-sm text-secondary font-medium">Low stock alerts</p>
          <p className="text-3xl font-bold text-on-surface mt-2">{lowStock.length}</p>
        </div>
      </div>

      {lowStock.length > 0 && (
        <div className="rounded-2xl border border-amber-900/50 bg-amber-950/30 px-4 py-3 text-sm text-on-secondary-container">
          Low stock:{" "}
          {lowStock.map((i) => `${i.name} (${i.quantity})`).join(" · ")}
        </div>
      )}

      {showAdd && (
        <form
          onSubmit={handleAddItem}
          className="farm-card p-6 rounded-3xl border border-outline-variant space-y-4"
        >
          <h3 className="text-lg font-semibold text-on-surface">Add custom item</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="block space-y-1">
              <span className="text-sm text-on-surface-variant">Name</span>
              <input
                required
                className="w-full bg-surface-container-highest p-3 rounded-2xl text-on-surface"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Grower feed (50kg)"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-sm text-on-surface-variant">Category</span>
              <select
                className="w-full bg-surface-container-highest p-3 rounded-2xl text-on-surface"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value as InventoryCategory)}
              >
                <option value="livestock">Livestock</option>
                <option value="eggs">Eggs</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-sm text-on-surface-variant">Opening qty</span>
              <input
                type="number"
                min={0}
                className="w-full bg-surface-container-highest p-3 rounded-2xl text-on-surface"
                value={newQty}
                onChange={(e) => setNewQty(Number(e.target.value))}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-sm text-on-surface-variant">Unit</span>
              <input
                className="w-full bg-surface-container-highest p-3 rounded-2xl text-on-surface"
                value={newUnit}
                onChange={(e) => setNewUnit(e.target.value)}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-sm text-on-surface-variant">Default price (KSh)</span>
              <input
                type="number"
                min={0}
                className="w-full bg-surface-container-highest p-3 rounded-2xl text-on-surface"
                value={newPrice}
                onChange={(e) => setNewPrice(Number(e.target.value))}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-sm text-on-surface-variant">Low stock at</span>
              <input
                type="number"
                min={0}
                className="w-full bg-surface-container-highest p-3 rounded-2xl text-on-surface"
                value={newLow}
                onChange={(e) => setNewLow(Number(e.target.value))}
              />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm text-on-surface">
            <input
              type="checkbox"
              checked={newSellable}
              onChange={(e) => setNewSellable(e.target.checked)}
            />
            Sellable on Sales page
          </label>
          <button
            type="submit"
            className="bg-primary hover:bg-primary/90 px-6 py-3 rounded-2xl font-semibold"
          >
            Save item
          </button>
        </form>
      )}

      {/* Tabs + filters */}
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex gap-2">
          {(
            [
              ["stock", "Stock"],
              ["history", "History"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition ${
                tab === key
                  ? "bg-primary-container text-on-primary"
                  : "bg-surface-container-highest text-on-surface hover:bg-surface-container-high"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === "stock" && (
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["all", "All"],
                ["livestock", "Livestock"],
                ["eggs", "Eggs"],
                ["other", "Other"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setCategoryFilter(key)}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium transition ${
                  categoryFilter === key
                    ? "bg-secondary-container text-on-secondary-container text-on-surface"
                    : "bg-surface-container-highest text-on-surface-variant hover:bg-surface-container-high"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {tab === "stock" ? (
        <div className="space-y-3">
          {filtered.map((item) => (
            <article
              key={item.id}
              className="farm-card rounded-3xl p-5 border border-outline-variant space-y-3"
            >
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-semibold text-on-surface">{item.name}</h3>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-surface-container-highest text-on-surface-variant">
                      {categoryLabel(item.category)}
                    </span>
                    {item.sellable && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-900/40 text-emerald-300">
                        Sellable
                      </span>
                    )}
                    {isLowStock(item) && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-900/50 text-secondary">
                        Low stock
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-on-surface-variant mt-1">
                    Unit: {item.unit}
                    {item.defaultPrice > 0 && (
                      <> · Default KSh {item.defaultPrice.toLocaleString()}</>
                    )}
                    <> · Alert ≤ {item.lowStockAt}</>
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-4xl font-bold text-on-surface">
                    {item.quantity.toLocaleString()}
                  </p>
                  <p className="text-xs text-on-surface-variant">{item.unit}</p>
                </div>
              </div>

              {adjustId === item.id && (
                <div className="bg-surface-container-low rounded-2xl p-4 border border-outline-variant space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {(
                      [
                        ["in", "Stock in"],
                        ["out", "Stock out"],
                        ["loss", "Loss"],
                        ["set", "Set qty"],
                      ] as const
                    ).map(([mode, label]) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => {
                          setAdjustMode(mode);
                          setAdjustQty(mode === "set" ? item.quantity : 0);
                        }}
                        className={`px-3 py-1.5 rounded-xl text-xs font-medium ${
                          adjustMode === mode
                            ? "bg-secondary-container text-on-secondary-container text-on-surface"
                            : "bg-surface-container-highest text-on-surface"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <label className="block space-y-1">
                    <span className="text-sm text-on-surface-variant">
                      {adjustMode === "set" ? "New quantity" : "Quantity"}
                    </span>
                    <input
                      type="number"
                      min={0}
                      className="w-full bg-surface-container-highest p-3 rounded-xl text-on-surface"
                      value={adjustQty}
                      onChange={(e) => setAdjustQty(Number(e.target.value))}
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-sm text-on-surface-variant">Note (optional)</span>
                    <input
                      className="w-full bg-surface-container-highest p-3 rounded-xl text-on-surface"
                      value={adjustNote}
                      onChange={(e) => setAdjustNote(e.target.value)}
                      placeholder="Supplier, mortality reason…"
                    />
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={confirmAdjust}
                      className="bg-primary hover:bg-primary/90 px-5 py-2 rounded-xl font-medium"
                    >
                      Apply
                    </button>
                    <button
                      type="button"
                      onClick={() => setAdjustId(null)}
                      className="bg-surface-container-high hover:bg-surface-variant px-5 py-2 rounded-xl"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {editId === item.id && (
                <div className="bg-surface-container-low rounded-2xl p-4 border border-outline-variant space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="block space-y-1">
                      <span className="text-sm text-on-surface-variant">Default price (KSh)</span>
                      <input
                        type="number"
                        min={0}
                        className="w-full bg-surface-container-highest p-3 rounded-xl text-on-surface"
                        value={editPrice}
                        onChange={(e) => setEditPrice(Number(e.target.value))}
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-sm text-on-surface-variant">Low stock threshold</span>
                      <input
                        type="number"
                        min={0}
                        className="w-full bg-surface-container-highest p-3 rounded-xl text-on-surface"
                        value={editLow}
                        onChange={(e) => setEditLow(Number(e.target.value))}
                      />
                    </label>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={confirmEdit}
                      className="bg-primary hover:bg-primary/90 px-5 py-2 rounded-xl font-medium"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditId(null)}
                      className="bg-surface-container-high hover:bg-surface-variant px-5 py-2 rounded-xl"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => openAdjust(item, "in")}
                  className="bg-surface-container-highest hover:bg-surface-container-high px-4 py-2 rounded-xl text-sm"
                >
                  Adjust stock
                </button>
                <button
                  type="button"
                  onClick={() => openEdit(item)}
                  className="bg-surface-container-highest hover:bg-surface-container-high px-4 py-2 rounded-xl text-sm"
                >
                  Edit settings
                </button>
                {!item.system && (
                  <button
                    type="button"
                    onClick={() => handleDelete(item)}
                    className="bg-surface-container-lowest hover:bg-surface-container-highest border border-outline-variant px-4 py-2 rounded-xl text-sm text-error ml-auto"
                  >
                    Delete
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="farm-card rounded-3xl border border-outline-variant overflow-hidden">
          {movements.length === 0 ? (
            <p className="p-8 text-center text-on-surface-variant">
              No stock movements yet. Adjust inventory or record a sale/hatch.
            </p>
          ) : (
            <div className="divide-y divide-outline-variant">
              {movements.slice(0, 100).map((m) => (
                <div
                  key={m.id}
                  className="px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
                >
                  <div>
                    <p className="font-medium text-on-surface">{m.itemName}</p>
                    <p className="text-sm text-on-surface-variant">
                      {formatMovementType(m.type)}
                      {m.note ? ` · ${m.note}` : ""}
                    </p>
                    <p className="text-xs text-on-surface-variant mt-0.5">
                      {new Date(m.createdAt).toLocaleString("en-KE")}
                    </p>
                  </div>
                  <div className="text-right">
                    <p
                      className={`text-lg font-semibold ${
                        m.delta >= 0 ? "text-tertiary-container" : "text-error"
                      }`}
                    >
                      {m.delta >= 0 ? "+" : ""}
                      {m.delta}
                    </p>
                    <p className="text-xs text-on-surface-variant">Bal: {m.balanceAfter}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
