CREATE TYPE "public"."availability_status" AS ENUM('not_sent', 'skipped', 'pending', 'confirmed', 'declined', 'change_requested', 'no_reply');--> statement-breakpoint
CREATE TYPE "public"."job_channel" AS ENUM('phone', 'web', 'campaign', 'marina');--> statement-breakpoint
CREATE TYPE "public"."job_line_type" AS ENUM('labour', 'callout', 'emergency', 'discount');--> statement-breakpoint
CREATE TYPE "public"."job_part_source" AS ENUM('van', 'order');--> statement-breakpoint
CREATE TYPE "public"."job_part_status" AS ENUM('needed', 'ordered', 'delivered', 'installed');--> statement-breakpoint
CREATE TYPE "public"."job_pipeline_status" AS ENUM('inquiry', 'quote', 'parts_ordered', 'booked', 'done', 'invoiced', 'paid', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."job_urgency" AS ENUM('planned', 'soon', 'emergency');--> statement-breakpoint
CREATE TYPE "public"."visit_status" AS ENUM('tentative', 'pending_approval', 'booked', 'confirmed', 'unconfirmed', 'in_progress', 'done', 'cancelled', 'no_access');--> statement-breakpoint
CREATE TABLE "service_type" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"default_duration_minutes" integer NOT NULL,
	"required_mode" "placement_mode",
	"engine_type" "engine_type",
	"default_parts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"price_ore" integer,
	"preparation_text" text,
	CONSTRAINT "service_type_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "service_type" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "supplier" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"contact_name" text,
	"email" text,
	"phone" text,
	"default_lead_time_days" smallint,
	"ordering_method" text,
	CONSTRAINT "supplier_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "supplier_phone_e164" CHECK ("supplier"."phone" ~ '^\+[1-9][0-9]{6,14}$')
);
--> statement-breakpoint
ALTER TABLE "supplier" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "part" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"tenant_id" uuid NOT NULL,
	"article_number" text NOT NULL,
	"manufacturer" text,
	"description" text NOT NULL,
	"purchase_price_ore" integer,
	"sale_price_ore" integer,
	"fits_engine_models" text[] DEFAULT '{}'::text[] NOT NULL,
	CONSTRAINT "part_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "part" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"boat_id" uuid,
	"service_type_id" uuid,
	"pipeline_status" "job_pipeline_status" DEFAULT 'inquiry' NOT NULL,
	"urgency" "job_urgency" DEFAULT 'planned' NOT NULL,
	"description" text,
	"channel" "job_channel",
	"quote_amount_ore" integer,
	CONSTRAINT "job_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "job" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "visit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"mechanic_id" uuid,
	"time_window" tstzrange NOT NULL,
	"planned_minutes" integer NOT NULL,
	"status" "visit_status" DEFAULT 'tentative' NOT NULL,
	"availability_status" "availability_status" DEFAULT 'not_sent' NOT NULL,
	CONSTRAINT "visit_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "visit_time_window_bounded" CHECK (not isempty("visit"."time_window") and not lower_inf("visit"."time_window") and not upper_inf("visit"."time_window")),
	CONSTRAINT "visit_planned_minutes_positive" CHECK ("visit"."planned_minutes" > 0)
);
--> statement-breakpoint
ALTER TABLE "visit" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "job_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"type" "job_line_type" NOT NULL,
	"description" text NOT NULL,
	"hours" numeric(6, 2),
	"unit_price_ore" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_line" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "job_part" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"part_id" uuid NOT NULL,
	"quantity" numeric(8, 2) DEFAULT '1' NOT NULL,
	"status" "job_part_status" DEFAULT 'needed' NOT NULL,
	"supplier_id" uuid,
	"lead_time_days" smallint,
	"source" "job_part_source" DEFAULT 'order' NOT NULL,
	CONSTRAINT "job_part_quantity_positive" CHECK ("job_part"."quantity" > 0)
);
--> statement-breakpoint
ALTER TABLE "job_part" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "service_type" ADD CONSTRAINT "service_type_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier" ADD CONSTRAINT "supplier_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part" ADD CONSTRAINT "part_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job" ADD CONSTRAINT "job_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job" ADD CONSTRAINT "job_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customer"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job" ADD CONSTRAINT "job_boat_fk" FOREIGN KEY ("tenant_id","boat_id") REFERENCES "public"."boat"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job" ADD CONSTRAINT "job_service_type_fk" FOREIGN KEY ("tenant_id","service_type_id") REFERENCES "public"."service_type"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit" ADD CONSTRAINT "visit_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit" ADD CONSTRAINT "visit_job_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."job"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit" ADD CONSTRAINT "visit_mechanic_fk" FOREIGN KEY ("tenant_id","mechanic_id") REFERENCES "public"."app_user"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_line" ADD CONSTRAINT "job_line_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_line" ADD CONSTRAINT "job_line_job_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."job"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_part" ADD CONSTRAINT "job_part_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_part" ADD CONSTRAINT "job_part_job_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."job"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_part" ADD CONSTRAINT "job_part_part_fk" FOREIGN KEY ("tenant_id","part_id") REFERENCES "public"."part"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_part" ADD CONSTRAINT "job_part_supplier_fk" FOREIGN KEY ("tenant_id","supplier_id") REFERENCES "public"."supplier"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "part_tenant_id_article_number_key" ON "part" USING btree ("tenant_id","manufacturer","article_number") WHERE "part"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "job_pipeline_status_idx" ON "job" USING btree ("tenant_id","pipeline_status");--> statement-breakpoint
CREATE INDEX "job_customer_id_idx" ON "job" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "job_boat_id_idx" ON "job" USING btree ("tenant_id","boat_id");--> statement-breakpoint
CREATE INDEX "visit_job_id_idx" ON "visit" USING btree ("tenant_id","job_id");--> statement-breakpoint
CREATE INDEX "job_line_job_id_idx" ON "job_line" USING btree ("tenant_id","job_id");--> statement-breakpoint
CREATE INDEX "job_part_job_id_idx" ON "job_part" USING btree ("tenant_id","job_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "service_type" AS PERMISSIVE FOR ALL TO "authenticated" USING ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid) WITH CHECK ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "supplier" AS PERMISSIVE FOR ALL TO "authenticated" USING ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid) WITH CHECK ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "part" AS PERMISSIVE FOR ALL TO "authenticated" USING ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid) WITH CHECK ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "job" AS PERMISSIVE FOR ALL TO "authenticated" USING ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid) WITH CHECK ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "visit" AS PERMISSIVE FOR ALL TO "authenticated" USING ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid) WITH CHECK ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "job_line" AS PERMISSIVE FOR ALL TO "authenticated" USING ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid) WITH CHECK ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "job_part" AS PERMISSIVE FOR ALL TO "authenticated" USING ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid) WITH CHECK ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid);--> statement-breakpoint
-- Hand-written: one mechanic cannot be in two places at once. Cancelled visits free the
-- time. Unassigned visits (mechanic_id is null) never conflict. Needs btree_gist (0001).
ALTER TABLE "visit" ADD CONSTRAINT "visit_no_overlap_per_mechanic" EXCLUDE USING gist ("tenant_id" WITH =, "mechanic_id" WITH =, "time_window" WITH &&) WHERE ("deleted_at" IS NULL AND "status" <> 'cancelled');
