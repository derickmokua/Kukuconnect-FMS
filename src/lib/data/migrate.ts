import { migrateLocalInventoryToCloud } from "./inventoryRepo";
import { migrateLocalSalesToCloud } from "./salesRepo";
import { migrateLocalExpensesToCloud } from "./expensesRepo";
import { migrateLocalBatchesToCloud } from "./incubationRepo";
import { migrateLocalOrdersToCloud } from "./ordersRepo";
import { getDataMode } from "./mode";

export interface MigrationResult {
  items: number;
  movements: number;
  sales: number;
  expenses: number;
  batches: number;
  orders: number;
}

/** One-click: push all localStorage farm data into Supabase. */
export async function migrateAllLocalDataToCloud(): Promise<MigrationResult> {
  if (getDataMode() !== "cloud") {
    throw new Error("Configure Supabase env vars before migrating.");
  }

  const inv = await migrateLocalInventoryToCloud();
  const sales = await migrateLocalSalesToCloud();
  const expenses = await migrateLocalExpensesToCloud();
  const batches = await migrateLocalBatchesToCloud();
  const orders = await migrateLocalOrdersToCloud();

  return {
    items: inv.items,
    movements: inv.movements,
    sales,
    expenses,
    batches,
    orders,
  };
}
