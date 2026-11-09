-- PostGIS for positions, distances and areas; btree_gist for exclusion constraints
-- that mix ordinary columns (tenant_id, boat_id) with ranges.
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;
