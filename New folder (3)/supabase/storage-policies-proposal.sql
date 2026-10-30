-- REVIEW REQUIRED: create the private "estate-property-images" bucket in the
-- Supabase Dashboard first. Confirm properties.id, owner_id, status, and the
-- property_images relationship/policies before applying these Storage rules.
-- This proposal does not create a bucket or alter existing policies.

-- Inspect existing Storage policies first. Any permissive policy that applies
-- to this bucket can broaden access beyond the rules below.
SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
FROM pg_catalog.pg_policies
WHERE schemaname = 'storage'
  AND tablename = 'objects'
ORDER BY policyname;

DO $block$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class
    WHERE oid = 'storage.objects'::regclass AND relrowsecurity
  ) THEN
    RAISE EXCEPTION 'RLS must be enabled on storage.objects before these policies are created.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'estate_property_images_read_published_or_owned'
  ) THEN
    CREATE POLICY estate_property_images_read_published_or_owned
      ON storage.objects
      FOR SELECT TO anon, authenticated
      USING (
        bucket_id = 'estate-property-images'
        AND EXISTS (
          SELECT 1
          FROM public.properties AS property
          WHERE property.id::text = (storage.foldername(name))[2]
            AND (
              property.status = 'published'
              OR property.owner_id = (SELECT auth.uid())
            )
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'estate_property_images_insert_owned'
  ) THEN
    CREATE POLICY estate_property_images_insert_owned
      ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'estate-property-images'
        AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
        AND EXISTS (
          SELECT 1
          FROM public.properties AS property
          WHERE property.id::text = (storage.foldername(name))[2]
            AND property.owner_id = (SELECT auth.uid())
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'estate_property_images_delete_owned'
  ) THEN
    CREATE POLICY estate_property_images_delete_owned
      ON storage.objects
      FOR DELETE TO authenticated
      USING (
        bucket_id = 'estate-property-images'
        AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
      );
  END IF;
END;
$block$;

-- There is intentionally no UPDATE policy (uploads use upsert=false) and no
-- public bucket policy. Signed URLs are only generated after this SELECT
-- policy allows the caller to access the object.
