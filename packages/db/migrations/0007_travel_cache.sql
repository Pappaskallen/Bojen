CREATE TABLE "travel_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"tenant_id" uuid NOT NULL,
	"from_location_id" uuid NOT NULL,
	"to_location_id" uuid NOT NULL,
	"departure_hour" timestamp with time zone NOT NULL,
	"drive_seconds" integer NOT NULL,
	"distance_meters" integer NOT NULL,
	"provider" text NOT NULL,
	CONSTRAINT "travel_cache_pair_hour_key" UNIQUE("tenant_id","from_location_id","to_location_id","departure_hour"),
	CONSTRAINT "travel_cache_values_non_negative" CHECK ("travel_cache"."drive_seconds" >= 0 and "travel_cache"."distance_meters" >= 0),
	CONSTRAINT "travel_cache_two_places" CHECK ("travel_cache"."from_location_id" <> "travel_cache"."to_location_id"),
	CONSTRAINT "travel_cache_whole_hour" CHECK (date_trunc('hour', "travel_cache"."departure_hour") = "travel_cache"."departure_hour")
);
--> statement-breakpoint
ALTER TABLE "travel_cache" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "travel_cache" ADD CONSTRAINT "travel_cache_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_cache" ADD CONSTRAINT "travel_cache_from_location_fk" FOREIGN KEY ("tenant_id","from_location_id") REFERENCES "public"."location"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_cache" ADD CONSTRAINT "travel_cache_to_location_fk" FOREIGN KEY ("tenant_id","to_location_id") REFERENCES "public"."location"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "travel_cache" AS PERMISSIVE FOR ALL TO "authenticated" USING ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid) WITH CHECK ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid);