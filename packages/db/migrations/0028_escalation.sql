CREATE TABLE "push_subscription" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "push_subscription" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "push_subscription" ADD CONSTRAINT "push_subscription_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscription" ADD CONSTRAINT "push_subscription_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."app_user"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscription_endpoint_key" ON "push_subscription" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "push_subscription_user_idx" ON "push_subscription" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "push_subscription" AS PERMISSIVE FOR ALL TO "authenticated" USING ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid) WITH CHECK ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid);