"use client";

import { sv } from "@bojen/core/i18n/sv";
import { useState } from "react";

const t = sv.security;

export interface StaffRow {
  id: string;
  name: string;
  role: "owner" | "admin" | "mechanic";
  signedInBefore: boolean;
  hasFactor: boolean;
  self: boolean;
}

export function StaffTable({ rows, isOwner }: { rows: StaffRow[]; isOwner: boolean }) {
  const [status, setStatus] = useState<Record<string, string>>({});

  async function act(id: string, action: "revoke" | "reset-factor") {
    const response = await fetch(`/api/staff/${id}/${action}`, { method: "POST" }).catch(
      () => null,
    );
    setStatus((s) => ({
      ...s,
      [id]: response?.ok ? (action === "revoke" ? t.revoked : t.resetDone) : t.failed,
    }));
  }

  const own = rows.find((r) => r.self);
  return (
    <>
      <table className="staff-table">
        <thead>
          <tr>
            <th scope="col">{t.name}</th>
            <th scope="col">{t.role}</th>
            <th scope="col">{t.secondFactor}</th>
            {isOwner ? <th scope="col" /> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.name}</td>
              <td>{t.roles[r.role]}</td>
              <td>{r.signedInBefore ? (r.hasFactor ? t.on : t.off) : t.notSignedIn}</td>
              {isOwner ? (
                <td>
                  {r.self ? null : status[r.id] ? (
                    <span role="status">{status[r.id]}</span>
                  ) : (
                    <>
                      <button
                        type="button"
                        title={t.revokeHelp}
                        aria-label={`${t.revoke}: ${r.name}`}
                        onClick={() => void act(r.id, "revoke")}
                      >
                        {t.revoke}
                      </button>{" "}
                      {r.hasFactor ? (
                        <button
                          type="button"
                          className="secondary"
                          aria-label={`${t.reset}: ${r.name}`}
                          onClick={() => void act(r.id, "reset-factor")}
                        >
                          {t.reset}
                        </button>
                      ) : null}
                    </>
                  )}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
      {own && !own.hasFactor ? (
        <p>
          <a href="/sakerhet/tvafaktor">{t.addOwn}</a>
        </p>
      ) : null}
    </>
  );
}
