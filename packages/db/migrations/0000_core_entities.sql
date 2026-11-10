CREATE TYPE "public"."boat_status" AS ENUM('active', 'sold');--> statement-breakpoint
CREATE TYPE "public"."customer_type" AS ENUM('private', 'marina', 'club', 'rental', 'yard');--> statement-breakpoint
CREATE TYPE "public"."engine_fuel" AS ENUM('petrol', 'diesel', 'electric');--> statement-breakpoint
CREATE TYPE "public"."engine_position" AS ENUM('port', 'stbd', 'single');--> statement-breakpoint
CREATE TYPE "public"."engine_type" AS ENUM('inboard', 'outboard', 'sterndrive', 'jet');--> statement-breakpoint
CREATE TYPE "public"."hours_source" AS ENUM('mechanic', 'customer', 'ai');--> statement-breakpoint
CREATE TYPE "public"."ownership_role" AS ENUM('owner', 'co_owner', 'contact');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('owner', 'admin', 'mechanic');--> statement-breakpoint
CREATE TABLE "boat" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"tenant_id" uuid NOT NULL,
	"name" text,
	"make" text,
	"model" text,
	"length_m" numeric(5, 2),
	"year" smallint,
	"hull_type" text,
	"registration_number" text,
	"status" "boat_status" DEFAULT 'active' NOT NULL,
	CONSTRAINT "boat_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "boat" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "boat_ownership" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"tenant_id" uuid NOT NULL,
	"boat_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"role" "ownership_role" DEFAULT 'owner' NOT NULL,
	"valid_from" date,
	"valid_to" date
);
--> statement-breakpoint
ALTER TABLE "boat_ownership" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "customer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"tenant_id" uuid NOT NULL,
	"type" "customer_type" DEFAULT 'private' NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"billing_address" text,
	"acquisition_channel" text,
	"language" text DEFAULT 'sv' NOT NULL,
	CONSTRAINT "customer_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "customer_phone_e164" CHECK ("customer"."phone" ~ '^\+[1-9][0-9]{6,14}$')
);
--> statement-breakpoint
ALTER TABLE "customer" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "drive" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"tenant_id" uuid NOT NULL,
	"engine_id" uuid NOT NULL,
	"type" text,
	"serial_number" text
);
--> statement-breakpoint
ALTER TABLE "drive" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "engine" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"tenant_id" uuid NOT NULL,
	"boat_id" uuid NOT NULL,
	"position" "engine_position" DEFAULT 'single' NOT NULL,
	"make" text,
	"model" text,
	"model_year" smallint,
	"type" "engine_type",
	"fuel" "engine_fuel",
	"serial_number" text,
	CONSTRAINT "engine_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "engine" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "engine_hours_reading" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"tenant_id" uuid NOT NULL,
	"engine_id" uuid NOT NULL,
	"hours" numeric(8, 1) NOT NULL,
	"read_at" timestamp with time zone NOT NULL,
	"source" "hours_source" NOT NULL
);
--> statement-breakpoint
ALTER TABLE "engine_hours_reading" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"name" text NOT NULL,
	"org_number" text,
	"vat_number" text,
	"phone" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "tenant_phone_e164" CHECK ("tenant"."phone" ~ '^\+[1-9][0-9]{6,14}$')
);
--> statement-breakpoint
ALTER TABLE "tenant" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app_user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"tenant_id" uuid NOT NULL,
	"auth_user_id" uuid,
	"name" text NOT NULL,
	"mobile" text,
	"email" text,
	"role" "user_role" NOT NULL,
	"home_address" text,
	CONSTRAINT "app_user_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "app_user_mobile_e164" CHECK ("app_user"."mobile" ~ '^\+[1-9][0-9]{6,14}$')
);
--> statement-breakpoint
ALTER TABLE "app_user" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "boat" ADD CONSTRAINT "boat_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boat_ownership" ADD CONSTRAINT "boat_ownership_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boat_ownership" ADD CONSTRAINT "boat_ownership_boat_fk" FOREIGN KEY ("tenant_id","boat_id") REFERENCES "public"."boat"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boat_ownership" ADD CONSTRAINT "boat_ownership_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customer"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer" ADD CONSTRAINT "customer_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive" ADD CONSTRAINT "drive_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive" ADD CONSTRAINT "drive_engine_fk" FOREIGN KEY ("tenant_id","engine_id") REFERENCES "public"."engine"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engine" ADD CONSTRAINT "engine_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engine" ADD CONSTRAINT "engine_boat_fk" FOREIGN KEY ("tenant_id","boat_id") REFERENCES "public"."boat"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engine_hours_reading" ADD CONSTRAINT "engine_hours_reading_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engine_hours_reading" ADD CONSTRAINT "engine_hours_reading_engine_fk" FOREIGN KEY ("tenant_id","engine_id") REFERENCES "public"."engine"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "boat_ownership_boat_id_idx" ON "boat_ownership" USING btree ("tenant_id","boat_id");--> statement-breakpoint
CREATE INDEX "boat_ownership_customer_id_idx" ON "boat_ownership" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_tenant_id_phone_key" ON "customer" USING btree ("tenant_id","phone") WHERE "customer"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "drive_engine_id_key" ON "drive" USING btree ("engine_id") WHERE "drive"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "engine_boat_id_idx" ON "engine" USING btree ("tenant_id","boat_id");--> statement-breakpoint
CREATE INDEX "engine_hours_reading_engine_id_idx" ON "engine_hours_reading" USING btree ("tenant_id","engine_id","read_at");--> statement-breakpoint
CREATE UNIQUE INDEX "app_user_auth_user_id_key" ON "app_user" USING btree ("auth_user_id");--> statement-breakpoint
CREATE INDEX "app_user_tenant_id_idx" ON "app_user" USING btree ("tenant_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "boat" AS PERMISSIVE FOR ALL TO "authenticated" USING ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid) WITH CHECK ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "boat_ownership" AS PERMISSIVE FOR ALL TO "authenticated" USING ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid) WITH CHECK ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "customer" AS PERMISSIVE FOR ALL TO "authenticated" USING ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid) WITH CHECK ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "drive" AS PERMISSIVE FOR ALL TO "authenticated" USING ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid) WITH CHECK ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "engine" AS PERMISSIVE FOR ALL TO "authenticated" USING ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid) WITH CHECK ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "engine_hours_reading" AS PERMISSIVE FOR ALL TO "authenticated" USING ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid) WITH CHECK ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenant" AS PERMISSIVE FOR ALL TO "authenticated" USING ("id" = ((select auth.jwt()) ->> 'tenant_id')::uuid) WITH CHECK ("id" = ((select auth.jwt()) ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "app_user" AS PERMISSIVE FOR ALL TO "authenticated" USING ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid) WITH CHECK ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid);