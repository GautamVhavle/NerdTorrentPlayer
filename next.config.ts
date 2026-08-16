import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    APP_MODE: process.env.APP_MODE ?? "player",
  },
};

export default nextConfig;
