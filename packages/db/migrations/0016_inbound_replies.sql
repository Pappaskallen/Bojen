ALTER TYPE "public"."message_intent" ADD VALUE 'stop';--> statement-breakpoint
ALTER TYPE "public"."message_intent" ADD VALUE 'another_time';--> statement-breakpoint
ALTER TYPE "public"."message_intent" ADD VALUE 'rating';--> statement-breakpoint
ALTER TYPE "public"."message_intent" ADD VALUE 'sold';--> statement-breakpoint
ALTER TYPE "public"."message_intent" ADD VALUE 'call_me';--> statement-breakpoint
ALTER TYPE "public"."message_intent" ADD VALUE 'info';--> statement-breakpoint
ALTER TYPE "public"."message_intent" ADD VALUE 'unclear';--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "intent_confidence" real;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "rating" smallint;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "reply_to_id" uuid;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_reply_to_fk" FOREIGN KEY ("tenant_id","reply_to_id") REFERENCES "public"."message"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_tenant_id_to_address_created_at_idx" ON "message" USING btree ("tenant_id","to_address","created_at");--> statement-breakpoint
CREATE INDEX "message_reply_to_id_idx" ON "message" USING btree ("tenant_id","reply_to_id");--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_rating_range" CHECK ("message"."rating" between 1 and 5);--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_intent_confidence_range" CHECK ("message"."intent_confidence" >= 0 and "message"."intent_confidence" <= 1);