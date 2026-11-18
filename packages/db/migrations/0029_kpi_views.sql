-- The KPI views of byggplan step 7.1 (spec 9.1). One row per visit, approved report, job,
-- freed time and mechanic-day, with what the KPIs sum; `kpiTotals` in src/kpi.ts sums them
-- for a period. The worker refreshes them every 15 minutes (`kpi.refresh()`).
--
-- Materialized views have no Row Level Security, so they live in their own schema that
-- signed-in users cannot reach at all; only the server reads them, always by tenant.
-- Dates are Stockholm dates.
CREATE SCHEMA IF NOT EXISTS kpi;--> statement-breakpoint
REVOKE ALL ON SCHEMA kpi FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON SCHEMA kpi FROM anon, authenticated;--> statement-breakpoint

-- Visits, with their place on the day (the boat's placement) and the drive from the
-- mechanic's previous place that day (KPI 4, 6, 7, 8, 9, 14).
CREATE MATERIALIZED VIEW kpi.visit_fact AS
WITH v AS (
  SELECT vi.tenant_id, vi.id AS visit_id, vi.job_id, vi.mechanic_id, j.service_type_id,
         lower(vi.time_window) AS start_at,
         (lower(vi.time_window) AT TIME ZONE 'Europe/Stockholm')::date AS day,
         vi.status::text AS status, vi.availability_status::text AS availability_status,
         vi.planned_minutes,
         (SELECT bp.location_id FROM boat_placement bp
           WHERE bp.tenant_id = vi.tenant_id AND bp.boat_id = j.boat_id AND bp.deleted_at IS NULL
             AND bp.valid_during @> (lower(vi.time_window) AT TIME ZONE 'Europe/Stockholm')::date
           ORDER BY bp.created_at DESC LIMIT 1) AS location_id
  FROM visit vi
  JOIN job j ON j.tenant_id = vi.tenant_id AND j.id = vi.job_id AND j.deleted_at IS NULL
  WHERE vi.deleted_at IS NULL
), driven AS (
  SELECT visit_id,
         lag(location_id) OVER (PARTITION BY tenant_id, mechanic_id, day ORDER BY start_at) AS previous_location_id
  FROM v
  WHERE status IN ('done', 'no_access') AND mechanic_id IS NOT NULL
)
SELECT v.*,
       CASE
         WHEN d.previous_location_id IS NULL OR v.location_id IS NULL
           OR d.previous_location_id = v.location_id THEN 0
         ELSE coalesce((
           SELECT round(tc.drive_seconds / 60.0)::int FROM travel_cache tc
            WHERE tc.tenant_id = v.tenant_id AND tc.deleted_at IS NULL
              AND ((tc.from_location_id = d.previous_location_id AND tc.to_location_id = v.location_id)
                OR (tc.from_location_id = v.location_id AND tc.to_location_id = d.previous_location_id))
            ORDER BY (tc.from_location_id = d.previous_location_id) DESC,
                     abs(extract(epoch FROM tc.departure_hour - v.start_at))
            LIMIT 1), 0)
       END AS drive_minutes
FROM v
LEFT JOIN driven d ON d.visit_id = v.visit_id;--> statement-breakpoint
CREATE UNIQUE INDEX visit_fact_visit_id_key ON kpi.visit_fact (visit_id);--> statement-breakpoint
CREATE INDEX visit_fact_tenant_day_idx ON kpi.visit_fact (tenant_id, day);--> statement-breakpoint

-- Approved invoice bases: the revenue until Fortnox sends invoices (KPI 1, 2, 3, 5).
-- A fixed-price labour line counts as the visit's planned time.
CREATE MATERIALIZED VIEW kpi.report_fact AS
SELECT r.tenant_id, r.id AS report_id, r.visit_id, vi.job_id, vi.mechanic_id, j.service_type_id,
       (r.approved_at AT TIME ZONE 'Europe/Stockholm')::date AS day,
       (r.invoice ->> 'netOre')::bigint AS net_ore,
       coalesce((
         SELECT sum(CASE WHEN l.hours IS NULL THEN vi.planned_minutes ELSE l.hours * 60 END)
           FROM job_line l
          WHERE l.tenant_id = r.tenant_id AND l.job_id = vi.job_id
            AND l.type = 'labour' AND l.deleted_at IS NULL), 0)::int AS labour_minutes
FROM service_report r
JOIN visit vi ON vi.tenant_id = r.tenant_id AND vi.id = r.visit_id AND vi.deleted_at IS NULL
JOIN job j ON j.tenant_id = vi.tenant_id AND j.id = vi.job_id AND j.deleted_at IS NULL
WHERE r.status = 'approved' AND r.deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX report_fact_report_id_key ON kpi.report_fact (report_id);--> statement-breakpoint
CREATE INDEX report_fact_tenant_day_idx ON kpi.report_fact (tenant_id, day);--> statement-breakpoint

-- From a job's creation to its first visit (KPI 11), dated by that visit's booking.
CREATE MATERIALIZED VIEW kpi.job_fact AS
SELECT j.tenant_id, j.id AS job_id, j.service_type_id, first.mechanic_id,
       (first.created_at AT TIME ZONE 'Europe/Stockholm')::date AS day,
       extract(epoch FROM first.created_at - j.created_at) / 3600.0 AS hours_to_first_visit
FROM job j
JOIN LATERAL (
  SELECT vi.created_at, vi.mechanic_id FROM visit vi
   WHERE vi.tenant_id = j.tenant_id AND vi.job_id = j.id AND vi.deleted_at IS NULL
   ORDER BY vi.created_at LIMIT 1
) first ON true
WHERE j.deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX job_fact_job_id_key ON kpi.job_fact (job_id);--> statement-breakpoint
CREATE INDEX job_fact_tenant_day_idx ON kpi.job_fact (tenant_id, day);--> statement-breakpoint

-- Times freed by a cancellation more than two hours ahead, and whether a visit from the
-- waitlist took the same mechanic's time (KPI 10, flow F4).
CREATE MATERIALIZED VIEW kpi.freed_slot AS
SELECT vi.tenant_id, vi.id AS visit_id, vi.mechanic_id, j.service_type_id,
       (lower(vi.time_window) AT TIME ZONE 'Europe/Stockholm')::date AS day,
       EXISTS (
         SELECT 1 FROM visit v2
         JOIN job j2 ON j2.tenant_id = v2.tenant_id AND j2.id = v2.job_id
         WHERE v2.tenant_id = vi.tenant_id AND v2.mechanic_id = vi.mechanic_id AND v2.id <> vi.id
           AND v2.deleted_at IS NULL AND v2.status <> 'cancelled'
           AND j2.channel = 'waitlist' AND v2.time_window && vi.time_window
       ) AS refilled
FROM visit vi
JOIN job j ON j.tenant_id = vi.tenant_id AND j.id = vi.job_id AND j.deleted_at IS NULL
WHERE vi.status = 'cancelled' AND vi.deleted_at IS NULL AND vi.mechanic_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM domain_event e
     WHERE e.tenant_id = vi.tenant_id AND e.aggregate_type = 'visit' AND e.aggregate_id = vi.id
       AND e.type = 'visit.cancel' AND e.occurred_at < lower(vi.time_window) - interval '2 hours'
  );--> statement-breakpoint
CREATE UNIQUE INDEX freed_slot_visit_id_key ON kpi.freed_slot (visit_id);--> statement-breakpoint

-- Each mechanic's working time per day by the schedule, minus blocked time (spec 9.1
-- "Kapacitet"; KPI 4, 5, 14), from about two years back to a season ahead.
CREATE MATERIALIZED VIEW kpi.capacity_day AS
WITH days AS (
  SELECT d::date AS day
    FROM generate_series(current_date - 800, current_date + 500, interval '1 day') d
), periods AS (
  SELECT ws.tenant_id, ws.user_id, days.day,
         tstzrange((days.day + ws.start_time) AT TIME ZONE 'Europe/Stockholm',
                   (days.day + ws.end_time) AT TIME ZONE 'Europe/Stockholm') AS period
    FROM work_schedule ws
    JOIN days ON extract(isodow FROM days.day) = ws.weekday
     AND (ws.valid_from IS NULL OR days.day >= ws.valid_from)
     AND (ws.valid_to IS NULL OR days.day <= ws.valid_to)
   WHERE ws.deleted_at IS NULL
), free AS (
  SELECT p.tenant_id, p.user_id, p.day,
         tstzmultirange(p.period) - coalesce((
           SELECT range_agg(b.during) FROM schedule_block b
            WHERE b.tenant_id = p.tenant_id AND b.user_id = p.user_id
              AND b.deleted_at IS NULL AND b.during && p.period), '{}'::tstzmultirange) AS free
    FROM periods p
)
SELECT f.tenant_id, f.user_id, f.day,
       coalesce(sum(extract(epoch FROM upper(r) - lower(r)) / 60), 0)::int AS capacity_minutes
FROM free f
LEFT JOIN LATERAL unnest(f.free) r ON true
GROUP BY f.tenant_id, f.user_id, f.day;--> statement-breakpoint
CREATE UNIQUE INDEX capacity_day_key ON kpi.capacity_day (tenant_id, user_id, day);--> statement-breakpoint

REVOKE ALL ON ALL TABLES IN SCHEMA kpi FROM PUBLIC, anon, authenticated;--> statement-breakpoint

-- Refreshes every view without blocking readers.
CREATE FUNCTION kpi.refresh() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY kpi.visit_fact;
  REFRESH MATERIALIZED VIEW CONCURRENTLY kpi.report_fact;
  REFRESH MATERIALIZED VIEW CONCURRENTLY kpi.job_fact;
  REFRESH MATERIALIZED VIEW CONCURRENTLY kpi.freed_slot;
  REFRESH MATERIALIZED VIEW CONCURRENTLY kpi.capacity_day;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION kpi.refresh() FROM PUBLIC, anon, authenticated;
