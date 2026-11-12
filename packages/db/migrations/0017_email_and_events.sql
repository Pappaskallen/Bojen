ALTER TABLE "message" ADD COLUMN "subject" text;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "body_html" text;--> statement-breakpoint
-- Every domain event becomes a job for the worker (byggplan step 3.3), in the same
-- transaction as the change itself: the flows F1, F5, F7 and F9 start from these jobs.
-- The function body is resolved when it runs, after Graphile Worker's own migrations.
CREATE OR REPLACE FUNCTION public.enqueue_domain_event() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $$
BEGIN
  PERFORM graphile_worker.add_job(
    'domain_event',
    json_build_object('eventId', NEW.id),
    max_attempts => 10
  );
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.enqueue_domain_event() FROM PUBLIC, anon, authenticated;--> statement-breakpoint
CREATE TRIGGER domain_event_enqueue AFTER INSERT ON public.domain_event
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_domain_event();
