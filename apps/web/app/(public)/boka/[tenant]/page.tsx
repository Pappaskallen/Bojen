import type { Metadata } from "next";
import { sv } from "@bojen/core/i18n/sv";
import { loadBookingPage } from "../load";
import { BookingWizard } from "../wizard";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { tenant } = await params;
  return { title: `${sv.booking.title(tenant)} – ${sv.app.name}` };
}

export default async function BookingPage({ params, searchParams }: Props) {
  const { tenant } = await params;
  return <BookingWizard {...await loadBookingPage(tenant, await searchParams)} />;
}
