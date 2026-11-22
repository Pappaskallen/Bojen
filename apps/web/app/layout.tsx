import type { Metadata } from "next";
import type { ReactNode } from "react";
import { sv } from "@bojen/core/i18n/sv";

/**
 * Every page is rendered per request, so Next.js can put the response's nonce on its scripts
 * (the Content Security Policy in middleware.ts). A page built ahead would carry none.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: sv.app.name,
  description: sv.app.tagline,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="sv">
      <body>{children}</body>
    </html>
  );
}
