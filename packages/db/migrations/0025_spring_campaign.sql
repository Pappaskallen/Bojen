ALTER TYPE "public"."visit_status" ADD VALUE 'reserved' BEFORE 'pending_approval';--> statement-breakpoint
ALTER TABLE "campaign_recipient" ADD COLUMN "segment" text;--> statement-breakpoint
ALTER TABLE "campaign_recipient" ADD COLUMN "answer" text;--> statement-breakpoint
ALTER TABLE "campaign_recipient" ADD COLUMN "problem" text;