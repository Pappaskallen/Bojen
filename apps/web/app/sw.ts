/// <reference lib="webworker" />
/**
 * The service worker (byggplan step 5.5b), built by Serwist into `public/sw.js`.
 *
 * It keeps as little as possible on the phone: the app's own static files (precached), and
 * the mechanic's day view, so `/idag` opens without coverage. Nothing else is cached: not the
 * customer or boat cards, and never a form post or an access code (those are never in a page).
 * The day view is kept for two days at most.
 */
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { CacheFirst, ExpirationPlugin, NetworkFirst, Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}
declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST ?? [],
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: false,
  runtimeCaching: [
    {
      // The day view, from the network when there is coverage, else the last copy.
      matcher: ({ request, url, sameOrigin }) =>
        sameOrigin && request.method === "GET" && url.pathname === "/idag",
      handler: new NetworkFirst({
        cacheName: "bojen-idag",
        networkTimeoutSeconds: 5,
        plugins: [new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 2 * 24 * 60 * 60 })],
      }),
    },
    {
      // The app's own scripts and styles, which do not change under a name.
      matcher: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith("/_next/static/"),
      handler: new CacheFirst({
        cacheName: "bojen-static",
        plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60 })],
      }),
    },
  ],
});

serwist.addEventListeners();
