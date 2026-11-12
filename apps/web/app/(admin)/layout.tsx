import type { ReactNode } from "react";
import "../(public)/boka/booking.css";

/** Pages for the firm's staff. Same plain styles as the booking page for now. */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <div className="booking-page">{children}</div>;
}
