"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type BrooderLot,
  type MortalityEvent,
  ageDays,
  applyDailyAgeUp,
  applyMortality,
  needsAgeUp,
  placeInBrooder,
  stageLabel,
  todayIsoLocal,
  activeLotsSummary,
  BROODER_STAGES,
} from "@/lib/brooder";
import { listLots, saveLots, listMortality, saveMortality } from "@/lib/data/brooderRepo";
import {
  listItems,
  listMovements,
  saveItems,
  saveMovements,
} from "@/lib/data/inventoryRepo";
import {
  Badge,
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

export default function BrooderPage() {
  const [lots, setLots] = useState<BrooderLot[]>([]);
  const [mortality, setMortality] = useState<MortalityEvent[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [ageMsg, setAgeMsg] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [mortLotId, setMortLotId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [hatchDate, setHatchDate] = useState(todayIsoLocal());
  const [qty, setQty] = useState(100);
  const [breed, setBreed] = useState("");

  const [mortQty, setMortQty] = useState(1);
  const [mortReason, setMortReason] = useState("");

  const runAgeUp = useCallback(async (currentLots: BrooderLot[]) => {
    if (!needsAgeUp(currentLots)) {
      setAgeMsg("Brooder stages are up to date for today.");
      return currentLots;
    }
    const items = await listItems();
    const movements = await listMovements();
    const result = applyDailyAgeUp(currentLots, items, movements);
    await saveLots(result.lots);
    await saveItems(result.items);
    await saveMovements(result.movements);
    setLots(result.lots);
    if (result.transitions.length) {
      setAgeMsg(
        `Aged up ${result.transitions.length} lot(s): ` +
          result.transitions
            .map(
              (t) =>
                `${t.qty} birds → ${stageLabel(t.to)}`
            )
            .join("; ")
      );
    } else {
      setAgeMsg("Daily check complete — no stage changes.");
    }
    return result.lots;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [l, m] = await Promise.all([listLots(), listMortality()]);
        if (cancelled) return;
        setMortality(m);
        // Auto daily age-up on open
        const updated = await runAgeUp(l);
        if (!cancelled) setLots(updated);
      } catch (err) {
        console.error(err);
        alert(err instanceof Error ? err.message : "Failed to load brooder");
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runAgeUp]);

  const summary = useMemo(() => activeLotsSummary(lots), [lots]);
  const active = useMemo(
    () => lots.filter((l) => l.status === "active"),
    [lots]
  );

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const result = placeInBrooder(
        lots,
        await listItems(),
        await listMovements(),
        { name, hatchDate, quantity: qty, breed }
      );
      if (!result.ok) {
        alert(result.error);
        return;
      }
      await saveLots(result.lots);
      await saveItems(result.items);
      await saveMovements(result.movements);
      setLots(result.lots);
      setShowAdd(false);
      setName("");
      setQty(100);
      setBreed("");
      setHatchDate(todayIsoLocal());
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to place lot");
    }
  };

  const handleMortality = async () => {
    if (!mortLotId) return;
    try {
      const result = applyMortality(
        lots,
        await listItems(),
        await listMovements(),
        mortality,
        { lotId: mortLotId, qty: mortQty, reason: mortReason }
      );
      if (!result.ok) {
        alert(result.error);
        return;
      }
      await saveLots(result.lots);
      await saveItems(result.items);
      await saveMovements(result.movements);
      await saveMortality(result.events);
      setLots(result.lots);
      setMortality(result.events);
      setMortLotId(null);
      setMortQty(1);
      setMortReason("");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to log mortality");
    }
  };

  if (!hydrated) return <PageSkeleton />;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <PageHeader
        title="Brooder"
        description="Daily age-up moves chicks between stock stages. Log mortality separately from sales."
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => runAgeUp(lots)}
            >
              Run daily update
            </Button>
            <Button variant="gold" size="sm" onClick={() => setShowAdd((v) => !v)}>
              {showAdd ? "Close" : "+ Place lot"}
            </Button>
          </>
        }
      />

      {ageMsg && (
        <div className="rounded-xl border border-secondary/30 bg-secondary-fixed/40 px-4 py-3 text-sm text-on-secondary-container">
          {ageMsg}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Active lots" value={String(summary.activeCount)} />
        <StatCard
          label="Birds in brooder"
          value={summary.totalBirds.toLocaleString()}
        />
        <StatCard
          label="Mortality (lots)"
          value={summary.totalMortality.toLocaleString()}
          danger
        />
        <StatCard
          label="Stages tracked"
          value={String(BROODER_STAGES.length)}
        />
      </div>

      {/* Stage breakdown */}
      <Card>
        <CardBody>
          <p className="font-label-caps text-on-surface-variant mb-3">
            By age stage (active)
          </p>
          <div className="flex flex-wrap gap-2">
            {BROODER_STAGES.map((s) => {
              const n = summary.byStage.get(s.id) ?? 0;
              return (
                <span
                  key={s.id}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-container-low border border-outline-variant/60 text-sm"
                >
                  <span className="text-on-surface-variant text-xs">
                    {s.label}
                  </span>
                  <span className="tabular-money text-primary">{n}</span>
                </span>
              );
            })}
          </div>
        </CardBody>
      </Card>

      {showAdd && (
        <Card variant="inset">
          <CardBody>
            <form onSubmit={handleAdd} className="space-y-4">
              <h3 className="font-semibold text-on-surface">
                Place chicks in brooder
              </h3>
              <p className="text-xs text-on-surface-variant">
                Adds stock to inventory at the age band matching hatch date.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Lot name">
                  <Input
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Kuroiler hatch 10 Jul"
                  />
                </Field>
                <Field label="Hatch / placed date">
                  <Input
                    type="date"
                    required
                    value={hatchDate}
                    onChange={(e) => setHatchDate(e.target.value)}
                  />
                </Field>
                <Field label="Quantity">
                  <Input
                    type="number"
                    min={1}
                    required
                    value={qty}
                    onChange={(e) => setQty(Number(e.target.value))}
                  />
                </Field>
                <Field label="Breed (optional)">
                  <Input
                    value={breed}
                    onChange={(e) => setBreed(e.target.value)}
                    placeholder="Kuroiler / Rainbow"
                  />
                </Field>
              </div>
              <Button type="submit">Place & update stock</Button>
            </form>
          </CardBody>
        </Card>
      )}

      {active.length === 0 ? (
        <EmptyState icon="house" title="No active brooder lots">
          Place a lot after hatch, or when you receive day-olds. Age-up runs
          automatically each day you open this page.
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {active.map((lot) => {
            const age = ageDays(lot.hatchDate);
            return (
              <Card key={lot.id}>
                <CardBody className="space-y-3">
                  <div className="flex flex-col sm:flex-row sm:justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-on-surface text-lg">
                          {lot.name}
                        </h3>
                        <Badge tone="primary">{stageLabel(lot.stageId)}</Badge>
                      </div>
                      <p className="text-sm text-on-surface-variant mt-1">
                        Hatch {lot.hatchDate} · Day {age}
                        {lot.breed ? ` · ${lot.breed}` : ""}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="tabular-money text-2xl text-primary">
                        {lot.quantity.toLocaleString()}
                      </p>
                      <p className="text-xs text-on-surface-variant">
                        birds · mort {lot.totalMortality}
                      </p>
                    </div>
                  </div>

                  {mortLotId === lot.id ? (
                    <div className="rounded-xl bg-error-container/40 border border-error/20 p-4 space-y-3">
                      <p className="text-sm font-medium text-on-error-container">
                        Log mortality (reduces stock — not a sale)
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <Field label="Birds lost">
                          <Input
                            type="number"
                            min={1}
                            max={lot.quantity}
                            value={mortQty}
                            onChange={(e) =>
                              setMortQty(Number(e.target.value))
                            }
                          />
                        </Field>
                        <Field label="Reason">
                          <Select
                            value={mortReason}
                            onChange={(e) => setMortReason(e.target.value)}
                          >
                            <option value="">Select…</option>
                            <option value="Disease">Disease</option>
                            <option value="Crushing / pile-up">
                              Crushing / pile-up
                            </option>
                            <option value="Predator">Predator</option>
                            <option value="Cold / heat stress">
                              Cold / heat stress
                            </option>
                            <option value="Unknown">Unknown</option>
                            <option value="Other">Other</option>
                          </Select>
                        </Field>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="danger" onClick={handleMortality}>
                          Confirm mortality
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => setMortLotId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => {
                        setMortLotId(lot.id);
                        setMortQty(1);
                      }}
                    >
                      Record mortality
                    </Button>
                  )}
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      {mortality.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-lg font-semibold text-on-surface">
            Recent mortality
          </h3>
          <Card className="overflow-hidden divide-y divide-outline-variant/50">
            {mortality.slice(0, 15).map((m) => (
              <div
                key={m.id}
                className="px-5 py-3 flex justify-between gap-3 text-sm"
              >
                <div>
                  <p className="font-medium text-on-surface">{m.lotName}</p>
                  <p className="text-on-surface-variant text-xs">
                    {m.date}
                    {m.reason ? ` · ${m.reason}` : ""}
                  </p>
                </div>
                <p className="tabular-money text-error">−{m.qty}</p>
              </div>
            ))}
          </Card>
        </section>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  danger,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <Card variant="metric">
      <CardBody className="!p-4">
        <p
          className={`font-label-caps ${
            danger ? "text-error" : "text-on-surface-variant"
          }`}
        >
          {label}
        </p>
        <p
          className={`tabular-money text-2xl mt-1 ${
            danger ? "text-error" : "text-on-surface"
          }`}
        >
          {value}
        </p>
      </CardBody>
    </Card>
  );
}
