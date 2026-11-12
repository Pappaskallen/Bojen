import type { ReactNode } from "react";
import "./booking.css";

export default function BookingLayout({ children }: { children: ReactNode }) {
  return <main className="booking-page">{children}</main>;
}
