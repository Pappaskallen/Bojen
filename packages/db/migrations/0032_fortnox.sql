CREATE TABLE "fortnox_connection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"tenant_id" uuid NOT NULL,
	"access_token_encrypted" "bytea" NOT NULL,
	"refresh_token_encrypted" "bytea" NOT NULL,
	"access_expires_at" timestamp with time zone NOT NULL,
	"refresh_expires_at" timestamp with time zone NOT NULL,
	"scope" text NOT NULL,
	"company_name" text,
	"connected_by" uuid,
	"connected_at" timestamp with time zone NOT NULL,
	"needs_reconnect_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "fortnox_connection" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN "fortnox_customer_number" text;--> statement-breakpoint
ALTER TABLE "service_report" ADD COLUMN "fortnox_document_number" text;--> statement-breakpoint
ALTER TABLE "service_report" ADD COLUMN "fortnox_invoiced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "service_report" ADD COLUMN "fortnox_paid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fortnox_connection" ADD CONSTRAINT "fortnox_connection_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fortnox_connection" ADD CONSTRAINT "fortnox_connection_connected_by_fk" FOREIGN KEY ("tenant_id","connected_by") REFERENCES "public"."app_user"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fortnox_connection_tenant_key" ON "fortnox_connection" USING btree ("tenant_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "fortnox_connection" AS PERMISSIVE FOR ALL TO "authenticated" USING ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid) WITH CHECK ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid);