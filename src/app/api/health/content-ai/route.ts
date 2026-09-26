import { NextResponse } from "next/server";
import { contentAiConfigured } from "@/lib/contentAi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    { configured: contentAiConfigured() },
    { headers: { "cache-control": "no-store" } },
  );
}
