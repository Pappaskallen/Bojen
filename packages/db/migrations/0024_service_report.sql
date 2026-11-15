CREATE TABLE "service_report" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"tenant_id" uuid NOT NULL,
	"visit_id" uuid NOT NULL,
	"status" text DEFAULT 'drafting' NOT NULL,
	"work_done" text,
	"recommendations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"next_service" text,
	"drafted_by" text,
	"drafted_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"invoice" jsonb,
	CONSTRAINT "service_report_status" CHECK ("service_report"."status" in ('drafting', 'draft', 'approved')),
	CONSTRAINT "service_report_approved" CHECK (("service_report"."status" = 'approved') = ("service_report"."approved_at" is not null and "service_report"."invoice" is not null))
);
--> statement-breakpoint
ALTER TABLE "service_report" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attachment" ADD COLUMN "transcript" text;--> statement-breakpoint
ALTER TABLE "service_report" ADD CONSTRAINT "service_report_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_report" ADD CONSTRAINT "service_report_visit_fk" FOREIGN KEY ("tenant_id","visit_id") REFERENCES "public"."visit"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_report" ADD CONSTRAINT "service_report_approved_by_fk" FOREIGN KEY ("tenant_id","approved_by") REFERENCES "public"."app_user"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "service_report_visit_key" ON "service_report" USING btree ("tenant_id","visit_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "service_report" AS PERMISSIVE FOR ALL TO "authenticated" USING ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid) WITH CHECK ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid);