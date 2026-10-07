import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ffmpeg-static computes its binary path from __dirname; bundling it into
  // .next/server/chunks points at a binary that does not exist on Vercel.
  serverExternalPackages: ["ffmpeg-static"],
  outputFileTracingIncludes: {
    "/api/nureta/video-prompt": ["./node_modules/ffmpeg-static/ffmpeg"],
    "/api/jobs/*": ["./node_modules/ffmpeg-static/ffmpeg"],
    "/api/webhooks/provider/*": ["./node_modules/ffmpeg-static/ffmpeg"],
  },
  images: {
    // Konkrét hostok – saját asset host + Supabase Storage (signed URL-ek)
    remotePatterns: [
      ...(process.env.NEXT_PUBLIC_ASSET_HOST
        ? [{ protocol: "https" as const, hostname: process.env.NEXT_PUBLIC_ASSET_HOST }]
        : []),
      { protocol: "https" as const, hostname: "**.supabase.co" },
    ],
  },
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      ],
    }];
  },
};

export default nextConfig;
