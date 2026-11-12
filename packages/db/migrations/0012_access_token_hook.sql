-- Supabase Auth calls this before it issues a token (byggplan step 2.7). It adds the firm,
-- the role and the app_user id of the signed-in staff member, so Row Level Security
-- (`auth.jwt() ->> 'tenant_id'`) and the server know who is asking. A user who is not
-- staff gets no tenant_id and therefore sees nothing.
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  claims jsonb := event -> 'claims';
  staff record;
BEGIN
  SELECT u.id, u.tenant_id, u.role
    INTO staff
    FROM public.app_user u
   WHERE u.auth_user_id = (event ->> 'user_id')::uuid
     AND u.deleted_at IS NULL
   LIMIT 1;

  IF staff.id IS NULL THEN
    claims := claims - 'tenant_id' - 'app_role' - 'app_user_id';
  ELSE
    claims := claims
      || jsonb_build_object(
           'tenant_id', staff.tenant_id::text,
           'app_role', staff.role::text,
           'app_user_id', staff.id::text
         );
  END IF;
  RETURN jsonb_build_object('claims', claims);
END;
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM authenticated, anon, public;
--> statement-breakpoint
GRANT SELECT ON public.app_user TO supabase_auth_admin;
