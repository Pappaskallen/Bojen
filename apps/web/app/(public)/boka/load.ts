import { findFirm, publicCatalog } from "@bojen/db";
import { notFound } from "next/navigation";
import { db } from "../../../lib/server";
import type { WizardProps } from "./wizard";

/** Everything the booking page needs, read on the server. Unknown firms give 404. */
export async function loadBookingPage(
  slug: string,
  query: Record<string, string | string[] | undefined>,
  placeSlug?: string,
): Promise<WizardProps> {
  const firm = await findFirm(db(), slug);
  if (!firm) notFound();
  const { services, places } = await publicCatalog(db(), firm.tenantId);
  const preselectedPlace = placeSlug ? places.find((p) => p.slug === placeSlug) : undefined;
  if (placeSlug && !preselectedPlace) notFound();
  const serviceParam = typeof query.tjanst === "string" ? query.tjanst : undefined;

  return {
    firm: {
      slug: firm.slug,
      name: firm.name,
      color: firm.color,
      logoUrl: firm.logoUrl,
      calloutPriceOre: firm.calloutPriceOre,
    },
    services,
    places: places.map((p) => ({ id: p.id, name: p.name })),
    initialPlaceId: preselectedPlace?.id ?? null,
    initialServiceId: services.find((s) => s.id === serviceParam)?.id ?? null,
    embed: query.embed === "1",
    today: new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(new Date()),
  };
}
