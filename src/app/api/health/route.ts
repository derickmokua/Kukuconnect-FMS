import { NextResponse } from "next/server";

/**
 * GET /api/health — v1 go-live readiness (safe: no secrets returned).
 */
export async function GET() {
  const supabaseUrl = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const supabaseAnon = Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
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

  const checks = {
    app: "kukuconnect-v1",
    ok: true,
    cloud: {
      supabaseUrl,
      supabaseAnon,
      ready: supabaseUrl && supabaseAnon,
    },
    payments: {
      tillConfigured: tillOk,
      tillPreview: tillOk ? `${till.slice(0, 2)}…${till.slice(-2)}` : null,
    },
    notifications: {
      staffPhoneConfigured: staffOk || Boolean(staffPhone && staffPhone.length >= 9),
      africastalking: atKey && atUser,
      whatsappWorksWithoutSms: true,
    },
    timestamp: new Date().toISOString(),
  };

  const readyForV1 =
    checks.cloud.ready && checks.payments.tillConfigured;

  return NextResponse.json({
    ...checks,
    v1: {
      ready: readyForV1,
      message: readyForV1
        ? "Core env ready — finish Supabase SQL, stock, deploy, and smoke test."
        : "Set Supabase URL/anon key and a real NEXT_PUBLIC_MPESA_TILL for v1.",
    },
  });
}
