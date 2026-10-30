-- Read-only checks for reviewing the EstateLink contact migration.
-- This script does not read profile/property records or alter the database.

-- Confirm the expected columns and types on the existing tables.
SELECT table_name, column_name, data_type, udt_name, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('profiles', 'properties')
ORDER BY table_name, ordinal_position;

-- Confirm RLS is enabled on the existing tables.
SELECT n.nspname AS schema_name,
       c.relname AS table_name,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS force_rls
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('profiles', 'properties')
ORDER BY c.relname;

-- Review existing profile/property policies before adding restrictive guards.
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_catalog.pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('profiles', 'properties')
ORDER BY tablename, policyname;

-- Confirm how properties and profiles relate to the authenticated users table.
SELECT source_schema.nspname AS source_schema,
       source_table.relname AS source_table,
       source_column.attname AS source_column,
       target_schema.nspname AS target_schema,
       target_table.relname AS target_table,
       target_column.attname AS target_column,
       constraint_row.conname AS constraint_name
FROM pg_catalog.pg_constraint AS constraint_row
JOIN pg_catalog.pg_class AS source_table
  ON source_table.oid = constraint_row.conrelid
JOIN pg_catalog.pg_namespace AS source_schema
  ON source_schema.oid = source_table.relnamespace
JOIN pg_catalog.pg_class AS target_table
  ON target_table.oid = constraint_row.confrelid
JOIN pg_catalog.pg_namespace AS target_schema
  ON target_schema.oid = target_table.relnamespace
JOIN LATERAL unnest(constraint_row.conkey) WITH ORDINALITY AS source_key(attnum, ord)
  ON true
JOIN LATERAL unnest(constraint_row.confkey) WITH ORDINALITY AS target_key(attnum, ord)
  ON target_key.ord = source_key.ord
JOIN pg_catalog.pg_attribute AS source_column
  ON source_column.attrelid = source_table.oid
 AND source_column.attnum = source_key.attnum
JOIN pg_catalog.pg_attribute AS target_column
  ON target_column.attrelid = target_table.oid
 AND target_column.attnum = target_key.attnum
WHERE constraint_row.contype = 'f'
  AND source_schema.nspname = 'public'
  AND source_table.relname IN ('properties', 'profiles')
ORDER BY constraint_row.conname, source_key.ord;
