ALTER TABLE "call" ADD COLUMN "claimed_customer_id" uuid;--> statement-breakpoint
ALTER TABLE "call" ADD COLUMN "verified_customer_id" uuid;--> statement-breakpoint
ALTER TABLE "call" ADD COLUMN "control_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "call" ADD CONSTRAINT "call_claimed_customer_fk" FOREIGN KEY ("tenant_id","claimed_customer_id") REFERENCES "public"."customer"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call" ADD CONSTRAINT "call_verified_customer_fk" FOREIGN KEY ("tenant_id","verified_customer_id") REFERENCES "public"."customer"("tenant_id","id") ON DELETE no action ON UPDATE no action;