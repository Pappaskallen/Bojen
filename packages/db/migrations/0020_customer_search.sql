-- The search of step 5.1 (spec C8): one text per customer with everything staff search for,
-- kept up to date by the triggers below, and a trigram index (pg_trgm) so that `ILIKE '%text%'`
-- answers in milliseconds also with many thousands of customers.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;--> statement-breakpoint
CREATE TABLE "customer_search" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"document" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_search" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customer_search" ADD CONSTRAINT "customer_search_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_search" ADD CONSTRAINT "customer_search_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customer"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_search_customer_id_key" ON "customer_search" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "customer_search_document_trgm_idx" ON "customer_search" USING gin ("document" gin_trgm_ops);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "customer_search" AS PERMISSIVE FOR ALL TO "authenticated" USING ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid) WITH CHECK ("tenant_id" = ((select auth.jwt()) ->> 'tenant_id')::uuid);
--> statement-breakpoint
-- Rebuilds one customer's text: the customer, and for each boat they own the boat, its
-- engines, their drives and the marinas where it is placed. Deleted rows are left out.
CREATE FUNCTION public.refresh_customer_search(p_tenant uuid, p_customer uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  doc text;
BEGIN
  SELECT concat_ws(' ', c.name, c.phone, c.email, (
    SELECT string_agg(concat_ws(' ', b.name, b.make, b.model, b.registration_number,
      (SELECT string_agg(concat_ws(' ', e.make, e.model, e.serial_number, (
          SELECT concat_ws(' ', d.type, d.serial_number) FROM drive d
          WHERE d.tenant_id = e.tenant_id AND d.engine_id = e.id AND d.deleted_at IS NULL
        )), ' ')
       FROM engine e
       WHERE e.tenant_id = b.tenant_id AND e.boat_id = b.id AND e.deleted_at IS NULL),
      (SELECT string_agg(l.name, ' ')
       FROM boat_placement bp
       JOIN location l ON l.tenant_id = bp.tenant_id AND l.id = bp.location_id AND l.deleted_at IS NULL
       WHERE bp.tenant_id = b.tenant_id AND bp.boat_id = b.id AND bp.deleted_at IS NULL)
    ), ' ')
    FROM boat_ownership o
    JOIN boat b ON b.tenant_id = o.tenant_id AND b.id = o.boat_id AND b.deleted_at IS NULL
    WHERE o.tenant_id = c.tenant_id AND o.customer_id = c.id AND o.deleted_at IS NULL
  ))
  INTO doc
  FROM customer c
  WHERE c.tenant_id = p_tenant AND c.id = p_customer;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  INSERT INTO customer_search (tenant_id, customer_id, document)
  VALUES (p_tenant, p_customer, coalesce(doc, ''))
  ON CONFLICT (tenant_id, customer_id)
  DO UPDATE SET document = EXCLUDED.document, updated_at = now();
END $$;--> statement-breakpoint
CREATE FUNCTION public.refresh_boat_owners(p_tenant uuid, p_boat uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  PERFORM public.refresh_customer_search(p_tenant, o.customer_id)
  FROM boat_ownership o
  WHERE o.tenant_id = p_tenant AND o.boat_id = p_boat AND o.deleted_at IS NULL;
END $$;--> statement-breakpoint
-- Every trigger function below is for the triggers only: no one calls them from outside.
REVOKE ALL ON FUNCTION public.refresh_customer_search(uuid, uuid) FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.refresh_boat_owners(uuid, uuid) FROM PUBLIC, anon, authenticated;--> statement-breakpoint

CREATE FUNCTION public.customer_search_on_customer() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  PERFORM public.refresh_customer_search(NEW.tenant_id, NEW.id);
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER customer_search_customer AFTER INSERT OR UPDATE OF name, phone, email ON customer
  FOR EACH ROW EXECUTE FUNCTION public.customer_search_on_customer();--> statement-breakpoint

CREATE FUNCTION public.customer_search_on_ownership() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  IF TG_OP <> 'DELETE' THEN
    PERFORM public.refresh_customer_search(NEW.tenant_id, NEW.customer_id);
  END IF;
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.customer_id <> NEW.customer_id) THEN
    PERFORM public.refresh_customer_search(OLD.tenant_id, OLD.customer_id);
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER customer_search_ownership
  AFTER INSERT OR UPDATE OF boat_id, customer_id, deleted_at OR DELETE ON boat_ownership
  FOR EACH ROW EXECUTE FUNCTION public.customer_search_on_ownership();--> statement-breakpoint

CREATE FUNCTION public.customer_search_on_boat() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.refresh_boat_owners(OLD.tenant_id, OLD.id);
  ELSE
    PERFORM public.refresh_boat_owners(NEW.tenant_id, NEW.id);
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER customer_search_boat
  AFTER INSERT OR UPDATE OF name, make, model, registration_number, deleted_at OR DELETE ON boat
  FOR EACH ROW EXECUTE FUNCTION public.customer_search_on_boat();--> statement-breakpoint

CREATE FUNCTION public.customer_search_on_engine() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  IF TG_OP <> 'DELETE' THEN
    PERFORM public.refresh_boat_owners(NEW.tenant_id, NEW.boat_id);
  END IF;
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.boat_id <> NEW.boat_id) THEN
    PERFORM public.refresh_boat_owners(OLD.tenant_id, OLD.boat_id);
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER customer_search_engine
  AFTER INSERT OR UPDATE OF boat_id, make, model, serial_number, deleted_at OR DELETE ON engine
  FOR EACH ROW EXECUTE FUNCTION public.customer_search_on_engine();--> statement-breakpoint

