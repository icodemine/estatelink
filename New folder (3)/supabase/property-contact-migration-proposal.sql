-- REVIEW REQUIRED: do not apply until the live public.profiles and public.properties
-- column names, types, and existing RLS policies have been confirmed.
-- This proposal does not create tables or change public.properties ownership.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS whatsapp_phone text,
  ADD COLUMN IF NOT EXISTS public_contact_email text,
  ADD COLUMN IF NOT EXISTS publish_contact_name boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS publish_contact_phone boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS publish_contact_whatsapp boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS publish_contact_email boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.validate_property_contact_profile()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.phone IS NOT NULL
       AND NEW.phone !~ '^(\+[1-9][0-9]{7,14}|0[0-9]{9}|233[0-9]{9})$' THEN
      RAISE EXCEPTION 'Enter a valid phone number in international format.';
    END IF;
  ELSIF NEW.phone IS DISTINCT FROM OLD.phone THEN
    IF NEW.phone IS NOT NULL
       AND NEW.phone !~ '^(\+[1-9][0-9]{7,14}|0[0-9]{9}|233[0-9]{9})$' THEN
      RAISE EXCEPTION 'Enter a valid phone number in international format.';
    END IF;
  END IF;

  IF NEW.whatsapp_phone IS NOT NULL
     AND NEW.whatsapp_phone !~ '^\+[1-9][0-9]{7,14}$' THEN
    RAISE EXCEPTION 'Enter a valid WhatsApp number in international format.';
  END IF;

  IF NEW.public_contact_email IS NOT NULL
     AND (length(NEW.public_contact_email) > 254
          OR NEW.public_contact_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') THEN
    RAISE EXCEPTION 'Enter a valid contact email address.';
  END IF;

  IF NEW.publish_contact_name AND (NEW.full_name IS NULL OR btrim(NEW.full_name) = '') THEN
    RAISE EXCEPTION 'A contact name is required before it can be shared.';
  END IF;
  IF NEW.publish_contact_phone AND NEW.phone IS NULL THEN
    RAISE EXCEPTION 'A phone number is required before it can be shared.';
  END IF;
  IF NEW.publish_contact_whatsapp AND NEW.whatsapp_phone IS NULL THEN
    RAISE EXCEPTION 'A WhatsApp number is required before it can be shared.';
  END IF;
  IF NEW.publish_contact_email AND NEW.public_contact_email IS NULL THEN
    RAISE EXCEPTION 'A contact email is required before it can be shared.';
  END IF;

  RETURN NEW;
END;
$function$;

DO $block$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgname = 'validate_property_contact_profile'
      AND tgrelid = 'public.profiles'::regclass
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER validate_property_contact_profile
      BEFORE INSERT OR UPDATE ON public.profiles
      FOR EACH ROW EXECUTE FUNCTION public.validate_property_contact_profile();
  END IF;
END;
$block$;

-- This restrictive policy is combined with existing permissive policies. It
-- prevents updates to another profile even if a permissive UPDATE policy is broad.
DO $block$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class
    WHERE oid = 'public.profiles'::regclass AND relrowsecurity
  ) THEN
    RAISE EXCEPTION 'Enable and review RLS on public.profiles before applying this proposal.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'profiles_contact_owner_select_guard'
  ) THEN
    CREATE POLICY profiles_contact_owner_select_guard
      ON public.profiles AS RESTRICTIVE
      FOR SELECT TO anon, authenticated
      USING (id = (SELECT auth.uid()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'profiles_contact_owner_update_guard'
  ) THEN
    CREATE POLICY profiles_contact_owner_update_guard
      ON public.profiles AS RESTRICTIVE
      FOR UPDATE TO authenticated
      USING (id = (SELECT auth.uid()))
      WITH CHECK (id = (SELECT auth.uid()));
  END IF;
END;
$block$;

-- The only public read path returns consented contact fields for a currently
-- published property. It never returns profile IDs, roles, or account emails.
CREATE OR REPLACE FUNCTION public.get_published_property_contact(p_property_id text)
RETURNS TABLE (
  contact_name text,
  contact_phone text,
  contact_whatsapp text,
  contact_email text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT
    CASE
      WHEN profile.publish_contact_name
       AND NULLIF(btrim(profile.full_name), '') IS NOT NULL
      THEN profile.full_name
    END,
    CASE
      WHEN profile.publish_contact_phone
       AND profile.phone ~ '^(\+[1-9][0-9]{7,14}|0[0-9]{9}|233[0-9]{9})$'
      THEN profile.phone
    END,
    CASE
      WHEN profile.publish_contact_whatsapp
       AND profile.whatsapp_phone ~ '^\+[1-9][0-9]{7,14}$'
      THEN profile.whatsapp_phone
    END,
    CASE
      WHEN profile.publish_contact_email
       AND profile.public_contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      THEN profile.public_contact_email
    END
  FROM public.properties AS property
  LEFT JOIN public.profiles AS profile ON profile.id = property.owner_id
  WHERE p_property_id IS NOT NULL
    AND length(p_property_id) <= 64
    AND property.id::text = p_property_id
    AND property.status = 'published'
  LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.get_published_property_contact(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_published_property_contact(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_published_property_contact(text) TO anon, authenticated;

-- Before applying, confirm properties.id can be cast to text, owner_id joins to
-- profiles.id, profiles.phone/full_name already exist, and the existing owner
-- UPDATE policy still permits a signed-in user to update their own profile.
