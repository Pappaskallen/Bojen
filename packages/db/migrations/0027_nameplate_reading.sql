ALTER TABLE "attachment" ADD CONSTRAINT "attachment_tenant_id_id_key" UNIQUE("tenant_id","id");--> statement-breakpoint
CREATE TABLE "nameplate_reading" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"tenant_id" uuid NOT NULL,
	"attachment_id" uuid NOT NULL,
	"boat_id" uuid NOT NULL,
	"make" text,
	"model" text,
	"serial_number" text,
	"confidence" numeric(3, 2) NOT NULL,
	"read_by" text NOT NULL,
	"status" text DEFAULT 'suggested' NOT NULL,
	"engine_id" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	CONSTRAINT "nameplate_reading_status" CHECK ("nameplate_reading"."status" in ('suggested', 'confirmed', 'dismissed'))
);
--> statement-breakpoint
ALTER TABLE "nameplate_reading" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "nameplate_reading" ADD CONSTRAINT "nameplate_reading_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nameplate_reading" ADD CONSTRAINT "nameplate_reading_attachment_fk" FOREIGN KEY ("tenant_id","attachment_id") REFERENCES "public"."attachment"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nameplate_reading" ADD CONSTRAINT "nameplate_reading_boat_fk" FOREIGN KEY ("tenant_id","boat_id") REFERENCES "public"."boat"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nameplate_reading" ADD CONSTRAINT "nameplate_reading_engine_fk" FOREIGN KEY ("tenant_id","engine_id") REFERENCES "public"."engine"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nameplate_reading" ADD CONSTRAINT "nameplate_reading_decided_by_fk" FOREIGN KEY ("tenant_id","decided_by") REFERENCES "public"."app_user"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "nameplate_reading_attachment_key" ON "nameplate_reading" USING btree ("tenant_id","attachment_id");--> statement-breakpoint
CREATE INDEX "nameplate_reading_boat_idx" ON "nameplate_reading" USING btree ("tenant_id","boat_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "nameplate_reading" AS PERMISSIVE FOR ALL TO "authenticated" USING ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid) WITH CHECK ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid);