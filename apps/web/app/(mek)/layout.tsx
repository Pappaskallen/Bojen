import type { ReactNode } from "react";
import "../(public)/boka/booking.css";
import "../(admin)/admin.css";
import "./mek.css";

/** The mechanic's pages, made for a phone in the field (step 5.5). */
export default function MechanicLayout({ children }: { children: ReactNode }) {
  return <div className="booking-page">{children}</div>;
}
