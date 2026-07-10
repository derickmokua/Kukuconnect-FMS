"use client";

import { useEffect, useState } from "react";
import Nav from "@/components/Nav";
import { useAuth } from "@/components/AuthProvider";
import { dataModeLabel, getDataMode } from "@/lib/data/mode";
import { migrateAllLocalDataToCloud } from "@/lib/data/migrate";
import {
  type NotifyPrefs,
  DEFAULT_NOTIFY_PREFS,
} from "@/lib/notifications";
import {
  loadNotifyPrefs,
  saveNotifyPrefs,
} from "@/lib/notifyClient";
import { mpesaTillHint } from "@/lib/orders";
import GoLiveChecklist from "@/components/GoLiveChecklist";
import OpeningStock from "@/components/OpeningStock";

export default function SettingsPage() {
  const { configured, user, signOut } = useAuth();
  const mode = getDataMode();
  const [migrating, setMigrating] = useState(false);
  const [message, setMessage] = useState("");
  const [prefs, setPrefs] = useState<NotifyPrefs>(DEFAULT_NOTIFY_PREFS);
  const [smsStatus, setSmsStatus] = useState<string>("…");
  const [prefsSaved, setPrefsSaved] = useState("");

  useEffect(() => {
    setPrefs(loadNotifyPrefs());
    fetch("/api/notify/sms")
      .then((r) => r.json())
      .then((d: { africastalking?: string }) => {
        setSmsStatus(
          d.africastalking === "configured"
            ? "Africa's Talking: configured"
            : "Africa's Talking: not configured (WhatsApp-only OK)"
        );
      })
      .catch(() => setSmsStatus("Could not check SMS API"));
  }, []);

  const onMigrate = async () => {
    if (
      !window.confirm(
        "Upload all data from this browser (localStorage) to Supabase cloud? Existing cloud rows with the same IDs will be updated."
      )
    ) {
      return;
    }
    setMigrating(true);
    setMessage("");
    try {
      const result = await migrateAllLocalDataToCloud();
      setMessage(
        `Migrated: ${result.items} SKUs, ${result.movements} movements, ${result.sales} sales, ${result.expenses} expenses, ${result.batches} batches, ${result.orders} orders.`
      );
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Migration failed");
    } finally {
      setMigrating(false);
    }
  };

  const savePrefs = (next: NotifyPrefs) => {
    setPrefs(next);
    saveNotifyPrefs(next);
    setPrefsSaved("Saved on this device");
    setTimeout(() => setPrefsSaved(""), 2000);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <Nav />

      <div className="border-b border-outline-variant pb-6">
        <h2 className="text-3xl font-bold text-on-surface">Settings</h2>
        <p className="text-on-surface-variant mt-1 text-sm">
          V1 go-live, backend, notifications, migration
        </p>
      </div>

      <GoLiveChecklist />
      <OpeningStock />

      <section className="farm-card rounded-3xl border border-outline-variant p-6 space-y-3">
        <h3 className="text-lg font-semibold text-on-surface">Data mode</h3>
        <p className="text-tertiary-container font-medium">{dataModeLabel(mode)}</p>
        <p className="text-sm text-on-surface-variant">
          {mode === "cloud"
            ? "Inventory, orders, sales, expenses, and incubation sync to Supabase for all signed-in staff devices."
            : "Data stays in this browser only. Add Supabase keys in .env.local to enable multi-device cloud."}
        </p>
        <ul className="text-xs text-on-surface-variant space-y-1 list-disc pl-5">
          <li>
            Core schema:{" "}
            <code className="text-on-surface-variant">supabase/schema.sql</code>
          </li>
          <li>
            Orders: <code className="text-on-surface-variant">supabase/orders.sql</code>
          </li>
          <li>
            Farmer form: <code className="text-on-surface-variant">/order</code> (public)
          </li>
          <li>
            M-Pesa till shown:{" "}
            <code className="text-on-surface-variant">{mpesaTillHint()}</code>
          </li>
        </ul>
      </section>

      <section className="farm-card rounded-3xl border border-outline-variant p-6 space-y-4">
        <h3 className="text-lg font-semibold text-on-surface">Notifications (M3)</h3>
        <p className="text-sm text-on-surface-variant">
          WhatsApp templates work with no API cost. SMS needs Africa&apos;s
          Talking keys on the server.
        </p>
        <p className="text-xs text-tertiary-container/90">{smsStatus}</p>

        <label className="flex items-start gap-3 text-sm text-on-surface">
          <input
            type="checkbox"
            className="mt-1"
            checked={prefs.autoWhatsApp}
            onChange={(e) =>
              savePrefs({ ...prefs, autoWhatsApp: e.target.checked })
            }
          />
          <span>
            <strong className="text-on-surface">Auto-open WhatsApp</strong> after
            confirm paid / ready / cancel (staff actions)
          </span>
        </label>
        <label className="flex items-start gap-3 text-sm text-on-surface">
          <input
            type="checkbox"
            className="mt-1"
            checked={prefs.trySms}
            onChange={(e) =>
              savePrefs({ ...prefs, trySms: e.target.checked })
            }
          />
          <span>
            <strong className="text-on-surface">Try SMS</strong> via Africa&apos;s
            Talking when configured
          </span>
        </label>
        <label className="flex items-start gap-3 text-sm text-on-surface">
          <input
            type="checkbox"
            className="mt-1"
            checked={prefs.alertStaffOnNewOrder}
            onChange={(e) =>
              savePrefs({ ...prefs, alertStaffOnNewOrder: e.target.checked })
            }
          />
          <span>
            <strong className="text-on-surface">SMS staff</strong> on new public
            order (<code className="text-on-surface-variant">NEXT_PUBLIC_STAFF_PHONE</code>
            )
          </span>
        </label>
        {prefsSaved && (
          <p className="text-xs text-tertiary-container">{prefsSaved}</p>
        )}

        <div className="text-xs text-on-surface-variant bg-surface-container-low border border-outline-variant rounded-xl p-3 space-y-1">
          <p className="text-on-surface-variant font-medium">Env for SMS (server only)</p>
          <p>
            <code>AFRICASTALKING_API_KEY</code>
          </p>
          <p>
            <code>AFRICASTALKING_USERNAME</code> (sandbox or live)
          </p>
          <p>
            <code>AFRICASTALKING_FROM</code> (optional sender)
          </p>
          <p>
            <code>NEXT_PUBLIC_STAFF_PHONE</code> e.g. 2547XXXXXXXX
          </p>
        </div>
      </section>

      {configured && (
        <section className="farm-card rounded-3xl border border-outline-variant p-6 space-y-3">
          <h3 className="text-lg font-semibold text-on-surface">Account</h3>
          <p className="text-on-surface text-sm">
            {user?.email ?? "Not signed in"}
          </p>
          <button
            type="button"
            onClick={() => signOut()}
            className="bg-surface-container-highest hover:bg-surface-container-high px-4 py-2 rounded-xl text-sm"
          >
            Sign out
          </button>
        </section>
      )}

      {mode === "cloud" && (
        <section className="farm-card rounded-3xl border border-outline-variant p-6 space-y-4">
          <h3 className="text-lg font-semibold text-on-surface">
            Migrate local → cloud
          </h3>
          <p className="text-sm text-on-surface-variant">
            If you already used the app offline, push this device&apos;s data to
            Supabase so phones and laptops share the same hatchery records.
          </p>
          <button
            type="button"
            disabled={migrating}
            onClick={onMigrate}
            className="bg-secondary-container text-on-secondary-container hover:opacity-90 disabled:opacity-60 px-5 py-3 rounded-2xl font-medium"
          >
            {migrating ? "Uploading…" : "Upload local data to cloud"}
          </button>
          {message && (
            <p className="text-sm text-on-surface bg-surface-container-lowest border border-outline-variant rounded-xl px-3 py-2">
              {message}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
