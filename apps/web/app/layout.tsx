import type { Metadata } from "next";
import type { ReactNode } from "react";
import { sv } from "@bojen/core/i18n/sv";

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
