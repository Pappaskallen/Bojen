"use client";

import { sv } from "@bojen/core/i18n/sv";

export function SignOutButton() {
  return (
    <button
      type="button"
      className="secondary"
      onClick={() =>
        void fetch("/api/auth/logout", { method: "POST" }).finally(() =>
          window.location.assign("/logga-in"),
        )
      }
    >
      {sv.signIn.signOut}
    </button>
  );
}
