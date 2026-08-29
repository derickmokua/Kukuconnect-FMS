"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type BrooderLot,
  type MortalityEvent,
  ageDays,
  formatAge,
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
import {
  type VaccinationRecord,
  loadVaccinationRecordsLocal,
  saveVaccinationRecordsLocal,
  ensureLotVaccinations,
  markVaccineAdministered,
  markVaccineSkipped,
  getVaccineSummary,
} from "@/lib/vaccines";
import { listLots, saveLots, listMortality, saveMortality, upsertLotCloud, deleteLotCloud } from "@/lib/data/brooderRepo";
import {
  listItems,
  listMovements,
  saveItems,
  saveMovements,
} from "@/lib/data/inventoryRepo";
import { adjustInventoryTransaction, recordMortalityTransaction } from "@/lib/data/transactions";
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
  const [vaccinations, setVaccinations] = useState<VaccinationRecord[]>([]);
  const [brooderTab, setBrooderTab] = useState<"flocks" | "vaccines" | "mortality">("flocks");
  const [hydrated, setHydrated] = useState(false);
  const [ageMsg, setAgeMsg] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [mortLotId, setMortLotId] = useState<string | null>(null);

  // Administer modal state
  const [administerRecord, setAdministerRecord] = useState<VaccinationRecord | null>(null);
  const [adminDate, setAdminDate] = useState(todayIsoLocal());
  const [adminBy, setAdminBy] = useState("Staff");
  const [adminCost, setAdminCost] = useState<number | undefined>(undefined);
  const [adminNotes, setAdminNotes] = useState("");
  const [vaccineFilter, setVaccineFilter] = useState<"all" | "due" | "upcoming" | "completed">("due");
  const [vaccineLotFilter, setVaccineLotFilter] = useState<string>("all");

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
    // saveLots handles metadata changes, preserves quantity
    await saveLots(result.lots);
    
    // Apply inventory changes transactionally
    for (const t of result.transitions) {
      await adjustInventoryTransaction(t.from, -t.qty, "adjust", `Brooder age-up: out`, t.lotId, true);
      await adjustInventoryTransaction(t.to, t.qty, "adjust", `Brooder age-up: in`, t.lotId, true);
    }
    
    const [nextLots, nextItems, nextMovements] = await Promise.all([listLots(), listItems(), listMovements()]);
    setLots(nextLots);

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
    return nextLots;
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

        // Ensure vaccinations are generated for active lots
        let v = loadVaccinationRecordsLocal();
        for (const lot of updated) {
          if (lot.status === "active") {
            const res = ensureLotVaccinations(lot, v);
            v = res.records;
          }
        }
        if (!cancelled) setVaccinations(v);
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

  const vaccineSummary = useMemo(
    () => getVaccineSummary(vaccinations, active),
    [vaccinations, active]
  );

  const handleAdministerVaccine = () => {
    if (!administerRecord) return;
    const updated = markVaccineAdministered(vaccinations, administerRecord.id, {
      administeredDate: adminDate,
      administeredBy: adminBy,
      cost: adminCost,
      notes: adminNotes,
    });
    setVaccinations(updated);
    setAdministerRecord(null);
    setAdminNotes("");
    setAdminCost(undefined);
  };

  const handleSkipVaccine = (recordId: string) => {
    const reason = prompt("Reason for skipping this vaccine:") || "Skipped by staff";
    const updated = markVaccineSkipped(vaccinations, recordId, reason);
    setVaccinations(updated);
  };

  const filteredVaccinations = useMemo(() => {
    return vaccinations.filter((v) => {
      const isLotActive = active.some((l) => l.id === v.lotId);
      if (!isLotActive) return false;

      const matchLot = vaccineLotFilter === "all" || v.lotId === vaccineLotFilter;

      const today = todayIsoLocal();
      let matchStatus = true;
      if (vaccineFilter === "due") {
        matchStatus = v.status === "pending" && v.dueDate <= today;
      } else if (vaccineFilter === "upcoming") {
        matchStatus = v.status === "pending" && v.dueDate > today;
      } else if (vaccineFilter === "completed") {
        matchStatus = v.status === "completed";
      }

      return matchLot && matchStatus;
    });
  }, [vaccinations, active, vaccineFilter, vaccineLotFilter]);

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
      const items = await listItems();
      const movements = await listMovements();
      const result = placeInBrooder(
        lots,
        items,
        movements,
        { name, hatchDate, quantity: qty, breed, brooder }
      );
      if (!result.ok || !result.lot) {
        alert(result.error);
        return;
      }
      // Force save the new lot
      await upsertLotCloud(result.lot);
      await saveLots(result.lots);
      
      // Atomic inventory increment
      await adjustInventoryTransaction(result.lot.stageId, result.lot.quantity, "in", `Brooder in: ${result.lot.name}`, result.lot.id, true);
      
      setLots(await listLots());
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
      const lot = lots.find(l => l.id === mortLotId);
      if (!lot) return;
      if (mortQty > lot.quantity) {
        alert(`Only ${lot.quantity} birds in this lot`);
        return;
      }

      const event: MortalityEvent = {
        id: `mort-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        lotId: lot.id,
        lotName: lot.name,
        qty: mortQty,
        reason: mortReason.trim(),
        date: mortDate,
        createdAt: new Date().toISOString(),
      };

      const items = await listItems();
      const stageItem = items.find(i => i.id === lot.stageId);
      const movement = stageItem ? {
        id: `mov-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        itemId: stageItem.id,
        itemName: stageItem.name,
        type: "loss" as any,
        delta: -mortQty,
        balanceAfter: 0,
        note: `Mortality: ${lot.name}${mortReason ? ` — ${mortReason}` : ""}`,
        refId: lot.id,
        createdAt: mortDate ? new Date(mortDate + "T12:00:00").toISOString() : new Date().toISOString(),
      } : null;

      await recordMortalityTransaction(event, movement);
      
      const [l, m] = await Promise.all([listLots(), listMortality()]);
      setLots(l);
      setMortality(m);
      
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
      const items = await listItems();
      const movements = await listMovements();
      const prev = lots.find(l => l.id === editLotId);
      if (!prev) return;
      
      const result = applyLotCorrection(
        lots,
        items,
        movements,
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

      const nextLot = result.lots.find(l => l.id === editLotId)!;
      // Force update cloud to overwrite calculated quantities
      await upsertLotCloud(nextLot);
      await saveLots(result.lots);

      const delta = nextLot.quantity - prev.quantity;
      if (delta !== 0) {
        await adjustInventoryTransaction(prev.stageId, delta, "adjust", `Lot correction: ${nextLot.name} remaining ${prev.quantity} → ${nextLot.quantity}`, editLotId, true);
      }

      setLots(await listLots());
      setEditLotId(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to edit lot");
    }
  };

  if (!hydrated) return <PageSkeleton />;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <PageHeader
        title="Active Flocks"
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

      {/* Main Tabs */}
      <div className="flex gap-2 border-b border-outline-variant/60 pb-2 overflow-x-auto scrollbar-none">
        <button
          type="button"
          onClick={() => setBrooderTab("flocks")}
          className={`px-4 py-2 rounded-xl text-sm font-bold transition-colors whitespace-nowrap ${
            brooderTab === "flocks"
              ? "bg-primary text-white shadow-sm"
              : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high"
          }`}
        >
          Flocks & Housing ({active.length})
        </button>

        <button
          type="button"
          onClick={() => setBrooderTab("vaccines")}
          className={`relative px-4 py-2 rounded-xl text-sm font-bold transition-colors whitespace-nowrap ${
            brooderTab === "vaccines"
              ? "bg-primary text-white shadow-sm"
              : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high"
          }`}
        >
          💉 Vaccine Schedule
          {(vaccineSummary.dueToday.length > 0 || vaccineSummary.overdue.length > 0) && (
            <span className="ml-2 px-2 py-0.5 text-xs bg-amber-500 text-white rounded-full font-extrabold">
              {vaccineSummary.dueToday.length + vaccineSummary.overdue.length} Due
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setBrooderTab("mortality")}
          className={`px-4 py-2 rounded-xl text-sm font-bold transition-colors whitespace-nowrap ${
            brooderTab === "mortality"
              ? "bg-primary text-white shadow-sm"
              : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high"
          }`}
        >
          Mortality Records ({mortality.length})
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Active lots" value={String(summary.activeCount)} />
        <StatCard
          label="Birds in flocks"
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
                Place chicks in flock
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
                <Field label="Location">
                  <Select
                    value={brooder}
                    onChange={(e) => setBrooder(e.target.value)}
                  >
                    <option value="House 1">House 1</option>
                    <option value="House 2">House 2</option>
                    <option value="House 3">House 3</option>
                    <option value="House 4">House 4</option>
                    <option value="Unassigned">Unassigned</option>
                  </Select>
                </Field>
              </div>
              <Button type="submit">Place & update stock</Button>
            </form>
          </CardBody>
        </Card>
      )}

      {/* View 1: Flocks & Housing */}
      {brooderTab === "flocks" && (
        <>
          {active.length === 0 ? (
            <EmptyState icon="house" title="No active flocks">
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
                        const lotVaccines = vaccinations.filter((v) => v.lotId === lot.id);
                        const lotDueToday = lotVaccines.filter((v) => v.status === "pending" && v.dueDate <= todayIsoLocal());
                        const lotCompleted = lotVaccines.filter((v) => v.status === "completed").length;

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
                                    Hatch {lot.hatchDate} · Age: {formatAge(age)}
                                    {lot.breed ? ` · ${lot.breed}` : ""}
                                  </p>

                                  {/* Health status badge */}
                                  <div className="mt-2 flex items-center gap-1.5">
                                    {lotDueToday.length > 0 ? (
                                      <span
                                        onClick={() => {
                                          setVaccineLotFilter(lot.id);
                                          setBrooderTab("vaccines");
                                        }}
                                        className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-900 border border-amber-300 rounded-md text-[10px] font-bold cursor-pointer hover:bg-amber-200 transition-colors"
                                      >
                                        💉 {lotDueToday.length} Vaccine Due Today
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-md text-[10px] font-medium">
                                        ✓ Health Up to Date ({lotCompleted}/{lotVaccines.length})
                                      </span>
                                    )}
                                  </div>

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
                                    <option value="House 1">House 1</option>
                                    <option value="House 2">House 2</option>
                                    <option value="House 3">House 3</option>
                                    <option value="House 4">House 4</option>
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
        </>
      )}

      {/* View 2: Vaccination Schedule */}
      {brooderTab === "vaccines" && (
        <div className="space-y-6">
          {/* Summary KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card variant="metric" className="bg-amber-50/40 border-amber-200">
              <CardBody className="!p-4">
                <p className="font-label-caps text-amber-900">Due Today</p>
                <p className="tabular-money text-2xl font-extrabold text-amber-700 mt-1">
                  {vaccineSummary.dueToday.length}
                </p>
              </CardBody>
            </Card>

            <Card variant="metric" className="bg-red-50/40 border-red-200">
              <CardBody className="!p-4">
                <p className="font-label-caps text-error">Overdue</p>
                <p className="tabular-money text-2xl font-extrabold text-error mt-1">
                  {vaccineSummary.overdue.length}
                </p>
              </CardBody>
            </Card>

            <Card variant="metric" className="bg-blue-50/40 border-blue-200">
              <CardBody className="!p-4">
                <p className="font-label-caps text-blue-900">Next 7 Days</p>
                <p className="tabular-money text-2xl font-extrabold text-blue-700 mt-1">
                  {vaccineSummary.upcomingNext7Days.length}
                </p>
              </CardBody>
            </Card>

            <Card variant="metric" className="bg-emerald-50/40 border-emerald-200">
              <CardBody className="!p-4">
                <p className="font-label-caps text-emerald-900">Completed</p>
                <p className="tabular-money text-2xl font-extrabold text-emerald-700 mt-1">
                  {vaccineSummary.completedCount}
                </p>
              </CardBody>
            </Card>
          </div>

          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between bg-surface-container-lowest p-3 rounded-2xl border border-outline-variant/60">
            <div className="flex gap-1.5 flex-wrap">
              <button
                onClick={() => setVaccineFilter("due")}
                className={`px-3 py-1 rounded-xl text-xs font-bold transition-colors ${
                  vaccineFilter === "due"
                    ? "bg-amber-500 text-white"
                    : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high"
                }`}
              >
                Due & Overdue ({vaccineSummary.dueToday.length + vaccineSummary.overdue.length})
              </button>
              <button
                onClick={() => setVaccineFilter("upcoming")}
                className={`px-3 py-1 rounded-xl text-xs font-bold transition-colors ${
                  vaccineFilter === "upcoming"
                    ? "bg-primary text-white"
                    : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high"
                }`}
              >
                Upcoming
              </button>
              <button
                onClick={() => setVaccineFilter("completed")}
                className={`px-3 py-1 rounded-xl text-xs font-bold transition-colors ${
                  vaccineFilter === "completed"
                    ? "bg-emerald-600 text-white"
                    : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high"
                }`}
              >
                Completed
              </button>
              <button
                onClick={() => setVaccineFilter("all")}
                className={`px-3 py-1 rounded-xl text-xs font-bold transition-colors ${
                  vaccineFilter === "all"
                    ? "bg-on-surface text-surface"
                    : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high"
                }`}
              >
                All
              </button>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-on-surface-variant font-medium">Flock:</span>
              <select
                value={vaccineLotFilter}
                onChange={(e) => setVaccineLotFilter(e.target.value)}
                className="text-xs bg-white border border-outline-variant rounded-xl px-3 py-1.5 text-on-surface outline-none"
              >
                <option value="all">All Active Flocks</option>
                {active.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Vaccine Cards */}
          {filteredVaccinations.length === 0 ? (
            <EmptyState
              icon="medication"
              title="No vaccines in this view"
              description="Vaccination records will show up automatically based on your active flock hatch dates."
            />
          ) : (
            <div className="space-y-3">
              {filteredVaccinations.map((vac) => {
                const isDueToday = vac.status === "pending" && vac.dueDate === todayIsoLocal();
                const isOverdue = vac.status === "pending" && vac.dueDate < todayIsoLocal();
                const isDone = vac.status === "completed";

                return (
                  <div
                    key={vac.id}
                    className={`border rounded-2xl p-4 sm:p-5 transition-all ${
                      isDueToday
                        ? "bg-amber-50/40 border-amber-300 shadow-sm"
                        : isOverdue
                          ? "bg-red-50/30 border-red-300"
                          : isDone
                            ? "bg-emerald-50/20 border-emerald-200"
                            : "bg-white border-outline-variant/60"
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-base text-on-surface">
                            {vac.vaccineName}
                          </span>
                          <Badge tone={isDone ? "success" : isDueToday ? "warn" : isOverdue ? "danger" : "neutral"}>
                            {vac.ageLabel}
                          </Badge>
                          {isDueToday && (
                            <span className="px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider bg-amber-500 text-white rounded-md">
                              Due Today
                            </span>
                          )}
                          {isOverdue && (
                            <span className="px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider bg-red-600 text-white rounded-md">
                              Overdue
                            </span>
                          )}
                        </div>

                        <p className="text-xs text-on-surface-variant font-medium">
                          Flock: <span className="font-bold text-on-surface">{vac.lotName}</span> · Method:{" "}
                          <span className="font-semibold text-primary">{vac.method}</span> · Target: {vac.dueDate}
                        </p>
                        {vac.administeredDate && (
                          <p className="text-xs text-emerald-800 font-medium">
                            ✓ Administered on {vac.administeredDate} by {vac.administeredBy || "Staff"}
                            {vac.notes ? ` (${vac.notes})` : ""}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                        {!isDone && (
                          <>
                            <Button
                              variant="gold"
                              size="sm"
                              onClick={() => {
                                setAdministerRecord(vac);
                                setAdminDate(todayIsoLocal());
                                setAdminBy("Staff");
                                setAdminNotes("");
                              }}
                            >
                              💉 Mark Administered
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleSkipVaccine(vac.id)}
                            >
                              Skip
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* View 3: Mortality Log */}
      {brooderTab === "mortality" && (
        <section className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-bold text-on-surface">
              All Mortality Records ({mortality.length})
            </h3>
          </div>
          {mortality.length === 0 ? (
            <EmptyState
              icon="favorite"
              title="No mortality recorded"
              description="Mortality logs will appear here whenever deaths are recorded against a flock."
            />
          ) : (
            <Card className="overflow-hidden divide-y divide-outline-variant/50">
              {mortality.map((m) => (
                <div
                  key={m.id}
                  className="px-5 py-3.5 flex justify-between items-center text-sm hover:bg-surface-container-lowest transition-colors"
                >
                  <div>
                    <p className="font-bold text-on-surface">{m.lotName}</p>
                    <p className="text-on-surface-variant text-xs mt-0.5">
                      {m.date}
                      {m.reason ? ` · Reason: ${m.reason}` : ""}
                    </p>
                  </div>
                  <p className="tabular-money text-base font-bold text-error">−{m.qty} birds</p>
                </div>
              ))}
            </Card>
          )}
        </section>
      )}

      {/* Administer Vaccine Modal */}
      {administerRecord && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white border border-outline-variant rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-5 animate-in zoom-in-95 duration-150">
            <div>
              <h3 className="text-xl font-bold text-on-surface">
                Record Vaccine Administration
              </h3>
              <p className="text-xs text-on-surface-variant mt-1">
                {administerRecord.vaccineName} for {administerRecord.lotName}
              </p>
            </div>

            <div className="space-y-3 text-sm">
              <Field label="Administered Date">
                <Input
                  type="date"
                  value={adminDate}
                  onChange={(e) => setAdminDate(e.target.value)}
                />
              </Field>

              <Field label="Administered By (Staff Name)">
                <Input
                  value={adminBy}
                  onChange={(e) => setAdminBy(e.target.value)}
                  placeholder="e.g. Samuel (Farm Tech)"
                />
              </Field>

              <Field label="Vaccine / Batch Cost (KSh, optional)">
                <Input
                  type="number"
                  min={0}
                  value={adminCost ?? ""}
                  onChange={(e) => setAdminCost(e.target.value ? Number(e.target.value) : undefined)}
                  placeholder="e.g. 850"
                />
              </Field>

              <Field label="Notes / Batch No.">
                <Input
                  value={adminNotes}
                  onChange={(e) => setAdminNotes(e.target.value)}
                  placeholder="e.g. Lasota vial #491, given in morning water"
                />
              </Field>
            </div>

            <div className="flex gap-2 pt-2 border-t border-outline-variant/60">
              <Button variant="gold" className="flex-1" onClick={handleAdministerVaccine}>
                Save Administration
              </Button>
              <Button variant="ghost" onClick={() => setAdministerRecord(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
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
