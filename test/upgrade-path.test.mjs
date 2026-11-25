// UPGRADE-PATH proof: baseline (production-shape) migrations + populated
// fixture FIRST, then the new forward migrations. A fresh-install pass is
// not upgrade evidence.
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { readFileSync, readdirSync } from 'fs';

const MIG_DIR = new URL('../supabase/migrations/', import.meta.url).pathname;
const all = readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql')).sort();
const NEW = ['20261125000001_account_period_isolation.sql', '20261125000002_blank_cell_no_erase_consolidation.sql', '20261125000003_fix_sheet_data_update_trigger.sql', '20261125000004_source_removal_recompute.sql', '20261125000005_account_scoped_sheet_catalog.sql'];
const baseline = all.filter((f) => !NEW.includes(f));
const forward = all.filter((f) => NEW.includes(f));

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => { if (cond) { pass++; console.log('PASS ', name, ' ', detail); } else { fail++; console.log('FAIL ', name, ' ', detail); } };

const ep = new EmbeddedPostgres({ databaseDir: '/tmp/pg-upgrade', user: 'postgres', password: 'postgres', port: 5547, persistent: false });
await ep.initialise(); await ep.start(); await ep.createDatabase('upg');
const db = new pg.Client({ host: '127.0.0.1', port: 5547, user: 'postgres', password: 'postgres', database: 'upg' });
await db.connect();
await db.query(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;`);

// Phase 1: production baseline ONLY
for (const f of baseline) await db.query(readFileSync(MIG_DIR + f, 'utf8'));
check('baseline migrations apply clean (production shape)', true, baseline.length + ' files');

// Phase 1b: baseline defect proof — UPDATE on sheet_data fails on the
// UNMODIFIED baseline (update_last_updated_at assigns a column sheet_data
// does not have). Insert a row first, then expect 42703.
await db.query(`INSERT INTO employees_master (company_account, employee_code, national_id, employee_name, current_status, current_job_title, consolidated_data)
  VALUES ('m.g', '5005', '55555555555555', 'موظف ترقية', 'Active', 'محاسب', '{"الوظيفه":"محاسب","الراتب":5000,"عدد أيام":0}') RETURNING id`);
const empId = (await db.query(`SELECT id FROM employees_master WHERE national_id='55555555555555'`)).rows[0].id;
await db.query(`INSERT INTO dynamic_sheets (id, sheet_name, display_name, is_master_source, column_definitions, matching_keys) VALUES (gen_random_uuid(), 'Sheet1', 'Sheet1', false, '[]'::jsonb, ARRAY['national_id']) ON CONFLICT DO NOTHING`);
const sheetId = (await db.query(`SELECT id FROM dynamic_sheets WHERE sheet_name='Sheet1' LIMIT 1`)).rows[0].id;
await db.query(`INSERT INTO import_logs (source_type, file_name) VALUES ('smart_import', 'upgrade-fixture.xlsx') RETURNING id`);
const logId = (await db.query(`SELECT id FROM import_logs WHERE file_name='upgrade-fixture.xlsx'`)).rows[0].id;
await db.query(`INSERT INTO sheet_data (sheet_id, employee_id, row_data, row_code, row_national_id, row_name, import_id, row_number, is_latest)
  VALUES ($1, $2, $3, '5005', '55555555555555', 'موظف ترقية', $4, 1, true)`,
  [sheetId, empId, JSON.stringify({ 'الوظيفه': 'محاسب', 'الراتب': 5000, 'عدد أيام': 0 }), logId]);
let baselineUpdateErr = null;
try {
  await db.query(`UPDATE sheet_data SET row_number = 1 WHERE sheet_id=$1 AND employee_id=$2`, [sheetId, empId]);
} catch (e) { baselineUpdateErr = e.code; }
check('baseline defect reproduced: UPDATE on sheet_data fails (42703) pre-upgrade', baselineUpdateErr === '42703', String(baselineUpdateErr));

// Phase 3: apply the forward migrations ON TOP (the upgrade)
for (const f of forward) await db.query(readFileSync(MIG_DIR + f, 'utf8'));
check('forward migrations apply on populated baseline', true, forward.join(' + '));

// Phase 4: new import row with a BLANK الوظيفه and updated الراتب in the SAME
// source sheet (later created_at = same-source correction/reimport).
await db.query(`INSERT INTO sheet_data (sheet_id, employee_id, row_data, row_code, row_national_id, row_name, import_id, row_number, is_latest, created_at)
  VALUES ($1, $2, $3, '5005', '55555555555555', 'موظف ترقية', $4, 2, true, NOW() + interval '1 minute')`,
  [sheetId, empId, JSON.stringify({ 'الوظيفه': null, 'الراتب': 7000 }), logId]);

let after = (await db.query(`SELECT consolidated_data, current_job_title FROM employees_master WHERE id=$1`, [empId])).rows[0];
let cd = after.consolidated_data || {};
check('upgrade: blank cell did NOT erase existing value', cd['الوظيفه'] === 'محاسب', JSON.stringify(cd).slice(0, 160));
check('upgrade: same-source nonempty update applied', String(cd['الراتب']) === '7000', String(cd['الراتب']));
check('upgrade: meaningful zero preserved', String(cd['عدد أيام']) === '0', String(cd['عدد أيام']));
check('upgrade: scalar intact under single-source agreement', after.current_job_title === 'محاسب', String(after.current_job_title));

// Phase 5: REAL UPDATE of an existing sheet_data row (not insert-only) —
// exercises the repaired trigger end to end and proves reimport correction
// via UPDATE propagates to consolidated_data.
let updateErr = null;
try {
  await db.query(`UPDATE sheet_data SET row_data = row_data || '{"المنطقه":"القاهرة"}'::jsonb WHERE sheet_id=$1 AND employee_id=$2 AND row_number=1`, [sheetId, empId]);
} catch (e) { updateErr = e.message; }
check('post-upgrade: UPDATE on existing sheet_data row succeeds', updateErr === null, String(updateErr));
after = (await db.query(`SELECT consolidated_data FROM employees_master WHERE id=$1`, [empId])).rows[0];
cd = after.consolidated_data || {};
check('post-upgrade: UPDATE propagates to consolidated_data', cd['المنطقه'] === 'القاهرة', JSON.stringify(cd['المنطقه']));

// Phase 6: cross-source disagreement must NOT be auto-resolved by upload
// recency. A DIFFERENT sheet (independent source) with a NEWER row and a
// different الوظيفه must leave the scalar withheld and the conflict visible.
await db.query(`INSERT INTO dynamic_sheets (id, sheet_name, display_name, is_master_source, column_definitions, matching_keys) VALUES (gen_random_uuid(), 'Sheet2', 'Sheet2', false, '[]'::jsonb, ARRAY['national_id']) ON CONFLICT DO NOTHING`);
const sheet2Id = (await db.query(`SELECT id FROM dynamic_sheets WHERE sheet_name='Sheet2' LIMIT 1`)).rows[0].id;
await db.query(`INSERT INTO sheet_data (sheet_id, employee_id, row_data, row_code, row_national_id, row_name, import_id, row_number, is_latest, created_at)
  VALUES ($1, $2, $3, '5005', '55555555555555', 'موظف ترقية', $4, 1, true, NOW() + interval '2 minutes')`,
  [sheet2Id, empId, JSON.stringify({ 'الوظيفه': 'محاسب أول' }), logId]);
after = (await db.query(`SELECT consolidated_data, current_job_title FROM employees_master WHERE id=$1`, [empId])).rows[0];
cd = after.consolidated_data || {};
const fc = cd.field_conflicts || {};
check('cross-source: newer upload did NOT silently win (scalar withheld)', cd['الوظيفه'] === undefined, JSON.stringify(cd['الوظيفه']));
check('cross-source: conflict recorded with BOTH sources', Array.isArray(fc['الوظيفه']) && fc['الوظيفه'].length === 2 && new Set(fc['الوظيفه'].map((e) => e.source)).size === 2, JSON.stringify(fc['الوظيفه'] || null).slice(0, 200));
check('cross-source: conflicting scalar column set to NULL (unresolved, not authoritative)', after.current_job_title === null, String(after.current_job_title));

// Phase 7: same-source correction via UPDATE resolves the disagreement when
// the second source is corrected to agree — no fabricated new source.
await db.query(`UPDATE sheet_data SET row_data = '{"الوظيفه":"محاسب"}'::jsonb WHERE sheet_id=$1 AND employee_id=$2`, [sheet2Id, empId]);
after = (await db.query(`SELECT consolidated_data, current_job_title FROM employees_master WHERE id=$1`, [empId])).rows[0];
cd = after.consolidated_data || {};
check('correction: agreement restores scalar value', cd['الوظيفه'] === 'محاسب' && after.current_job_title === 'محاسب', JSON.stringify(cd['الوظيفه']));
check('correction: conflict cleared once sources agree', !(cd.field_conflicts && cd.field_conflicts['الوظيفه']), JSON.stringify(cd.field_conflicts || null).slice(0, 200));

// Rollback plan: restoring the baseline function body is the inverse
// CREATE OR REPLACE (documented in the migration header; not executed here).
console.log(`${pass} passed, ${fail} failed`);
await db.end(); await ep.stop();
process.exit(fail ? 1 : 0);
