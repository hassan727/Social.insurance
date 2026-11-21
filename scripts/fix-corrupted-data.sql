-- ═══════════════════════════════════════════════════════════════════════════
-- EMERGENCY DATA FIX: Delete corrupted employee records
-- ═══════════════════════════════════════════════════════════════════════════
-- Problem: Employee data imported with swapped columns
-- Solution: Delete ALL employees with obvious data corruption patterns
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- Create backup table first
CREATE TABLE IF NOT EXISTS employees_master_backup_20261114 AS 
SELECT * FROM employees_master;

-- Pattern 1: Delete employees where name is a pure number (should be text)
DELETE FROM employees_master 
WHERE employee_name ~ '^\d+$';

-- Pattern 2: Delete employees where national_id contains Arabic letters (should be 14 digits)
DELETE FROM employees_master 
WHERE national_id ~ '[ا-ي]';

-- Pattern 3: Delete employees where phone_number contains Arabic address text
DELETE FROM employees_master 
WHERE phone_number ~ '[ا-ي]';

-- Pattern 4: Delete employees where current_job_title is exactly 14 digits (likely swapped with national_id)
DELETE FROM employees_master 
WHERE current_job_title ~ '^\d{14}$';

-- Report how many were deleted
SELECT 
  'Backup created' as status,
  COUNT(*) as backup_count 
FROM employees_master_backup_20261114;

SELECT 
  'Corrupted records deleted' as status,
  COUNT(*) as remaining_good_records 
FROM employees_master;

COMMIT;

-- To restore backup if needed:
-- INSERT INTO employees_master SELECT * FROM employees_master_backup_20261114;
