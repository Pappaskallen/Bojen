-- What the caller wanted (byggplan step 7.3, KPI 22): set by the agent's avsluta_samtal, else by the summary.
CREATE TYPE "public"."call_intent" AS ENUM('book', 'emergency', 'question', 'other');--> statement-breakpoint
ALTER TABLE "call" ADD COLUMN "intent" "call_intent";