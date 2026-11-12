CREATE TABLE "attachment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"tenant_id" uuid NOT NULL,
	"owner_type" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	CONSTRAINT "attachment_storage_key_key" UNIQUE("storage_key"),
	CONSTRAINT "attachment_owner_type" CHECK ("attachment"."owner_type" in ('boat', 'job', 'visit', 'call')),
	CONSTRAINT "attachment_size_positive" CHECK ("attachment"."size_bytes" > 0),
	CONSTRAINT "attachment_key_in_tenant" CHECK (starts_with("attachment"."storage_key", "attachment"."tenant_id"::text || '/'))
);
--> statement-breakpoint
ALTER TABLE "attachment" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "verification_code" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"tenant_id" uuid NOT NULL,
	"phone" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "verification_code_phone_e164" CHECK ("verification_code"."phone" ~ '^\+[1-9][0-9]{6,14}$'),
	CONSTRAINT "verification_code_attempts_range" CHECK ("verification_code"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "verification_code" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "location" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_code" ADD CONSTRAINT "verification_code_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachment_owner_idx" ON "attachment" USING btree ("tenant_id","owner_type","owner_id");--> statement-breakpoint
CREATE INDEX "verification_code_phone_idx" ON "verification_code" USING btree ("tenant_id","phone","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_slug_key" ON "tenant" USING btree ("slug");--> statement-breakpoint
ALTER TABLE "location" ADD CONSTRAINT "location_tenant_id_slug_key" UNIQUE("tenant_id","slug");--> statement-breakpoint
ALTER TABLE "tenant" ADD CONSTRAINT "tenant_slug_format" CHECK ("tenant"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');--> statement-breakpoint
ALTER TABLE "location" ADD CONSTRAINT "location_slug_format" CHECK ("location"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "attachment" AS PERMISSIVE FOR ALL TO "authenticated" USING ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid) WITH CHECK ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "verification_code" AS PERMISSIVE FOR ALL TO "authenticated" USING ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid) WITH CHECK ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid);