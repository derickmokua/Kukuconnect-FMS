import { NextResponse } from "next/server";
import {
  ASSISTANT_SYSTEM_PROMPT,
  buildPerformanceInsights,
  snapshotToPromptText,
  type FarmSnapshot,
  type PerformanceInsight,
} from "@/lib/insights";

export const runtime = "nodejs";

type Body = {
  /** @deprecated chat removed from product focus — still accepted but discouraged */
  action?: "brief" | "suggest" | "chat";
  snapshot?: FarmSnapshot;
  insights?: PerformanceInsight[];
  message?: string;
};

function isAiConfigured(): boolean {
  return Boolean(process.env.XAI_API_KEY?.trim());
}

async function callGrok(
  messages: { role: "system" | "user" | "assistant"; content: string }[]
): Promise<string> {
  const apiKey = process.env.XAI_API_KEY?.trim();
  if (!apiKey) throw new Error("XAI_API_KEY is not set");

  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.XAI_MODEL?.trim() || "grok-4.5",
      temperature: 0.3,
      max_tokens: 700,
      messages,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error("xAI error", res.status, errText);
    throw new Error(`AI request failed (${res.status})`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("Empty AI response");
  return text;
}

export async function GET() {
  return NextResponse.json({
    ai: {
      configured: isAiConfigured(),
      provider: "spacexai-xai",
      mode: "business-insights",
      model: process.env.XAI_MODEL?.trim() || "grok-4.5",
    },
  });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const action = body.action === "chat" ? "brief" : body.action ?? "brief";
    const snapshot = body.snapshot;

    if (!snapshot) {
      return NextResponse.json(
        { error: "snapshot is required" },
        { status: 400 }
      );
    }

    const insights =
      body.insights?.length
        ? body.insights
        : buildPerformanceInsights(snapshot);
    const aiEnabled = isAiConfigured();

    if (!aiEnabled) {
      return NextResponse.json({
        aiEnabled: false,
        insights,
        brief: ruleBasedBrief(insights, snapshot),
        message:
          "Insights are rule-based from your farm data. Add XAI_API_KEY for a richer AI performance brief.",
      });
    }

    const brief = await callGrok([
      { role: "system", content: ASSISTANT_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Write a performance brief for hatchery staff.

Prioritise feed efficiency if feed is burning fast or is a high share of costs. Give concrete savings actions (wastage, feeder setup, matching feed to age, bulk buying discipline, selling birds before they eat the margin).

SNAPSHOT:
${snapshotToPromptText(snapshot)}

COMPUTED INSIGHTS:
${insights
  .map(
    (i) =>
      `- [${i.severity}/${i.area}] ${i.title}: ${i.finding} → ${i.recommendation}`
  )
  .join("\n")}`,
      },
    ]);

    return NextResponse.json({
      aiEnabled: true,
      insights,
      brief,
    });
  } catch (err) {
    console.error("Assistant API error", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Insights request failed.",
      },
      { status: 500 }
    );
  }
}

function ruleBasedBrief(
  insights: PerformanceInsight[],
  snapshot: FarmSnapshot
): string {
  const top = insights.filter((i) => i.severity !== "good").slice(0, 5);
  if (!top.length) {
    return [
      "Performance looks steady from logged data.",
      `• Birds ~${snapshot.birdsOnFarm} · Feed 7d ${snapshot.feed.spend7d.toLocaleString()} KSh · MTD profit ${snapshot.finance.profit.toLocaleString()} KSh`,
      "• Keep recording every feed purchase and mortality — that powers better feed-saving tips.",
    ].join("\n");
  }
  return [
    "Performance priorities (from your numbers):",
    ...top.map(
      (i) => `• ${i.title}: ${i.recommendation.split(/(?<=\.)\s/)[0]}`
    ),
  ].join("\n");
}
