import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Turbopack's dev disk cache (default on in Next 16) kept serving an old
    // Tailwind CSS after restarts: classes added in files edited while the
    // server was stopped were missing, and pages could load unstyled.
    // A cold start compiles a few seconds slower, but the CSS is always current.
    turbopackFileSystemCacheForDev: false,
  },
};

export default nextConfig;
