import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
