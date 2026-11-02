import { NextResponse } from "next/server";
import { elevenLabsSpeechHealth } from "@/lib/providers/elevenLabsStatus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await elevenLabsSpeechHealth(), { headers: { "cache-control": "no-store" } });
}
