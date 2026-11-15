/// <reference lib="webworker" />
/**
 * The service worker (byggplan step 5.5b), built by Serwist into `public/sw.js`.
 *
 * It keeps as little as possible on the phone: the app's own static files (precached), the
 * mechanic's day view, so `/idag` opens without coverage, and the picture of each visit's boat
 * on it (step 5.5d). Nothing else is cached: not the customer or boat cards, and never a form
 * post or an access code (those are never in a page). The day view and the pictures are kept
 * for two days at most.
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
      // The boat pictures on the day view, so the mechanic sees which boat it is offline too.
      matcher: ({ request, url, sameOrigin }) =>
        sameOrigin &&
        request.method === "GET" &&
        /^\/api\/idag\/[0-9a-f-]{36}\/batbild$/.test(url.pathname),
      handler: new NetworkFirst({
        cacheName: "bojen-batbild",
        networkTimeoutSeconds: 3,
        plugins: [new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 2 * 24 * 60 * 60 })],
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
