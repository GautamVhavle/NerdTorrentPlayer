import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep Vercel's Next.js artifacts separate from vinext's generated files so
  // both deployment targets can be built and type-checked in either order.
  distDir: ".next-vercel",
};

export default nextConfig;
