-- Forward migration: repair the baseline trigger function
-- update_last_updated_at(). The baseline body unconditionally assigns
-- NEW.last_updated_at, but the same function is attached to sheet_data
-- (trigger_sheet_data_updated), a table that has NO last_updated_at column
-- (it has updated_at). Result on the production baseline: ANY UPDATE on
-- sheet_data fails with PG error 42703, which blocks the
-- same-source-correction path (the consolidation trigger fires AFTER
-- INSERT OR UPDATE on sheet_data). This is a dependency of the approved
-- reimport-correction outcome, fixed here on the isolated branch only.
--
-- Fix: stamp last_updated_at only when the row actually has that column.
-- employees_master behavior is unchanged.

CREATE OR REPLACE FUNCTION update_last_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    IF to_jsonb(NEW) ? 'last_updated_at' THEN
        NEW := jsonb_populate_record(NEW, jsonb_build_object('last_updated_at', NOW()));
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
