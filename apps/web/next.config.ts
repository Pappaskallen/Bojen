import withSerwistInit from "@serwist/next";
import type { NextConfig } from "next";

/**
 * The service worker for the mechanic's day view (step 5.5b): built from `app/sw.ts` into
 * `public/sw.js` on `next build`, and off in development, where it would only get in the way.
 */
const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
  // Registered by the day view itself, not on every page (see app/(mek)/idag/offline.tsx).
  register: false,
  reloadOnOnline: false,
});

const nextConfig: NextConfig = {
  // Workspace packages are shipped as TypeScript source.
  transpilePackages: ["@bojen/core", "@bojen/db", "@bojen/adapters"],
  // Lint and typecheck run as separate turbo tasks and in CI.
  eslint: { ignoreDuringBuilds: true },
};

export default withSerwist(nextConfig);
