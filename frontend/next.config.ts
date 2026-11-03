import type { NextConfig } from "next";

// The browser talks only to Next.js. /api/* is proxied to FastAPI, so the session
// cookie stays first-party and no CORS is needed.
const API_URL = process.env.VEYRA_API_URL ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }];
  },
};

export default nextConfig;
