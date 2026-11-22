/**
 * The Content Security Policy (ASVS V14.4, V50.2). Everything the pages load and call is on
 * this site. Scripts need the response's nonce, which Next.js puts on its own scripts when the
 * policy comes in the request (see middleware.ts), so no inline script runs without it;
 * 'strict-dynamic' lets those scripts load Next's chunks. Styles keep 'unsafe-inline' for
 * React's style attributes, which cannot carry a nonce.
 */

/** A fresh nonce per response: 16 random bytes in base64. */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/** The booking pages may be framed by the widget on any site; nothing else may be framed. */
export function framesAllowed(pathname: string): boolean {
  return pathname === "/boka" || pathname.startsWith("/boka/");
}

export function contentSecurityPolicy(nonce: string, frameable: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
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
    ...(frameable ? [] : ["frame-ancestors 'none'"]),
  ].join("; ");
}
