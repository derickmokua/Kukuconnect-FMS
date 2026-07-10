"use client";

import { useState } from "react";
import type { FarmerOrder } from "@/lib/orders";
import type { NotifyEvent } from "@/lib/notifications";
import {
  describeNotifyResult,
  notifyFarmer,
  openOrderWhatsApp,
} from "@/lib/notifyClient";
import { eventLabel } from "@/lib/notifications";

const FARMER_EVENTS: NotifyEvent[] = [
  "order_received",
  "payment_confirmed",
  "ready_pickup",
  "cancelled",
];

export default function NotifyButtons({ order }: { order: FarmerOrder }) {
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState("");

  const send = async (event: NotifyEvent) => {
    setBusy(true);
    setLast("");
    try {
      const result = await notifyFarmer(order, event, {
        forceWhatsApp: true,
        forceSms: true,
      });
      setLast(describeNotifyResult(result));
    } catch (err) {
      setLast(err instanceof Error ? err.message : "Notify failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-xs text-on-surface-variant font-medium uppercase tracking-wide">
        Notify farmer
      </p>
      <div className="flex flex-wrap gap-2">
        {FARMER_EVENTS.map((event) => (
          <button
            key={event}
            type="button"
            disabled={busy}
            onClick={() => send(event)}
            className="bg-surface-container-highest hover:bg-surface-container-high disabled:opacity-50 px-3 py-1.5 rounded-xl text-xs text-gray-200"
            title={eventLabel(event)}
          >
            {shortLabel(event)}
          </button>
        ))}
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            openOrderWhatsApp(order, "order_received");
            setLast("WhatsApp only (payment template)");
          }}
          className="bg-emerald-900/50 hover:bg-emerald-800/50 text-emerald-300 px-3 py-1.5 rounded-xl text-xs"
        >
          WA only
        </button>
      </div>
      {last && <p className="text-xs text-on-surface-variant">{last}</p>}
    </div>
  );
}

function shortLabel(event: NotifyEvent): string {
  switch (event) {
    case "order_received":
      return "Received";
    case "payment_confirmed":
      return "Paid";
    case "ready_pickup":
      return "Ready";
    case "cancelled":
      return "Cancel msg";
    default:
      return event;
  }
}
