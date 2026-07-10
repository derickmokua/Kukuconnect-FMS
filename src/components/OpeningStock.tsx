"use client";

import { useState } from "react";
import {
  listItems,
  listMovements,
  saveItems,
  saveMovements,
} from "@/lib/data/inventoryRepo";
import { ITEM_IDS, setAbsoluteQuantity } from "@/lib/inventory";

/** One-time v1 helper: set key stock levels for Kitui launch. */
export default function OpeningStock() {
  const [parent, setParent] = useState(200);
  const [dayOld, setDayOld] = useState(300);
  const [week3, setWeek3] = useState(150);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const apply = async () => {
    if (
      !window.confirm(
        "Set opening stock for Parent Stock, Day-old, and 3-week chicks? This overwrites those three quantities."
      )
    ) {
      return;
    }
    setBusy(true);
    setMsg("");
    try {
      let items = await listItems();
      let movements = await listMovements();

      const applyOne = (id: string, qty: number, note: string) => {
        const r = setAbsoluteQuantity(items, movements, id, qty, note);
        if (!r.ok) throw new Error(r.error ?? "Failed");
        items = r.items;
        movements = r.movements;
      };

      applyOne(ITEM_IDS.parentStock, parent, "V1 opening stock");
      applyOne(ITEM_IDS.dayOld, dayOld, "V1 opening stock");
      applyOne(ITEM_IDS.week3, week3, "V1 opening stock");

      await saveItems(items);
      await saveMovements(movements);
      setMsg(
        `Saved: parent ${parent}, day-old ${dayOld}, 3-week ${week3}. Adjust anytime in Inventory.`
      );
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Failed to set stock");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="farm-card rounded-3xl border border-outline-variant p-6 space-y-4">
      <h3 className="text-lg font-semibold text-on-surface">Quick start stock</h3>
      <p className="text-sm text-on-surface-variant">
        Enter what you actually have today so orders can be confirmed without
        stock errors.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="block space-y-1">
          <span className="text-xs text-on-surface-variant">Parent stock</span>
          <input
            type="number"
            min={0}
            className="w-full bg-surface-container-lowest border border-outline-variant p-3 rounded-xl text-on-surface"
            value={parent}
            onChange={(e) => setParent(Number(e.target.value))}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs text-on-surface-variant">Day-old chicks</span>
          <input
            type="number"
            min={0}
            className="w-full bg-surface-container-lowest border border-outline-variant p-3 rounded-xl text-on-surface"
            value={dayOld}
            onChange={(e) => setDayOld(Number(e.target.value))}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs text-on-surface-variant">3-week chicks</span>
          <input
            type="number"
            min={0}
            className="w-full bg-surface-container-lowest border border-outline-variant p-3 rounded-xl text-on-surface"
            value={week3}
            onChange={(e) => setWeek3(Number(e.target.value))}
          />
        </label>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={apply}
        className="bg-secondary-container text-on-secondary-container hover:opacity-90 disabled:opacity-60 px-5 py-2.5 rounded-xl font-medium text-sm"
      >
        {busy ? "Saving…" : "Apply opening stock"}
      </button>
      {msg && <p className="text-sm text-on-surface">{msg}</p>}
    </section>
  );
}
