ALTER TYPE "public"."message_status" ADD VALUE 'blocked';--> statement-breakpoint
CREATE TABLE "sms_opt_out" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"tenant_id" uuid NOT NULL,
	"phone_hash" text NOT NULL,
	"source" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sms_opt_out" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "send_after" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sms_opt_out" ADD CONSTRAINT "sms_opt_out_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sms_opt_out_tenant_id_phone_hash_key" ON "sms_opt_out" USING btree ("tenant_id","phone_hash");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sms_opt_out" AS PERMISSIVE FOR ALL TO "authenticated" USING ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid) WITH CHECK ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid);