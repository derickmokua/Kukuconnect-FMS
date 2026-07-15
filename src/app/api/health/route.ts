import { NextResponse } from "next/server";

const CORE_TABLES = [
  "inventory_items",
  "farmer_orders",
  "sales",
  "expenses",
  "incubation_batches",
] as const;

const OPTIONAL_TABLES = ["brooder_lots", "mortality_events"] as const;

async function tableExists(
  baseUrl: string,
  anonKey: string,
  table: string
): Promise<boolean> {
  try {
    const res = await fetch(
      `${baseUrl.replace(/\/$/, "")}/rest/v1/${table}?select=*&limit=0`,
      {
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
        },
        // Avoid hanging health checks
        signal: AbortSignal.timeout(6_000),
        cache: "no-store",
      }
    );
    // 200 = exists (even if RLS returns empty). 404 PGRST205 = missing table.
    if (res.status === 404) return false;
    // 401/403 still means table is routed (exists); RLS may block
    return res.status < 500;
  } catch {
    return false;
  }
}

/**
 * GET /api/health — v1 go-live readiness (safe: no secrets returned).
 */
export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const hasUrl = Boolean(supabaseUrl);
  const hasAnon = Boolean(supabaseAnon);

  const till = process.env.NEXT_PUBLIC_MPESA_TILL ?? "";
  const tillOk =
    Boolean(till) &&
    till !== "123456" &&
    till !== "YOUR TILL / PAYBILL" &&
    !till.toLowerCase().includes("your");

  const staffPhone = (process.env.NEXT_PUBLIC_STAFF_PHONE ?? "").replace(
    /\D/g,
    ""
  );
  let staffNorm = staffPhone;
  if (staffNorm.startsWith("0") && staffNorm.length >= 10) {
    staffNorm = `254${staffNorm.slice(1)}`;
  }
  if (staffNorm.startsWith("7") && staffNorm.length === 9) {
    staffNorm = `254${staffNorm}`;
  }
  const staffOk = /^254\d{9}$/.test(staffNorm);

  const atKey = Boolean(process.env.AFRICASTALKING_API_KEY);
  const atUser = Boolean(process.env.AFRICASTALKING_USERNAME);
  const aiKey = Boolean(process.env.XAI_API_KEY?.trim());

  let schema: {
    reachable: boolean;
    coreOk: boolean;
    missingCore: string[];
    missingOptional: string[];
    message: string;
  } = {
    reachable: false,
    coreOk: false,
    missingCore: [...CORE_TABLES],
    missingOptional: [...OPTIONAL_TABLES],
    message: "Supabase env not set",
  };

  if (hasUrl && hasAnon) {
    const coreResults = await Promise.all(
      CORE_TABLES.map(async (t) => [t, await tableExists(supabaseUrl, supabaseAnon, t)] as const)
    );
    const optionalResults = await Promise.all(
      OPTIONAL_TABLES.map(
        async (t) =>
          [t, await tableExists(supabaseUrl, supabaseAnon, t)] as const
      )
    );

    const missingCore = coreResults.filter(([, ok]) => !ok).map(([t]) => t);
    const missingOptional = optionalResults
      .filter(([, ok]) => !ok)
      .map(([t]) => t);
    const anyReachable = coreResults.some(([, ok]) => ok) || optionalResults.some(([, ok]) => ok);
    // If every probe failed the same way, still report from missing lists
    const allCoreOk = missingCore.length === 0;
    const reachable =
      anyReachable ||
      // network failure → all false; distinguish by attempting auth health
      (await (async () => {
        try {
          const r = await fetch(
            `${supabaseUrl.replace(/\/$/, "")}/auth/v1/health`,
            {
              headers: { apikey: supabaseAnon },
              signal: AbortSignal.timeout(5_000),
              cache: "no-store",
            }
          );
          return r.ok;
        } catch {
          return false;
        }
      })());

    schema = {
      reachable,
      coreOk: allCoreOk,
      missingCore,
      missingOptional,
      message: !reachable
        ? "Cannot reach Supabase (paused project, network, or bad URL)."
        : allCoreOk && missingOptional.length === 0
          ? "All tables present."
          : allCoreOk
            ? `Core OK. Run brooder.sql for: ${missingOptional.join(", ")}`
            : `Run SQL for missing tables: ${missingCore.join(", ")}${
                missingOptional.length
                  ? ` (+ optional ${missingOptional.join(", ")})`
                  : ""
              }`,
    };
  }

  const checks = {
    app: "kukuconnect-v1",
    ok: true,
    cloud: {
      supabaseUrl: hasUrl,
      supabaseAnon: hasAnon,
      ready: hasUrl && hasAnon,
    },
    schema,
    payments: {
      tillConfigured: tillOk,
      tillPreview: tillOk ? `${till.slice(0, 2)}…${till.slice(-2)}` : null,
    },
    notifications: {
      staffPhoneConfigured:
        staffOk || Boolean(staffPhone && staffPhone.length >= 9),
      africastalking: atKey && atUser,
      whatsappWorksWithoutSms: true,
    },
    ai: {
      configured: aiKey,
      provider: "spacexai-xai",
      note: aiKey
        ? "Farm assistant AI enabled"
        : "Rule-based alerts work; set XAI_API_KEY for AI suggestions/chat",
    },
    timestamp: new Date().toISOString(),
  };

  const readyForV1 =
    checks.cloud.ready &&
    checks.payments.tillConfigured &&
    schema.coreOk;

  return NextResponse.json({
    ...checks,
    v1: {
      ready: readyForV1,
      message: readyForV1
        ? "Core env + schema ready — stock, staff login, deploy smoke test."
        : !checks.cloud.ready
          ? "Set Supabase URL/anon key."
          : !schema.coreOk
            ? schema.message
            : "Set a real NEXT_PUBLIC_MPESA_TILL for v1 orders.",
    },
  });
}
