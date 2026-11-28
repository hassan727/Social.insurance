-- Reversal of 20261128000003_source_rows_one_per_person.sql. Run in one transaction (psql -1).
-- Puts back every removed duplicate row exactly as it was (from removed_duplicate_rows),
-- drops the locks, keys, person_id columns, functions and the review items it created.
DROP INDEX IF EXISTS public.uq_payroll_one_per_person_month, public.uq_monthly_ins_one_per_person_month,
  public.uq_incoming_one_per_request, public.uq_resignation_one_per_event,
  public.idx_payroll_person, public.idx_mins_person, public.idx_incoming_person, public.idx_res_person;
ALTER TABLE public.monthly_payroll_records    DROP COLUMN IF EXISTS row_key, DROP COLUMN IF EXISTS identity_key;
ALTER TABLE public.monthly_insurance_records  DROP COLUMN IF EXISTS row_key, DROP COLUMN IF EXISTS identity_key;
ALTER TABLE public.incoming_insurance_records DROP COLUMN IF EXISTS row_key, DROP COLUMN IF EXISTS identity_key;
ALTER TABLE public.resignation_records        DROP COLUMN IF EXISTS row_key, DROP COLUMN IF EXISTS identity_key;

INSERT INTO public.monthly_payroll_records SELECT (jsonb_populate_record(NULL::public.monthly_payroll_records, row_json)).*
  FROM public.removed_duplicate_rows WHERE src_table = 'monthly_payroll_records';
INSERT INTO public.monthly_insurance_records SELECT (jsonb_populate_record(NULL::public.monthly_insurance_records, row_json)).*
  FROM public.removed_duplicate_rows WHERE src_table = 'monthly_insurance_records';
INSERT INTO public.incoming_insurance_records SELECT (jsonb_populate_record(NULL::public.incoming_insurance_records, row_json)).*
  FROM public.removed_duplicate_rows WHERE src_table = 'incoming_insurance_records';
INSERT INTO public.resignation_records SELECT (jsonb_populate_record(NULL::public.resignation_records, row_json)).*
  FROM public.removed_duplicate_rows WHERE src_table = 'resignation_records';

ALTER TABLE public.monthly_payroll_records    DROP COLUMN IF EXISTS person_id;
ALTER TABLE public.monthly_insurance_records  DROP COLUMN IF EXISTS person_id;
ALTER TABLE public.incoming_insurance_records DROP COLUMN IF EXISTS person_id;
ALTER TABLE public.resignation_records        DROP COLUMN IF EXISTS person_id;

DELETE FROM public.matching_conflicts WHERE conflict_type IN
  ('import_empty_row_only','import_unmatched_person','import_no_national_id','import_name_differs','import_code_conflict');
DROP FUNCTION IF EXISTS public.import_source_records(TEXT, UUID, JSONB, BOOLEAN);
DROP FUNCTION IF EXISTS public.link_source_person_ids();
DROP FUNCTION IF EXISTS public.norm_ar(TEXT);
DROP FUNCTION IF EXISTS public.row_is_covered_by(JSONB, JSONB);
DROP FUNCTION IF EXISTS public.row_fullness(JSONB);
DROP TABLE IF EXISTS public.removed_duplicate_rows;