CREATE FUNCTION public.customer_search_on_drive() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  row_ record;
BEGIN
  row_ := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  PERFORM public.refresh_boat_owners(e.tenant_id, e.boat_id)
  FROM engine e
  WHERE e.tenant_id = row_.tenant_id AND e.id = row_.engine_id;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER customer_search_drive
  AFTER INSERT OR UPDATE OF engine_id, type, serial_number, deleted_at OR DELETE ON drive
  FOR EACH ROW EXECUTE FUNCTION public.customer_search_on_drive();--> statement-breakpoint

CREATE FUNCTION public.customer_search_on_placement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  IF TG_OP <> 'DELETE' THEN
    PERFORM public.refresh_boat_owners(NEW.tenant_id, NEW.boat_id);
  END IF;
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.boat_id <> NEW.boat_id) THEN
    PERFORM public.refresh_boat_owners(OLD.tenant_id, OLD.boat_id);
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER customer_search_placement
  AFTER INSERT OR UPDATE OF boat_id, location_id, deleted_at OR DELETE ON boat_placement
  FOR EACH ROW EXECUTE FUNCTION public.customer_search_on_placement();--> statement-breakpoint

-- A marina that is renamed or removed changes the text of every customer with a boat there.
CREATE FUNCTION public.customer_search_on_location() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  PERFORM public.refresh_customer_search(NEW.tenant_id, x.customer_id)
  FROM (
    SELECT DISTINCT o.customer_id
    FROM boat_placement bp
    JOIN boat_ownership o
      ON o.tenant_id = bp.tenant_id AND o.boat_id = bp.boat_id AND o.deleted_at IS NULL
    WHERE bp.tenant_id = NEW.tenant_id AND bp.location_id = NEW.id AND bp.deleted_at IS NULL
  ) x;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER customer_search_location AFTER UPDATE OF name, deleted_at ON location
  FOR EACH ROW EXECUTE FUNCTION public.customer_search_on_location();--> statement-breakpoint

REVOKE ALL ON FUNCTION public.customer_search_on_customer() FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.customer_search_on_ownership() FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.customer_search_on_boat() FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.customer_search_on_engine() FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.customer_search_on_drive() FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.customer_search_on_placement() FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.customer_search_on_location() FROM PUBLIC, anon, authenticated;--> statement-breakpoint

-- The customers that already exist.
SELECT public.refresh_customer_search(tenant_id, id) FROM customer;
