import Link from "next/link";
import { crm } from "@bojen/core/i18n/sv";

type Page =
  | "overview"
  | "today"
  | "tasks"
  | "requests"
  | "pipeline"
  | "customers"
  | "places"
  | "campaigns"
  | "security";

const LINKS: { page: Page; href: string }[] = [
  { page: "overview", href: "/oversikt" },
  { page: "today", href: "/idag" },
  { page: "tasks", href: "/idag/arenden" },
  { page: "requests", href: "/forfragningar" },
  { page: "pipeline", href: "/pipeline" },
  { page: "customers", href: "/kunder" },
  { page: "places", href: "/marinor" },
  { page: "campaigns", href: "/kampanjer" },
  { page: "security", href: "/sakerhet" },
];

/** The menu on the staff pages; the page you are on is not a link. */
export function AdminNav({ current }: { current: Page }) {
  return (
    <nav className="admin-nav" aria-label={crm.nav.label}>
      {LINKS.map(({ page, href }) =>
        page === current ? (
          <span key={page} aria-current="page">
            {crm.nav[page]}
          </span>
        ) : (
          <Link key={page} href={href}>
            {crm.nav[page]}
          </Link>
        ),
      )}
    </nav>
  );
}
