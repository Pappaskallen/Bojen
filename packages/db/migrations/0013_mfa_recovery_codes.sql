CREATE TABLE "mfa_recovery_code" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"tenant_id" uuid NOT NULL,
	"app_user_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "mfa_recovery_code" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mfa_recovery_code" ADD CONSTRAINT "mfa_recovery_code_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mfa_recovery_code" ADD CONSTRAINT "mfa_recovery_code_user_fk" FOREIGN KEY ("tenant_id","app_user_id") REFERENCES "public"."app_user"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mfa_recovery_code_user_idx" ON "mfa_recovery_code" USING btree ("tenant_id","app_user_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "mfa_recovery_code" AS PERMISSIVE FOR ALL TO "authenticated" USING ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid) WITH CHECK ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid);