CREATE TYPE "public"."access_method" AS ENUM('car', 'boat', 'ferry');--> statement-breakpoint
CREATE TYPE "public"."location_type" AS ENUM('marina', 'club', 'yard', 'private_dock', 'home');--> statement-breakpoint
CREATE TYPE "public"."placement_mode" AS ENUM('water', 'land', 'indoor');--> statement-breakpoint
CREATE TYPE "public"."placement_season" AS ENUM('summer', 'winter');--> statement-breakpoint
CREATE TABLE "access_info" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"tenant_id" uuid NOT NULL,
	"boat_id" uuid NOT NULL,
	"key_location_encrypted" bytea,
	"code_encrypted" bytea,
	"contact_name" text,
	"contact_phone" text,
	"valid_until" date,
	CONSTRAINT "access_info_contact_phone_e164" CHECK ("access_info"."contact_phone" ~ '^\+[1-9][0-9]{6,14}$')
);
--> statement-breakpoint
ALTER TABLE "access_info" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "area" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"boundary" geography(Polygon,4326) NOT NULL,
	CONSTRAINT "area_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "area" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "boat_placement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"tenant_id" uuid NOT NULL,
	"boat_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"season" "placement_season" NOT NULL,
	"mode" "placement_mode" NOT NULL,
	"spot_id" text,
	"launch_date" date,
	"haul_out_date" date,
	"valid_during" daterange GENERATED ALWAYS AS (case when season = 'summer' then daterange(launch_date, haul_out_date) else daterange(haul_out_date, launch_date) end) STORED
);
--> statement-breakpoint
ALTER TABLE "boat_placement" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "location" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"tenant_id" uuid NOT NULL,
	"type" "location_type" NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"position" geography(Point,4326),
	"access_method" "access_method" DEFAULT 'car' NOT NULL,
	"crossing_minutes" smallint,
	"owner_customer_id" uuid,
	"area_id" uuid,
	CONSTRAINT "location_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "location" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "location_access_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"opening_hours" jsonb,
	"gate_code_encrypted" bytea,
	"key_box_encrypted" bytea,
	"check_in_instructions" text,
	"parking" text
);
--> statement-breakpoint
ALTER TABLE "location_access_rule" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "access_info" ADD CONSTRAINT "access_info_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_info" ADD CONSTRAINT "access_info_boat_fk" FOREIGN KEY ("tenant_id","boat_id") REFERENCES "public"."boat"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "area" ADD CONSTRAINT "area_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boat_placement" ADD CONSTRAINT "boat_placement_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boat_placement" ADD CONSTRAINT "boat_placement_boat_fk" FOREIGN KEY ("tenant_id","boat_id") REFERENCES "public"."boat"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boat_placement" ADD CONSTRAINT "boat_placement_location_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."location"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location" ADD CONSTRAINT "location_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location" ADD CONSTRAINT "location_owner_customer_fk" FOREIGN KEY ("tenant_id","owner_customer_id") REFERENCES "public"."customer"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location" ADD CONSTRAINT "location_area_fk" FOREIGN KEY ("tenant_id","area_id") REFERENCES "public"."area"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_access_rule" ADD CONSTRAINT "location_access_rule_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_access_rule" ADD CONSTRAINT "location_access_rule_location_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."location"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "access_info_boat_id_key" ON "access_info" USING btree ("boat_id") WHERE "access_info"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "area_boundary_idx" ON "area" USING gist ("boundary");--> statement-breakpoint
CREATE INDEX "boat_placement_location_id_idx" ON "boat_placement" USING btree ("tenant_id","location_id");--> statement-breakpoint
CREATE INDEX "location_position_idx" ON "location" USING gist ("position");--> statement-breakpoint
CREATE INDEX "location_access_rule_location_id_idx" ON "location_access_rule" USING btree ("tenant_id","location_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "access_info" AS PERMISSIVE FOR ALL TO "authenticated" USING ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid) WITH CHECK ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "area" AS PERMISSIVE FOR ALL TO "authenticated" USING ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid) WITH CHECK ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "boat_placement" AS PERMISSIVE FOR ALL TO "authenticated" USING ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid) WITH CHECK ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "location" AS PERMISSIVE FOR ALL TO "authenticated" USING ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid) WITH CHECK ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "location_access_rule" AS PERMISSIVE FOR ALL TO "authenticated" USING ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid) WITH CHECK ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid);--> statement-breakpoint
-- Hand-written: one boat cannot be in two places on the same day. Drizzle has no
-- schema syntax for exclusion constraints. Needs btree_gist (migration 0001).
ALTER TABLE "boat_placement" ADD CONSTRAINT "boat_placement_no_overlap" EXCLUDE USING gist ("tenant_id" WITH =, "boat_id" WITH =, "valid_during" WITH &&) WHERE ("deleted_at" IS NULL);
