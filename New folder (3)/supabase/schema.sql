-- EstateLink uses the existing public tables defined by the project owner:
-- profiles, properties, property_images, and favorites.
-- This file is intentionally read-only. Do not create duplicate tables or
-- change RLS policies here.

select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in ('profiles', 'properties', 'property_images', 'favorites')
order by table_name, ordinal_position;
