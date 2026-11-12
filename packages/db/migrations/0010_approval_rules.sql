CREATE TYPE "public"."approval_mode" AS ENUM('auto', 'manual');--> statement-breakpoint
CREATE TYPE "public"."customer_kind" AS ENUM('new', 'existing');--> statement-breakpoint
CREATE TABLE "approval_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"tenant_id" uuid NOT NULL,
	"service_type_id" uuid,
	"customer_kind" "customer_kind",
	"mode" "approval_mode" NOT NULL,
	CONSTRAINT "approval_rule_scope_key" UNIQUE NULLS NOT DISTINCT("tenant_id","service_type_id","customer_kind")
);
--> statement-breakpoint
ALTER TABLE "approval_rule" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "approval_rule" ADD CONSTRAINT "approval_rule_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_rule" ADD CONSTRAINT "approval_rule_service_type_fk" FOREIGN KEY ("tenant_id","service_type_id") REFERENCES "public"."service_type"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "approval_rule" AS PERMISSIVE FOR ALL TO "authenticated" USING ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid) WITH CHECK ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid);