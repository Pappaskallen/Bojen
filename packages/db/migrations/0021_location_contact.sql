CREATE TABLE "location_contact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"name" text NOT NULL,
	"role" text,
	"phone" text,
	"email" text,
	"note" text,
	CONSTRAINT "location_contact_phone_e164" CHECK ("location_contact"."phone" ~ '^\+[1-9][0-9]{6,14}$')
);
--> statement-breakpoint
ALTER TABLE "location_contact" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "location_contact" ADD CONSTRAINT "location_contact_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_contact" ADD CONSTRAINT "location_contact_location_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."location"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "location_contact_location_id_idx" ON "location_contact" USING btree ("tenant_id","location_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "location_contact" AS PERMISSIVE FOR ALL TO "authenticated" USING ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid) WITH CHECK ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid);