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
 * Security headers on every response (ASVS V14.4, Avslutande kontroll). Everything the pages
 * load and call is on this site, so the policy allows only 'self'. Next.js puts its own inline
 * scripts in the page, hence 'unsafe-inline' for scripts until the pages use nonces. Off in
 * development, where hot reload needs eval.
 */
function contentSecurityPolicy(frameAncestors: string | null): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    ...(frameAncestors ? [`frame-ancestors ${frameAncestors}`] : []),
  ].join("; ");
}

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
          { key: "Content-Security-Policy", value: contentSecurityPolicy("'none'") },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
      {
        // The booking pages, which the widget (public/widget.js) frames on the firm's own site:
        // any site may frame them, as before. They change nothing without the customer's input.
        source: "/boka/:path*",
        headers: [
          ...COMMON_HEADERS,
          { key: "Content-Security-Policy", value: contentSecurityPolicy(null) },
        ],
      },
    ]);
  },
};

export default withSerwist(nextConfig);
