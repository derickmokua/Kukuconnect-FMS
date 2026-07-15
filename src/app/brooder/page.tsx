"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type BrooderLot,
  type MortalityEvent,
  ageDays,
  applyDailyAgeUp,
  applyLotCorrection,
  applyMortality,
  effectiveInitialQuantity,
  needsAgeUp,
  placeInBrooder,
  remainingFromBreakdown,
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
  const [brooder, setBrooder] = useState("Brooder 1");

  const [mortQty, setMortQty] = useState(1);
  const [mortReason, setMortReason] = useState("");
  const [mortDate, setMortDate] = useState(todayIsoLocal());

  const [editLotId, setEditLotId] = useState<string | null>(null);
  const [editLotName, setEditLotName] = useState("");
  const [editLotBreed, setEditLotBreed] = useState("");
  const [editLotNotes, setEditLotNotes] = useState("");
  const [editLotHatchDate, setEditLotHatchDate] = useState("");
  const [editLotInitialQuantity, setEditLotInitialQuantity] = useState(0);
  const [editLotTotalSales, setEditLotTotalSales] = useState(0);
  const [editLotTotalDiscounted, setEditLotTotalDiscounted] = useState(0);
  const [editLotTotalMortality, setEditLotTotalMortality] = useState(0);

  const editRemaining = remainingFromBreakdown({
    initialQuantity: editLotInitialQuantity,
    totalMortality: editLotTotalMortality,
    totalSales: editLotTotalSales,
    totalDiscounted: editLotTotalDiscounted,
  });

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

  const groupedLots = useMemo(() => {
    const groups: Record<string, BrooderLot[]> = {};
    for (const lot of active) {
      const b = lot.brooder || "Unassigned";
      if (!groups[b]) groups[b] = [];
      groups[b].push(lot);
    }
    return groups;
  }, [active]);

  const sortedBrooders = useMemo(() => {
    return Object.keys(groupedLots).sort((a, b) => {
      if (a === "Unassigned") return 1;
      if (b === "Unassigned") return -1;
      return a.localeCompare(b);
    });
  }, [groupedLots]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const result = placeInBrooder(
        lots,
        await listItems(),
        await listMovements(),
        { name, hatchDate, quantity: qty, breed, brooder }
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
      setBrooder("Brooder 1");
      setHatchDate(todayIsoLocal());
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to place lot");
    }
  };

  const handleMoveLot = async (lotId: string, nextBrooder: string) => {
    try {
      const nextLots = lots.map((l) =>
        l.id === lotId ? { ...l, brooder: nextBrooder } : l
      );
      await saveLots(nextLots);
      setLots(nextLots);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to move lot");
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
        { lotId: mortLotId, qty: mortQty, reason: mortReason, date: mortDate }
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
      setMortDate(todayIsoLocal());
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to log mortality");
    }
  };

  const openEditLot = (lot: BrooderLot) => {
    setEditLotId(lot.id);
    setEditLotName(lot.name);
    setEditLotBreed(lot.breed);
    setEditLotNotes(lot.notes);
    setEditLotHatchDate(lot.hatchDate);
    setEditLotInitialQuantity(effectiveInitialQuantity(lot));
    setEditLotTotalSales(lot.totalSales ?? 0);
    setEditLotTotalDiscounted(lot.totalDiscounted ?? 0);
    setEditLotTotalMortality(lot.totalMortality ?? 0);
  };

  const handleSaveLot = async () => {
    if (!editLotId) return;
    try {
      const result = applyLotCorrection(
        lots,
        await listItems(),
        await listMovements(),
        editLotId,
        {
          name: editLotName.trim(),
          breed: editLotBreed.trim(),
          notes: editLotNotes.trim(),
          hatchDate: editLotHatchDate,
          initialQuantity: Math.max(0, Math.floor(editLotInitialQuantity)),
          totalSales: Math.max(0, Math.floor(editLotTotalSales)),
          totalDiscounted: Math.max(0, Math.floor(editLotTotalDiscounted)),
          totalMortality: Math.max(0, Math.floor(editLotTotalMortality)),
        }
      );
      if (!result.ok) {
        alert(result.error ?? "Could not save lot");
        return;
      }
      await saveLots(result.lots);
      await saveItems(result.items);
      await saveMovements(result.movements);
      setLots(result.lots);
      setEditLotId(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to edit lot");
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
                <Field label="Brooder location">
                  <Select
                    value={brooder}
                    onChange={(e) => setBrooder(e.target.value)}
                  >
                    <option value="Brooder 1">Brooder 1</option>
                    <option value="Brooder 2">Brooder 2</option>
                    <option value="Brooder 3">Brooder 3</option>
                    <option value="Brooder 4">Brooder 4</option>
                    <option value="Unassigned">Unassigned</option>
                  </Select>
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
        <div className="space-y-6">
          {sortedBrooders.map((brooderName) => {
            const brooderLots = groupedLots[brooderName];
            const totalInBrooder = brooderLots.reduce((sum, l) => sum + l.quantity, 0);
            return (
              <div key={brooderName} className="space-y-3">
                <div className="flex justify-between items-center border-b border-outline-variant/60 pb-2">
                  <h3 className="font-bold text-on-surface text-lg flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-primary"></span>
                    {brooderName}
                  </h3>
                  <span className="text-xs text-on-surface-variant font-medium">
                    {totalInBrooder.toLocaleString()} chicks total
                  </span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {brooderLots.map((lot) => {
                    const age = ageDays(lot.hatchDate);
                    return (
                      <Card key={lot.id}>
                        <CardBody className="space-y-3">
                          <div className="flex justify-between items-start gap-2">
                            <div>
                              <div className="flex flex-wrap items-center gap-1.5">
                                <h4 className="font-semibold text-on-surface">
                                  {lot.name}
                                </h4>
                                <Badge tone="primary">{stageLabel(lot.stageId)}</Badge>
                              </div>
                              <p className="text-xs text-on-surface-variant mt-1">
                                Hatch {lot.hatchDate} · Day {age}
                                {lot.breed ? ` · ${lot.breed}` : ""}
                              </p>
                              {lot.notes && (
                                <p className="text-[11px] text-on-surface-variant italic mt-1 line-clamp-2">
                                  Note: {lot.notes}
                                </p>
                              )}
                            </div>
                            <div className="text-right space-y-1 shrink-0">
                              <p className="tabular-money text-lg font-bold text-primary">
                                {lot.quantity.toLocaleString()} remaining
                              </p>
                              <div className="text-[10px] text-on-surface-variant space-y-0.5">
                                <p>
                                  Placed:{" "}
                                  {effectiveInitialQuantity(lot).toLocaleString()}
                                </p>
                                <p>
                                  − Sold: {(lot.totalSales ?? 0).toLocaleString()}
                                </p>
                                <p className="text-error">
                                  − Mortality:{" "}
                                  {(lot.totalMortality ?? 0).toLocaleString()}
                                </p>
                                <p>
                                  − Discounted:{" "}
                                  {(lot.totalDiscounted ?? 0).toLocaleString()}
                                </p>
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-outline-variant/30 pt-3">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[11px] text-on-surface-variant font-medium">Move to:</span>
                              <select
                                value={lot.brooder || "Unassigned"}
                                onChange={(e) => handleMoveLot(lot.id, e.target.value)}
                                className="text-xs bg-surface-container-low border border-outline-variant/60 rounded-lg px-2 py-1 text-on-surface focus:outline-none focus:ring-1 focus:ring-primary"
                              >
                                <option value="Brooder 1">Brooder 1</option>
                                <option value="Brooder 2">Brooder 2</option>
                                <option value="Brooder 3">Brooder 3</option>
                                <option value="Brooder 4">Brooder 4</option>
                                <option value="Unassigned">Unassigned</option>
                              </select>
                            </div>

                            <div className="flex items-center gap-1.5">
                              {editLotId === lot.id ? null : (
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  onClick={() => openEditLot(lot)}
                                >
                                  Edit lot
                                </Button>
                              )}
                              {mortLotId === lot.id ? null : (
                                <Button
                                  size="sm"
                                  variant="danger"
                                  onClick={() => {
                                    setMortLotId(lot.id);
                                    setMortQty(1);
                                    setMortDate(todayIsoLocal());
                                  }}
                                >
                                  Log mortality
                                </Button>
                              )}
                            </div>
                          </div>

                          {editLotId === lot.id && (
                            <div className="rounded-xl bg-surface-container-low border border-outline-variant p-3 space-y-3 mt-2">
                              <p className="text-xs font-semibold text-on-surface">
                                Correct lot (backfill sales / mortality / discounted)
                              </p>
                              <p className="text-[11px] text-on-surface-variant">
                                Remaining is auto-calculated: placed − sold −
                                mortality − discounted. Saving also updates
                                inventory stock.
                              </p>
                              <div className="grid grid-cols-2 gap-2 text-xs">
                                <Field label="Name">
                                  <Input
                                    value={editLotName}
                                    onChange={(e) => setEditLotName(e.target.value)}
                                    className="h-8 text-xs p-1"
                                  />
                                </Field>
                                <Field label="Breed">
                                  <Input
                                    value={editLotBreed}
                                    onChange={(e) => setEditLotBreed(e.target.value)}
                                    className="h-8 text-xs p-1"
                                  />
                                </Field>
                                <Field label="Hatch / placed date">
                                  <Input
                                    type="date"
                                    value={editLotHatchDate}
                                    onChange={(e) => setEditLotHatchDate(e.target.value)}
                                    className="h-8 text-xs p-1"
                                  />
                                </Field>
                                <Field label="Placed qty">
                                  <Input
                                    type="number"
                                    min={0}
                                    value={editLotInitialQuantity}
                                    onChange={(e) =>
                                      setEditLotInitialQuantity(Number(e.target.value))
                                    }
                                    className="h-8 text-xs p-1"
                                  />
                                </Field>
                                <Field label="Sold qty">
                                  <Input
                                    type="number"
                                    min={0}
                                    value={editLotTotalSales}
                                    onChange={(e) =>
                                      setEditLotTotalSales(Number(e.target.value))
                                    }
                                    className="h-8 text-xs p-1"
                                  />
                                </Field>
                                <Field label="Discounted / free qty">
                                  <Input
                                    type="number"
                                    min={0}
                                    value={editLotTotalDiscounted}
                                    onChange={(e) =>
                                      setEditLotTotalDiscounted(Number(e.target.value))
                                    }
                                    className="h-8 text-xs p-1"
                                  />
                                </Field>
                                <Field label="Mortality qty">
                                  <Input
                                    type="number"
                                    min={0}
                                    value={editLotTotalMortality}
                                    onChange={(e) =>
                                      setEditLotTotalMortality(Number(e.target.value))
                                    }
                                    className="h-8 text-xs p-1"
                                  />
                                </Field>
                                <Field label="Remaining (auto)">
                                  <Input
                                    type="number"
                                    readOnly
                                    value={editRemaining}
                                    className="h-8 text-xs p-1 opacity-80"
                                  />
                                </Field>
                              </div>
                              <label className="block space-y-0.5">
                                <span className="text-[10px] text-on-surface-variant">Notes</span>
                                <Input
                                  value={editLotNotes}
                                  onChange={(e) => setEditLotNotes(e.target.value)}
                                  className="h-8 text-xs p-1"
                                />
                              </label>
                              <div className="flex gap-1.5">
                                <Button variant="gold" size="sm" onClick={handleSaveLot}>
                                  Save & sync stock
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setEditLotId(null)}
                                >
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          )}

                          {mortLotId === lot.id && (
                            <div className="rounded-xl bg-error-container/40 border border-error/20 p-3 space-y-3 mt-2">
                              <p className="text-xs font-semibold text-on-error-container">
                                Log mortality
                              </p>
                              <div className="grid grid-cols-3 gap-2">
                                <Field label="Lost">
                                  <Input
                                    type="number"
                                    min={1}
                                    max={lot.quantity}
                                    value={mortQty}
                                    onChange={(e) =>
                                      setMortQty(Number(e.target.value))
                                    }
                                    className="h-8 text-xs p-1"
                                  />
                                </Field>
                                <Field label="Reason">
                                  <Select
                                    value={mortReason}
                                    onChange={(e) => setMortReason(e.target.value)}
                                    className="h-8 text-xs p-1"
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
                                <Field label="Date">
                                  <Input
                                    type="date"
                                    required
                                    value={mortDate}
                                    onChange={(e) => setMortDate(e.target.value)}
                                    className="h-8 text-xs p-1"
                                  />
                                </Field>
                              </div>
                              <div className="flex gap-1.5">
                                <Button variant="danger" size="sm" onClick={handleMortality}>
                                  Confirm
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setMortLotId(null)}
                                >
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          )}
                        </CardBody>
                      </Card>
                    );
                  })}
                </div>
              </div>
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
