import Link from "next/link";
import type { KpiLevel } from "@bojen/core";
import { crm } from "@bojen/core/i18n/sv";

/** The colour against the target (spec 9.2), with its meaning for screen readers. */
export function Level({ level }: { level: KpiLevel | null }) {
  if (!level) return null;
  return (
    <span className={`level level-${level}`} title={crm.dashboard.level[level]}>
      <span className="visually-hidden">{crm.dashboard.level[level]}</span>
    </span>
  );
}

/** A small card in the grid: the KPI, its value and its colour, opening the details. */
export function KpiCard(props: {
  href: string;
  label: string;
  value: string;
  level: KpiLevel | null;
}) {
  return (
    <Link className={`kpi-card${props.level ? ` is-${props.level}` : ""}`} href={props.href}>
      <span className="kpi-label">{props.label}</span>
      <span className="kpi-value">
        {props.value} <Level level={props.level} />
      </span>
    </Link>
  );
}
