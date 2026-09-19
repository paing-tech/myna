import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Bundle a minimal self-contained server into .next/standalone for Docker
  output: "standalone",
};

export default nextConfig;
