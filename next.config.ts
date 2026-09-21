import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // Solo HTTPS durante un año (Vercel ya sirve HTTPS; esto evita el downgrade).
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          // Nadie puede meter la app (ni Finanzas ni la puerta) dentro de un iframe ajeno.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
