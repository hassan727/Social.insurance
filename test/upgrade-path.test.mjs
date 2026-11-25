// UPGRADE-PATH proof: baseline (production-shape) migrations + populated
// fixture FIRST, then the new forward migrations. A fresh-install pass is
// not upgrade evidence.
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { readFileSync, readdirSync } from 'fs';

const MIG_DIR = new URL('../supabase/migrations/', import.meta.url).pathname;
const all = readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql')).sort();
const NEW = ['20261125000001_account_period_isolation.sql', '20261125000002_blank_cell_no_erase_consolidation.sql'];
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

// Phase 2: populated fixture under the BASELINE function semantics
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

// Phase 3: apply the forward migrations ON TOP (the upgrade)
for (const f of forward) await db.query(readFileSync(MIG_DIR + f, 'utf8'));
check('forward migrations apply on populated baseline', true, forward.join(' + '));

// Phase 4: new import row with a BLANK الوظيفه, updated الراتب, on the upgraded
// schema, with a later created_at (reimport order). NOTE: UPDATE on sheet_data
// is impossible on the BASELINE schema — pre-existing trigger
// update_last_updated_at() references a nonexistent column (42703). Found and
// reported, not fixed here (baseline defect, out of approved scope).
await db.query(`INSERT INTO sheet_data (sheet_id, employee_id, row_data, row_code, row_national_id, row_name, import_id, row_number, is_latest, created_at)
  VALUES ($1, $2, $3, '5005', '55555555555555', 'موظف ترقية', $4, 2, true, NOW() + interval '1 minute')`,
  [sheetId, empId, JSON.stringify({ 'الوظيفه': null, 'الراتب': 7000 }), logId]);

const after = (await db.query(`SELECT consolidated_data, current_job_title FROM employees_master WHERE id=$1`, [empId])).rows[0];
const cd = after.consolidated_data || {};
check('upgrade: blank cell did NOT erase existing value', cd['الوظيفه'] === 'محاسب', JSON.stringify(cd).slice(0, 140));
check('upgrade: nonempty update applied', String(cd['الراتب']) === '7000', String(cd['الراتب']));
check('upgrade: meaningful zero preserved', String(cd['عدد أيام']) === '0', String(cd['عدد أيام']));
check('upgrade: master scalar intact', after.current_job_title === 'محاسب', String(after.current_job_title));

// Rollback plan: restoring the baseline function body is the inverse
// CREATE OR REPLACE (kept in the bundle as documentation; not executed here).
console.log(`${pass} passed, ${fail} failed`);
await db.end(); await ep.stop();
process.exit(fail ? 1 : 0);
