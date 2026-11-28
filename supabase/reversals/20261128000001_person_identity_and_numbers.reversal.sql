-- Reversal of 20261128000001_person_identity_and_numbers.sql
-- Run in ONE transaction (psql -1). Safe only while no code depends on the new columns.
-- Removes the identity tables/columns/trigger and the GASCO/DMC accounts IF they have no employees.
DROP TRIGGER IF EXISTS zz_employees_master_identity ON public.employees_master;
DROP FUNCTION IF EXISTS public.confirm_identity_correction(UUID, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.assign_employee_identity();
DROP INDEX IF EXISTS public.idx_employees_master_person;
DROP INDEX IF EXISTS public.idx_employees_master_person_uid_account;
DROP INDEX IF EXISTS public.idx_employees_master_operating_no;
ALTER TABLE public.employees_master DROP COLUMN IF EXISTS person_id, DROP COLUMN IF EXISTS person_uid, DROP COLUMN IF EXISTS operating_no;
DROP TABLE IF EXISTS public.person_identifiers;
DROP TABLE IF EXISTS public.person_account_numbers;
DROP TABLE IF EXISTS public.persons;
DROP FUNCTION IF EXISTS public.next_number(TEXT);
DROP TABLE IF EXISTS public.number_counters;
DELETE FROM public.company_accounts WHERE account_code IN ('GASCO','DMC')
  AND NOT EXISTS (SELECT 1 FROM public.employees_master e WHERE e.account_id = company_accounts.id);
