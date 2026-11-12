import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages are shipped as TypeScript source.
  transpilePackages: ["@bojen/core", "@bojen/db", "@bojen/adapters"],
  // Lint and typecheck run as separate turbo tasks and in CI.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
