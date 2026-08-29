import { loadJson, saveJson } from "./storage";
import { type BrooderLot, ageDays, todayIsoLocal } from "./brooder";

export const VACCINES_STORAGE_KEY = "kukuconnect-vaccination-records";

export interface VaccineTemplate {
  id: string;
  name: string;
  targetAgeDays: number;
  ageLabel: string;
  disease: string;
  method: "Drinking water" | "Eye drop" | "Wing web puncture" | "Intramuscular" | "Subcutaneous / Hatchery" | "Oral";
  notes: string;
  isMandatory: boolean;
}

/** Standard Kenya Poultry Vaccination Protocol (Kuroiler, Rainbow Rooster, Improved Kienyeji) */
export const STANDARD_VACCINE_PROTOCOLS: VaccineTemplate[] = [
  {
    id: "mareks_day1",
    name: "Marek's Disease & Anti-Stress Vitamins",
    targetAgeDays: 1,
    ageLabel: "Day 1",
    disease: "Marek's Disease",
    method: "Subcutaneous / Hatchery",
    notes: "Administered at hatchery or upon placement. Provide Glucose + Multi-vitamins in water.",
    isMandatory: true,
  },
  {
    id: "nd_ib_day7",
    name: "Newcastle Disease (ND) + IB (1st Dose)",
    targetAgeDays: 7,
    ageLabel: "Day 7 (1 Week)",
    disease: "Newcastle Disease & Infectious Bronchitis",
    method: "Eye drop",
    notes: "Lasota / Clone 30. Withhold water for 1-2 hours before giving vaccine.",
    isMandatory: true,
  },
  {
    id: "gumboro_day10",
    name: "Gumboro (IBD - 1st Dose)",
    targetAgeDays: 10,
    ageLabel: "Day 10 - 14",
    disease: "Infectious Bursal Disease",
    method: "Drinking water",
    notes: "Use non-chlorinated cool water with skimmed milk powder (2g/L) to protect the virus.",
    isMandatory: true,
  },
  {
    id: "nd_ib_day21",
    name: "Newcastle Disease (ND) + IB Booster (2nd Dose)",
    targetAgeDays: 21,
    ageLabel: "Day 21 (3 Weeks)",
    disease: "Newcastle Disease & Infectious Bronchitis",
    method: "Drinking water",
    notes: "Lasota booster in drinking water. Crucial immunity reinforcement.",
    isMandatory: true,
  },
  {
    id: "gumboro_day24",
    name: "Gumboro (IBD 2nd Booster)",
    targetAgeDays: 24,
    ageLabel: "Day 24 - 28 (4 Weeks)",
    disease: "Infectious Bursal Disease",
    method: "Drinking water",
    notes: "Protects growing birds against late field outbreaks.",
    isMandatory: true,
  },
  {
    id: "fowl_pox_day42",
    name: "Fowl Pox Vaccine",
    targetAgeDays: 42,
    ageLabel: "Day 42 (6 Weeks)",
    disease: "Fowl Pox",
    method: "Wing web puncture",
    notes: "Use a two-pronged needle into the wing membrane avoiding blood vessels.",
    isMandatory: true,
  },
  {
    id: "fowl_typhoid_day56",
    name: "Fowl Typhoid + Deworming",
    targetAgeDays: 56,
    ageLabel: "Day 56 (8 Weeks / 2 Months)",
    disease: "Fowl Typhoid & Internal Parasites",
    method: "Intramuscular",
    notes: "Inject in breast muscle. Administer broad-spectrum dewormer in water simultaneously.",
    isMandatory: false,
  },
];

export interface VaccinationRecord {
  id: string;
  lotId: string;
  lotName: string;
  vaccineId: string;
  vaccineName: string;
  targetAgeDays: number;
  ageLabel: string;
  disease: string;
  method: string;
  dueDate: string; // YYYY-MM-DD
  status: "pending" | "completed" | "skipped";
  administeredDate?: string;
  administeredBy?: string;
  cost?: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export function computeDueDate(hatchDate: string, days: number): string {
  const [y, m, d] = hatchDate.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function loadVaccinationRecordsLocal(): VaccinationRecord[] {
  return loadJson<VaccinationRecord[]>(VACCINES_STORAGE_KEY, []);
}

export function saveVaccinationRecordsLocal(records: VaccinationRecord[]): void {
  saveJson(VACCINES_STORAGE_KEY, records);
}

/**
 * Ensures a brooder lot has its vaccination schedule initialized.
 */
export function ensureLotVaccinations(
  lot: BrooderLot,
  existingRecords: VaccinationRecord[]
): { records: VaccinationRecord[]; addedCount: number } {
  const lotRecords = existingRecords.filter((r) => r.lotId === lot.id);
  const existingVaccineIds = new Set(lotRecords.map((r) => r.vaccineId));

  const newRecords: VaccinationRecord[] = [];
  const now = new Date().toISOString();

  for (const template of STANDARD_VACCINE_PROTOCOLS) {
    if (!existingVaccineIds.has(template.id)) {
      const dueDate = computeDueDate(lot.hatchDate, template.targetAgeDays);
      newRecords.push({
        id: `vac-${lot.id}-${template.id}`,
        lotId: lot.id,
        lotName: lot.name,
        vaccineId: template.id,
        vaccineName: template.name,
        targetAgeDays: template.targetAgeDays,
        ageLabel: template.ageLabel,
        disease: template.disease,
        method: template.method,
        dueDate,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  if (newRecords.length === 0) {
    return { records: existingRecords, addedCount: 0 };
  }

  const updated = [...existingRecords, ...newRecords];
  saveVaccinationRecordsLocal(updated);
  return { records: updated, addedCount: newRecords.length };
}

/**
 * Marks a vaccination record as administered
 */
export function markVaccineAdministered(
  records: VaccinationRecord[],
  recordId: string,
  data: {
    administeredDate?: string;
    administeredBy?: string;
    cost?: number;
    notes?: string;
  }
): VaccinationRecord[] {
  const now = new Date().toISOString();
  const updated = records.map((r) => {
    if (r.id !== recordId) return r;
    return {
      ...r,
      status: "completed" as const,
      administeredDate: data.administeredDate || todayIsoLocal(),
      administeredBy: data.administeredBy || "Staff",
      cost: data.cost ?? r.cost,
      notes: data.notes ?? r.notes,
      updatedAt: now,
    };
  });
  saveVaccinationRecordsLocal(updated);
  return updated;
}

/**
 * Marks a vaccine as skipped
 */
export function markVaccineSkipped(
  records: VaccinationRecord[],
  recordId: string,
  reason: string
): VaccinationRecord[] {
  const now = new Date().toISOString();
  const updated = records.map((r) => {
    if (r.id !== recordId) return r;
    return {
      ...r,
      status: "skipped" as const,
      notes: reason ? `Skipped: ${reason}` : r.notes,
      updatedAt: now,
    };
  });
  saveVaccinationRecordsLocal(updated);
  return updated;
}

export interface VaccineSummary {
  dueToday: VaccinationRecord[];
  overdue: VaccinationRecord[];
  upcomingNext7Days: VaccinationRecord[];
  completedCount: number;
  pendingCount: number;
}

export function getVaccineSummary(
  records: VaccinationRecord[],
  activeLots: BrooderLot[],
  today = todayIsoLocal()
): VaccineSummary {
  const activeLotIds = new Set(activeLots.map((l) => l.id));
  const activeRecords = records.filter((r) => activeLotIds.has(r.lotId));

  const [y, m, d] = today.split("-").map(Number);
  const nowDate = new Date(y, m - 1, d);
  const next7Date = new Date(nowDate);
  next7Date.setDate(next7Date.getDate() + 7);
  const next7Iso = `${next7Date.getFullYear()}-${String(next7Date.getMonth() + 1).padStart(2, "0")}-${String(next7Date.getDate()).padStart(2, "0")}`;

  const dueToday: VaccinationRecord[] = [];
  const overdue: VaccinationRecord[] = [];
  const upcomingNext7Days: VaccinationRecord[] = [];
  let completedCount = 0;
  let pendingCount = 0;

  for (const r of activeRecords) {
    if (r.status === "completed") {
      completedCount++;
      continue;
    }
    if (r.status === "pending") {
      pendingCount++;
      if (r.dueDate === today) {
        dueToday.push(r);
      } else if (r.dueDate < today) {
        overdue.push(r);
      } else if (r.dueDate > today && r.dueDate <= next7Iso) {
        upcomingNext7Days.push(r);
      }
    }
  }

  return {
    dueToday,
    overdue,
    upcomingNext7Days,
    completedCount,
    pendingCount,
  };
}
