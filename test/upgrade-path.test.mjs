// UPGRADE-PATH proof: baseline (production-shape) migrations + populated
// fixture FIRST, then the new forward migrations. A fresh-install pass is
// not upgrade evidence.
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { readFileSync, readdirSync } from 'fs';

const MIG_DIR = new URL('../supabase/migrations/', import.meta.url).pathname;
const all = readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql')).sort();
const NEW = ['20261125000001_account_period_isolation.sql', '20261125000002_blank_cell_no_erase_consolidation.sql', '20261125000003_fix_sheet_data_update_trigger.sql', '20261125000004_source_removal_recompute.sql', '20261125000005_account_scoped_sheet_catalog.sql', '20261125000006_transfer_effective_dating.sql', '20261125000007_lockdown_direct_db_access.sql'];
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

// Phase 8: transfer effective-dating on the UPGRADED (populated) baseline —
// the new columns/functions must work on pre-existing rows, not only on a
// fresh install.
const tr = (await db.query(`SELECT public.confirm_account_transfer($1, 'E.G', CURRENT_DATE - 1, 'account_transfer', 'ترقية', NULL, 'tester', 'm.g', NULL) r`, [empId])).rows[0].r;
check('upgrade: transfer function works on pre-existing master row', tr.success === true && tr.applied_now === true && tr.current_company === 'E.G', JSON.stringify(tr));
const upgMaster = (await db.query(`SELECT company_account FROM employees_master WHERE id=$1`, [empId])).rows[0];
check('upgrade: populated master switched with effective date', upgMaster.company_account === 'E.G', JSON.stringify(upgMaster));
const upgHist = (await db.query(`SELECT change_type, effective_date, confirmed_by FROM employee_history WHERE employee_id=$1`, [empId])).rows;
check('upgrade: history row carries effective_date + provenance on upgraded schema', upgHist.length === 1 && upgHist[0].change_type === 'account_transfer' && !!upgHist[0].effective_date && upgHist[0].confirmed_by === 'tester', JSON.stringify(upgHist).slice(0, 200));

// Phase 9: 06 REVERSAL on the upgraded DB that now carries a real event
// (Phase 8). The reversal script must preserve dates/provenance in the
// archive, drop functions+index+columns, leave the master snapshot intact,
// and be idempotent. Code rollback would precede this in a real rollback;
// here we verify the script's own contract.
const reversal = readFileSync(new URL('../supabase/reversals/20261125000006_transfer_effective_dating.reversal.sql', import.meta.url), 'utf8');
await db.query(reversal);
const arch = (await db.query(`SELECT employee_id, change_type, effective_date, confirmed_by FROM public.employee_history_provenance_archive WHERE employee_id=$1`, [empId])).rows;
check('reversal: archive preserved the event with date + provenance', arch.length === 1 && arch[0].change_type === 'account_transfer' && !!arch[0].effective_date && arch[0].confirmed_by === 'tester', JSON.stringify(arch).slice(0, 200));
const cols = (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='employee_history' AND column_name IN ('effective_date','confirmed_by')`)).rows;
check('reversal: effective_date + confirmed_by columns dropped', cols.length === 0, JSON.stringify(cols));
const funcs = (await db.query(`SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND proname IN ('confirm_account_transfer','apply_due_company_transfers','resolve_current_company','compute_account_employee_uid','canonical_company_text')`)).rows;
check('reversal: all five 06 functions dropped (grants die with them)', funcs.length === 0, JSON.stringify(funcs));
const masterAfter = (await db.query(`SELECT company_account FROM employees_master WHERE id=$1`, [empId])).rows[0];
check('reversal: master snapshot untouched by reversal', masterAfter.company_account === 'E.G', JSON.stringify(masterAfter));
await db.query(reversal);
const arch2 = (await db.query(`SELECT count(*)::int AS n FROM public.employee_history_provenance_archive WHERE employee_id=$1`, [empId])).rows[0];
check('reversal: idempotent second run (archive not duplicated)', arch2.n === 1, JSON.stringify(arch2));
console.log(`${pass} passed, ${fail} failed`);
await db.end(); await ep.stop();
process.exit(fail ? 1 : 0);
