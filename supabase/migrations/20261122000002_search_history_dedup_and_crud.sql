-- ============================================================================
-- Migration: Search History Deduplication & CRUD Controls
-- Purpose  : Prevent duplicate search_history rows for the same employee
--            on the same calendar day, and add helper indexes for fast CRUD.
-- ============================================================================

-- 1. Remove any old duplicates (keep only the LATEST record per employee per day)
--    We use a CTE to identify the row to keep, then delete the rest.
DO $$
DECLARE
  deleted_count INTEGER;
BEGIN
  -- Delete duplicate rows keeping the most-recent (highest search_timestamp)
  WITH ranked AS (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY
          COALESCE(national_id, ''),
          date(search_timestamp AT TIME ZONE 'UTC')
        ORDER BY search_timestamp DESC
      ) AS rn
    FROM public.search_history
    WHERE national_id IS NOT NULL
      AND result_found = TRUE
  )
  DELETE FROM public.search_history
  WHERE id IN (
    SELECT id FROM ranked WHERE rn > 1
  );

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RAISE NOTICE 'Deleted % duplicate search_history rows (national_id-based)', deleted_count;
END $$;

DO $$
DECLARE
  deleted_count INTEGER;
BEGIN
  -- Also deduplicate by employee_code where national_id is NULL
  WITH ranked AS (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY
          COALESCE(employee_code, ''),
          date(search_timestamp AT TIME ZONE 'UTC')
        ORDER BY search_timestamp DESC
      ) AS rn
    FROM public.search_history
    WHERE national_id IS NULL
      AND employee_code IS NOT NULL
      AND result_found = TRUE
  )
  DELETE FROM public.search_history
  WHERE id IN (
    SELECT id FROM ranked WHERE rn > 1
  );

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RAISE NOTICE 'Deleted % duplicate search_history rows (employee_code-based)', deleted_count;
END $$;


-- 2. Add a computed column for the search date (UTC day) to support fast dedup
--    (Only if the column doesn't already exist)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'search_history'
      AND column_name  = 'search_date'
  ) THEN
    ALTER TABLE public.search_history
      ADD COLUMN search_date DATE
        GENERATED ALWAYS AS (date(search_timestamp AT TIME ZONE 'UTC')) STORED;
    RAISE NOTICE 'Added search_date computed column to search_history';
  ELSE
    RAISE NOTICE 'search_date column already exists — skipping';
  END IF;
END $$;


-- 3. Create a PARTIAL unique index to enforce one record per employee per day
--    Covers national_id (primary dedup key)
CREATE UNIQUE INDEX IF NOT EXISTS
  idx_search_history_unique_natid_day
ON public.search_history (national_id, search_date)
WHERE national_id IS NOT NULL
  AND result_found = TRUE;

-- Covers employee_code where national_id is not available
CREATE UNIQUE INDEX IF NOT EXISTS
  idx_search_history_unique_code_day
ON public.search_history (employee_code, search_date)
WHERE national_id IS NULL
  AND employee_code IS NOT NULL
  AND result_found = TRUE;


-- 4. Performance indexes for CRUD operations
CREATE INDEX IF NOT EXISTS idx_search_history_timestamp
  ON public.search_history (search_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_search_history_purpose
  ON public.search_history ((search_result->>'_search_purpose'));

CREATE INDEX IF NOT EXISTS idx_search_history_result_found
  ON public.search_history (result_found, search_timestamp DESC);


-- 5. Grant CRUD permissions on search_history (anon role for the app)
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.search_history
  TO anon;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.search_history
  TO authenticated;


-- ============================================================================
-- Summary of what this migration does:
--  ✅ Removes existing duplicates (same employee, same day)
--  ✅ Adds search_date computed column (UTC day)
--  ✅ Adds UNIQUE partial indexes to block future duplicates at DB level
--  ✅ Adds performance indexes for CRUD filters (timestamp, purpose, result_found)
--  ✅ Grants full CRUD permissions to app roles
-- ============================================================================
