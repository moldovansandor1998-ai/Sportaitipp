// Tényleges provider-státusz + szerver által engedélyezett opciók – titok nem megy ki.
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { allowedI2vModels } from "@/lib/providers/modelAllowlist";

export async function GET() {
  const isProd = process.env.NODE_ENV === "production";
  const hasFal = Boolean(process.env.FAL_KEY);
  const hasRep = Boolean(process.env.REPLICATE_API_TOKEN);
  let mode: "mock" | "fal" | "replicate" | "none" = "none";
  if (hasFal) mode = "fal";
  else if (hasRep) mode = "replicate";
  else if (!isProd) mode = "mock";


  const talkingModels = mode === "fal" ? [{ id: "sync-lips", label: "Sync Lips (fal.ai)" }] : [];
  return NextResponse.json({ mode, production: isProd, i2vModels: allowedI2vModels(), talkingModels });
}
