-- patch_v12_drop_all_functions_dynamic.sql
-- Dynamically drop ALL user-defined functions in public schema.
-- Safe because functions.sql immediately recreates them all.

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::TEXT AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.prokind IN ('f', 'p')
  LOOP
    EXECUTE 'DROP ROUTINE IF EXISTS ' || r.sig || ' CASCADE';
  END LOOP;
END;
$$;
