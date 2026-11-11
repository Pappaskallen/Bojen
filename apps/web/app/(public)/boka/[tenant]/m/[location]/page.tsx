import { loadBookingPage } from "../../../load";
import { BookingWizard } from "../../../wizard";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ tenant: string; location: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** The marina's own link (W7): the place is chosen already. */
export default async function MarinaBookingPage({ params, searchParams }: Props) {
  const { tenant, location } = await params;
  return <BookingWizard {...await loadBookingPage(tenant, await searchParams, location)} />;
}
