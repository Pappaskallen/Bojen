CREATE TABLE "staff_passkey" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"tenant_id" uuid NOT NULL,
	"app_user_id" uuid NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" "bytea" NOT NULL,
	"counter" bigint DEFAULT 0 NOT NULL,
	"transports" text[],
	"prf" boolean DEFAULT false NOT NULL,
	"name" text,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "staff_passkey" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "staff_passkey" ADD CONSTRAINT "staff_passkey_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_passkey" ADD CONSTRAINT "staff_passkey_app_user_fk" FOREIGN KEY ("tenant_id","app_user_id") REFERENCES "public"."app_user"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_passkey_credential_id_key" ON "staff_passkey" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "staff_passkey_app_user_idx" ON "staff_passkey" USING btree ("tenant_id","app_user_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "staff_passkey" AS PERMISSIVE FOR ALL TO "authenticated" USING ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid) WITH CHECK ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid);