import { describe, it, expect, beforeEach } from "vitest";
import {
  ensureLotVaccinations,
  markVaccineAdministered,
  markVaccineSkipped,
  getVaccineSummary,
  STANDARD_VACCINE_PROTOCOLS,
  type VaccinationRecord,
} from "../lib/vaccines";
import {
  buildCustomerDirectory,
  buildFollowUpTasks,
  generateFollowUpWhatsAppUrl,
  normalizePhoneKey,
} from "../lib/crm";
import { type BrooderLot, createLot } from "../lib/brooder";
import { type FarmerOrder } from "../lib/orders";
import { type Sale } from "../lib/sales";

describe("Vaccination Schedule Engine", () => {
  let sampleLot: BrooderLot;

  beforeEach(() => {
    localStorage.clear();
    sampleLot = createLot({
      name: "Kuroiler Batch #1",
      hatchDate: "2026-08-01",
      quantity: 200,
      breed: "Kuroiler",
      brooder: "House 1",
    });
  });

  it("should initialize the full standard Kenya vaccination protocol for a new lot", () => {
    const { records, addedCount } = ensureLotVaccinations(sampleLot, []);
    expect(addedCount).toBe(STANDARD_VACCINE_PROTOCOLS.length);
    expect(records.length).toBe(STANDARD_VACCINE_PROTOCOLS.length);

    // Verify Day 1 Marek's due date calculation
    const mareks = records.find((r) => r.vaccineId === "mareks_day1");
    expect(mareks).toBeDefined();
    expect(mareks?.dueDate).toBe("2026-08-02");
    expect(mareks?.status).toBe("pending");

    // Verify Day 7 Newcastle due date
    const nd7 = records.find((r) => r.vaccineId === "nd_ib_day7");
    expect(nd7).toBeDefined();
    expect(nd7?.dueDate).toBe("2026-08-08");

    // Re-running ensureLotVaccinations should be idempotent
    const rerun = ensureLotVaccinations(sampleLot, records);
    expect(rerun.addedCount).toBe(0);
    expect(rerun.records.length).toBe(records.length);
  });

  it("should record vaccine administration accurately", () => {
    const { records } = ensureLotVaccinations(sampleLot, []);
    const firstRecord = records[0];

    const updated = markVaccineAdministered(records, firstRecord.id, {
      administeredDate: "2026-08-02",
      administeredBy: "Samuel (Tech)",
      cost: 500,
      notes: "Batch #781 given in morning water",
    });

    const target = updated.find((r) => r.id === firstRecord.id);
    expect(target?.status).toBe("completed");
    expect(target?.administeredBy).toBe("Samuel (Tech)");
    expect(target?.cost).toBe(500);
    expect(target?.notes).toBe("Batch #781 given in morning water");
  });

  it("should categorize due today, overdue, and upcoming vaccines accurately", () => {
    const { records } = ensureLotVaccinations(sampleLot, []);
    const summary = getVaccineSummary(records, [sampleLot], "2026-08-08"); // Check as of Day 7

    expect(summary.dueToday.length).toBe(1); // Day 7 Newcastle is due on 2026-08-08
    expect(summary.overdue.length).toBe(1); // Day 1 Marek's was due on 2026-08-02
    expect(summary.upcomingNext7Days.length).toBeGreaterThanOrEqual(1); // Day 10 Gumboro due on 2026-08-11
  });
});

describe("Farmer CRM & Post-Sale Follow-Up Engine", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("should normalize various Kenyan phone number formats into standard key", () => {
    expect(normalizePhoneKey("0716883375")).toBe("254716883375");
    expect(normalizePhoneKey("+254 716 883 375")).toBe("254716883375");
    expect(normalizePhoneKey("716883375")).toBe("254716883375");
    expect(normalizePhoneKey("254112345678")).toBe("254112345678");
  });

  it("should aggregate orders and walk-in sales into a unified customer profile with auto-tags", () => {
    const orders: FarmerOrder[] = [
      {
        id: "ord-1",
        customerName: "Grace Mwende",
        customerPhone: "0712345678",
        location: "Kitui Town",
        items: [{ itemId: "chick_day_old", name: "Day-old Chicks", qty: 100, unitPrice: 110 }],
        total: 11000,
        status: "fulfilled",
        createdAt: "2026-08-10T10:00:00Z",
      },
      {
        id: "ord-2",
        customerName: "Grace Mwende",
        customerPhone: "254712345678",
        location: "Kitui Town",
        items: [{ itemId: "chick_month1", name: "1-Month Chicks", qty: 50, unitPrice: 250 }],
        total: 12500,
        status: "fulfilled",
        createdAt: "2026-08-20T14:00:00Z",
      },
    ];

    const sales: Sale[] = [
      {
        id: "sale-1",
        customer: "Grace Mwende",
        customerPhone: "0712345678",
        items: [{ itemId: "chick_week2", name: "2-weeks Chicks", qty: 20, price: 160 }],
        total: 3200,
        createdAt: "2026-08-25T11:00:00Z",
        dateLabel: "25 Aug 2026",
      },
    ];

    const customers = buildCustomerDirectory(orders, sales);
    expect(customers.length).toBe(1);

    const grace = customers[0];
    expect(grace.name).toBe("Grace Mwende");
    expect(grace.totalOrdersCount).toBe(3); // 2 web orders + 1 POS sale
    expect(grace.totalSpend).toBe(26700); // 11000 + 12500 + 3200
    expect(grace.totalChicksBought).toBe(170); // 100 + 50 + 20
    expect(grace.tags).toContain("Repeat Customer");
    expect(grace.tags).toContain("VIP / High Value");
    expect(grace.tags).toContain("Commercial Brooder");
  });

  it("should generate Day 3, Day 14, and Day 30 follow-up tasks with personalized WhatsApp links", () => {
    const orders: FarmerOrder[] = [
      {
        id: "ord-100",
        customerName: "John Musyoka",
        customerPhone: "0722000000",
        location: "Mwingi",
        items: [{ itemId: "chick_day_old", name: "Day-old Chicks", qty: 50, unitPrice: 110 }],
        total: 5500,
        status: "fulfilled",
        createdAt: "2026-08-01T08:00:00Z",
      },
    ];

    const tasks = buildFollowUpTasks(orders, [], "2026-08-04");
    expect(tasks.length).toBe(3);

    const day3Task = tasks.find((t) => t.milestone === "day3_brooder_check");
    expect(day3Task).toBeDefined();
    expect(day3Task?.dueDate).toBe("2026-08-04");

    const waUrl = generateFollowUpWhatsAppUrl(day3Task!);
    expect(waUrl).toContain("254722000000");
    expect(decodeURIComponent(waUrl)).toContain("Habari John Musyoka!");
    expect(decodeURIComponent(waUrl)).toContain("KukuConnect Kitui");
  });
});
