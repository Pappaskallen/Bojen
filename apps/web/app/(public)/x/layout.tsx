import type { ReactNode } from "react";
import "../boka/booking.css";

export default function CustomerLayout({ children }: { children: ReactNode }) {
  return <main className="booking-page">{children}</main>;
}
