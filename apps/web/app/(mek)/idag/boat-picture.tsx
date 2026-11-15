import Link from "next/link";
import { crm } from "@bojen/core/i18n/sv";

/**
 * The picture of the visit's boat, at the top of the visit (step 5.5d), so the mechanic sees
 * at once which boat to work on. Its address stays the same, so the service worker keeps it
 * for the day view without coverage. A tap opens the boat card.
 */
export function BoatPicture({
  visitId,
  boatId,
  label,
}: {
  visitId: string;
  boatId: string | null;
  label: string;
}) {
  // eslint-disable-next-line @next/next/no-img-element -- a private picture through our own route
  const img = <img src={`/api/idag/${visitId}/batbild`} alt={crm.day.boatPicture(label)} />;
  return (
    <div className="boat-picture">
      {boatId ? <Link href={`/batar/${boatId}`}>{img}</Link> : img}
    </div>
  );
}
