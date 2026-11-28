-- Reversal of 20261128000002_unknown_account_type.sql. Run in one transaction (psql -1).
-- Only removes the UNK account if no employee is attached to it (move or delete them first).
DROP FUNCTION IF EXISTS public.register_unknown_account_person(TEXT, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.person_source_records(TEXT);
DELETE FROM public.number_counters WHERE scope = 'ACC:' || (SELECT id FROM public.company_accounts WHERE account_code = 'UNK')
  AND NOT EXISTS (SELECT 1 FROM public.employees_master e JOIN public.company_accounts a ON a.id = e.account_id WHERE a.account_code = 'UNK');
DELETE FROM public.company_accounts WHERE account_code = 'UNK'
  AND NOT EXISTS (SELECT 1 FROM public.employees_master e WHERE e.account_id = company_accounts.id);
