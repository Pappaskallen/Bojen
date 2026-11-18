import type { Metadata } from "next";
import { legal, sv } from "@bojen/core/i18n/sv";
import "./legal.css";

/**
 * The public list of sub-processors (Avslutande kontroll, juridik; spec 10.1). The data
 * processing agreement points here, so the list is a page anyone can open.
 */
const t = legal.subprocessors;

export const metadata: Metadata = { title: `${t.title} – ${sv.app.name}` };

export default function SubprocessorsPage() {
  return (
    <main className="legal">
      <h1>{t.title}</h1>
      <p>{t.intro}</p>
      <table>
        <thead>
          <tr>
            {t.headers.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {t.rows.map((row) => (
            <tr key={row.name}>
              <th scope="row">
                {row.name}
                {row.status === "planned" ? (
                  <>
                    <br />
                    <small>{t.planned}</small>
                  </>
                ) : null}
              </th>
              <td>{row.purpose}</td>
              <td>{row.data}</td>
              <td>{row.where}</td>
              <td>{row.safeguard}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>{t.pushNote}</p>
      <p>{t.contact}</p>
      <p>
        <small>{t.updated}</small>
      </p>
    </main>
  );
}
