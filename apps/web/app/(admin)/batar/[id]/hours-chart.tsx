import { crm } from "@bojen/core/i18n/sv";

/**
 * Running hours over time, one line per engine (step 5.2). Drawn on the server as plain SVG:
 * one y-axis (hours), recessive grid, 2 px lines and 8 px markers, a native tooltip on each
 * reading, a legend when there is more than one engine, and the readings as a table beside it
 * (the third series colour is below 3:1 against the page, so the table carries the values).
 */
export interface HoursSeries {
  label: string;
  points: { hours: number; readAt: Date; source: string }[];
}

/** Categorical slots 1–3 of the validated palette (dataviz skill, light surface). */
const COLORS = ["#2a78d6", "#eb6834", "#1baf7a"];

const W = 640;
const H = 240;
const PAD = { top: 16, right: 16, bottom: 32, left: 48 };

const day = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", dateStyle: "short" });
const month = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Stockholm",
  month: "short",
  year: "numeric",
});

/** Round numbers for the hour axis: 0, and steps of 1, 2 or 5 × 10^n. */
function ticks(max: number): number[] {
  const raw = max / 4;
  const power = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? power * 10;
  const out: number[] = [];
  for (let v = 0; v <= max + step / 2; v += step) out.push(v);
  return out;
}

export function HoursChart({ series }: { series: HoursSeries[] }) {
  const all = series.flatMap((s) => s.points);
  if (all.length === 0) return <p>{crm.boat.noHours}</p>;

  const times = all.map((p) => p.readAt.getTime());
  const first = Math.min(...times);
  const last = Math.max(...times);
  const span = Math.max(last - first, 24 * 3_600_000);
  const yTicks = ticks(Math.max(...all.map((p) => p.hours)) * 1.05);
  const top = yTicks.at(-1) ?? 1;
  const x = (t: number) =>
    PAD.left +
    ((t - (last - first < 1 ? first - span / 2 : first)) / span) * (W - PAD.left - PAD.right);
  const y = (h: number) => H - PAD.bottom - (h / top) * (H - PAD.top - PAD.bottom);

  return (
    <figure className="hours-chart">
      {series.length > 1 ? (
        <ul className="legend" aria-label={crm.boat.engine}>
          {series.map((s, i) => (
            <li key={s.label}>
              <span className="swatch" style={{ background: COLORS[i % COLORS.length] }} />
              {s.label}
            </li>
          ))}
        </ul>
      ) : null}
      <svg viewBox={`0 0 ${String(W)} ${String(H)}`} role="img" aria-label={crm.boat.hours}>
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} className="grid" />
            <text
              x={PAD.left - 8}
              y={y(v)}
              className="tick"
              textAnchor="end"
              dominantBaseline="middle"
            >
              {v}
            </text>
          </g>
        ))}
        <text x={PAD.left} y={H - 8} className="tick" textAnchor="start">
          {month.format(new Date(first))}
        </text>
        {last > first ? (
          <text x={W - PAD.right} y={H - 8} className="tick" textAnchor="end">
            {month.format(new Date(last))}
          </text>
        ) : null}
        {series.map((s, i) => {
          const color = COLORS[i % COLORS.length];
          const points = s.points.map(
            (p) => `${x(p.readAt.getTime()).toFixed(1)},${y(p.hours).toFixed(1)}`,
          );
          return (
            <g key={s.label}>
              {points.length > 1 ? (
                <polyline points={points.join(" ")} fill="none" stroke={color} strokeWidth={2} />
              ) : null}
              {s.points.map((p) => (
                <circle
                  key={p.readAt.toISOString()}
                  cx={x(p.readAt.getTime())}
                  cy={y(p.hours)}
                  r={4}
                  fill={color}
                  stroke="#fff"
                  strokeWidth={2}
                >
                  <title>{`${s.label}: ${String(p.hours)} h, ${day.format(p.readAt)}`}</title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>
      <figcaption className="help">{crm.boat.hoursAxis}</figcaption>
      <table className="hours-table">
        <caption>{crm.boat.hoursTable}</caption>
        <thead>
          <tr>
            {series.length > 1 ? <th scope="col">{crm.boat.engine}</th> : null}
            <th scope="col">{crm.boat.readAt}</th>
            <th scope="col">{crm.boat.hoursColumn}</th>
            <th scope="col">{crm.boat.source}</th>
          </tr>
        </thead>
        <tbody>
          {series.flatMap((s) =>
            [...s.points].reverse().map((p) => (
              <tr key={`${s.label}-${p.readAt.toISOString()}`}>
                {series.length > 1 ? <td>{s.label}</td> : null}
                <td>{day.format(p.readAt)}</td>
                <td>{p.hours}</td>
                <td>{crm.hoursSource[p.source as keyof typeof crm.hoursSource] ?? p.source}</td>
              </tr>
            )),
          )}
        </tbody>
      </table>
    </figure>
  );
}
