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

/**
 * Security headers on every response (ASVS V14.4, Avslutande kontroll). The Content Security
 * Policy carries a nonce per response, so it is set in middleware.ts (lib/csp.ts). Off in
 * development, where hot reload needs eval.
 */
const COMMON_HEADERS = [
  // Browsers only heed it over https; two years, as the preload list asks.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The microphone for the mechanic's voice note, the camera for type plates; nothing else.
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(self), geolocation=(), payment=(), usb=()",
  },
];

const nextConfig: NextConfig = {
  // Workspace packages are shipped as TypeScript source.
  transpilePackages: ["@bojen/core", "@bojen/db", "@bojen/adapters"],
  // Lint and typecheck run as separate turbo tasks and in CI.
  eslint: { ignoreDuringBuilds: true },
  // No "X-Powered-By: Next.js".
  poweredByHeader: false,
  headers() {
    if (process.env.NODE_ENV === "development") return Promise.resolve([]);
    return Promise.resolve([
      {
        // Everything but the booking pages: never inside another site's frame.
        source: "/:path((?!boka(?:/|$)).*)",
        headers: [
          ...COMMON_HEADERS,
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
      {
        // The booking pages, which the widget (public/widget.js) frames on the firm's own site:
        // any site may frame them, as before. They change nothing without the customer's input.
        source: "/boka/:path*",
        headers: COMMON_HEADERS,
      },
    ]);
  },
};

export default withSerwist(nextConfig);
