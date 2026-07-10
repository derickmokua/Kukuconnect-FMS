import { NextResponse } from "next/server";

/**
 * POST /api/notify/sms
 * Body: { phone: "2547...", message: "..." }
 *
 * Uses Africa's Talking when env is set:
 *   AFRICASTALKING_API_KEY
 *   AFRICASTALKING_USERNAME  (sandbox = "sandbox")
 *   AFRICASTALKING_FROM      (optional shortcode / sender ID)
 *
 * Without keys → { skipped: true } so WhatsApp-first flows still work.
 */

type Body = {
  phone?: string;
  message?: string;
};

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const phone = (body.phone ?? "").replace(/\D/g, "");
  const message = (body.message ?? "").trim();

  if (!phone || !message) {
    return NextResponse.json(
      { error: "phone and message are required" },
      { status: 400 }
    );
  }

  if (message.length > 480) {
    return NextResponse.json(
      { error: "Message too long (max 480 chars)" },
      { status: 400 }
    );
  }

  const apiKey = process.env.AFRICASTALKING_API_KEY;
  const username = process.env.AFRICASTALKING_USERNAME;
  const from = process.env.AFRICASTALKING_FROM;

  if (!apiKey || !username) {
    return NextResponse.json({
      ok: false,
      skipped: true,
      reason:
        "Africa's Talking not configured (set AFRICASTALKING_API_KEY + AFRICASTALKING_USERNAME)",
    });
  }

  const params = new URLSearchParams();
  params.set("username", username);
  params.set("to", phone.startsWith("+") ? phone : `+${phone}`);
  params.set("message", message);
  if (from) params.set("from", from);

  // Live vs sandbox host
  const base =
    username === "sandbox"
      ? "https://api.sandbox.africastalking.com"
      : "https://api.africastalking.com";

  try {
    const res = await fetch(`${base}/version1/messaging`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        apiKey,
      },
      body: params.toString(),
    });

    const text = await res.text();
    let data: unknown = text;
    try {
      data = JSON.parse(text);
    } catch {
      /* keep text */
    }

    if (!res.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: `Africa's Talking HTTP ${res.status}`,
          detail: data,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true, provider: "africastalking", data });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "SMS provider error",
      },
      { status: 502 }
    );
  }
}

export async function GET() {
  const configured = Boolean(
    process.env.AFRICASTALKING_API_KEY && process.env.AFRICASTALKING_USERNAME
  );
  return NextResponse.json({
    service: "kukuconnect-sms",
    africastalking: configured ? "configured" : "not_configured",
    hint: configured
      ? "POST { phone, message } to send SMS"
      : "Add AFRICASTALKING_API_KEY and AFRICASTALKING_USERNAME to enable SMS",
  });
}
