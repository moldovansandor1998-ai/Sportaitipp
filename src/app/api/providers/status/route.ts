import { NextResponse } from "next/server";
import { buildRouter } from "@/lib/providers";

export const runtime = "nodejs";

export async function GET() {
  const router = buildRouter();
  return NextResponse.json({
    referenceQc: router.candidates("reference_qc").length > 0,
    training: router.candidates("character_training").length > 0,
    testImage: router.candidates("test_image").length > 0,
    identityCheck: router.candidates("identity_check").length > 0,
    generation: router.candidates("image_generation").length > 0,
  });
}
