-- Repair an empty legacy comment relay whose sequence belongs to a different
-- role. Existing comment data requires an administrator's sequence grant;
-- never infer a cursor high-water mark or reset a sequence on a populated relay.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';
LOCK TABLE public.project_comments IN ACCESS EXCLUSIVE MODE;
DO $$
DECLARE
  sequence_oid OID;
BEGIN
  SELECT dependency.refobjid INTO sequence_oid
    FROM pg_attrdef AS defaults
    JOIN pg_attribute AS columns ON columns.attrelid = defaults.adrelid
      AND columns.attnum = defaults.adnum
    JOIN pg_depend AS dependency ON dependency.classid = 'pg_attrdef'::regclass
      AND dependency.objid = defaults.oid
    JOIN pg_class AS sequence ON sequence.oid = dependency.refobjid AND sequence.relkind = 'S'
    WHERE defaults.adrelid = 'public.project_comments'::regclass AND columns.attname = 'seq';
  IF sequence_oid IS NULL THEN
    RAISE EXCEPTION 'Comment sequence default is missing; administrator review required';
  END IF;
  IF has_sequence_privilege(current_user, sequence_oid, 'USAGE') THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.project_comments) THEN
    RAISE EXCEPTION 'Existing comments require an administrator sequence grant; no data changed';
  END IF;
  CREATE SEQUENCE IF NOT EXISTS public.project_comments_app_seq;
  IF NOT has_sequence_privilege(current_user, 'public.project_comments_app_seq', 'USAGE') THEN
    RAISE EXCEPTION 'Application sequence is not accessible; no default changed';
  END IF;
  ALTER TABLE public.project_comments ALTER COLUMN seq
    SET DEFAULT nextval('public.project_comments_app_seq'::regclass);
END $$;
COMMIT;
