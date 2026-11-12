CREATE TABLE "schedule_block" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"during" tstzrange NOT NULL,
	"reason" text,
	CONSTRAINT "schedule_block_during_bounded" CHECK (not isempty("schedule_block"."during") and not lower_inf("schedule_block"."during") and not upper_inf("schedule_block"."during"))
);
--> statement-breakpoint
ALTER TABLE "schedule_block" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "work_schedule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"valid_from" date,
	"valid_to" date,
	CONSTRAINT "work_schedule_weekday_range" CHECK ("work_schedule"."weekday" between 1 and 7),
	CONSTRAINT "work_schedule_times_ordered" CHECK ("work_schedule"."start_time" < "work_schedule"."end_time")
);
--> statement-breakpoint
ALTER TABLE "work_schedule" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "schedule_block" ADD CONSTRAINT "schedule_block_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_block" ADD CONSTRAINT "schedule_block_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."app_user"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_schedule" ADD CONSTRAINT "work_schedule_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_schedule" ADD CONSTRAINT "work_schedule_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."app_user"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "schedule_block_during_idx" ON "schedule_block" USING gist ("tenant_id","user_id","during");--> statement-breakpoint
CREATE INDEX "work_schedule_user_id_idx" ON "work_schedule" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "schedule_block" AS PERMISSIVE FOR ALL TO "authenticated" USING ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid) WITH CHECK ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "work_schedule" AS PERMISSIVE FOR ALL TO "authenticated" USING ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid) WITH CHECK ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid);