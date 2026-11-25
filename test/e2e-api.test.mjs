// Full isolated E2E: real PG + real PostgREST + Next dev server, synthetic
// fixtures only. Exercises ACTUAL route handlers over HTTP.
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { readFileSync, readdirSync, writeFileSync } from 'fs';
import { spawn } from 'child_process';
import http from 'http';
import * as XLSX from 'xlsx';

const MIG_DIR = new URL('../supabase/migrations/', import.meta.url).pathname;
let failures = 0;
const check = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`); if (!cond) failures++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. PG
const ep = new EmbeddedPostgres({ databaseDir: '/tmp/pg-e2e', user: 'postgres', password: 'postgres', port: 5545, persistent: false });
await ep.initialise(); await ep.start(); await ep.createDatabase('e2e');
const db = new pg.Client({ host: '127.0.0.1', port: 5545, user: 'postgres', password: 'postgres', database: 'e2e' });
await db.connect();
await db.query(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN; CREATE ROLE authenticator NOINHERIT LOGIN PASSWORD 'authpw'; GRANT anon TO authenticator;`);
for (const f of readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql')).sort()) await db.query(readFileSync(MIG_DIR + f, 'utf8'));
await db.query(`GRANT USAGE ON SCHEMA public TO anon; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon; GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon; GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon;`);
await db.query(`
  INSERT INTO employees_master (company_account, account_id, national_id, employee_code, employee_name, current_status) VALUES
    ('E.G', 1, '11111111111111', '1001', 'موظف تعارض', 'Active'),
    ('m.g', 2, '22222222222222', '2002', 'موظف متفق', 'Active');
  INSERT INTO incoming_insurance_records (employee_code, employee_name, national_id, company_account, status, insurance_status) VALUES
    ('1001', 'موظف تعارض', '11111111111111', 'M.G', 'Active', 'مؤمن عليه'),
    ('2002', 'موظف متفق', '22222222222222', 'm.g', 'Active', 'مؤمن عليه');
  INSERT INTO import_logs (source_type, file_name, period_year, period_month, account_id) VALUES
    ('monthly_payroll', 'EG OCT.xlsx', 2026, 10, 1), ('monthly_payroll', 'MODERN OCT.xlsx', 2026, 10, 2);`);
const eg = (await db.query(`SELECT id FROM import_logs WHERE file_name='EG OCT.xlsx'`)).rows[0].id;
const mg = (await db.query(`SELECT id FROM import_logs WHERE file_name='MODERN OCT.xlsx'`)).rows[0].id;
await db.query(`INSERT INTO monthly_insurance_records (import_id, period_year, period_month, national_id, employee_code, employee_name, account_id) VALUES
  ($1, 2026, 9, '22222222222222', '2002', 'موظف متفق', 2)`, [mg]);
await db.query(`INSERT INTO monthly_payroll_records (import_id, period_year, period_month, national_id, employee_code, employee_name, account_id) VALUES
  ($1, 2026, 10, '11111111111111', '1001', 'موظف تعارض', 1),
  ($2, 2026, 10, '11111111111111', '1001', 'موظف تعارض', 2),
  ($2, 2026, 10, '22222222222222', '2002', 'موظف متفق', 2),
  ($2, 2026, 10, '33333333333333', '3003', 'موظف مرتبات فقط', 2)`, [eg, mg]);
console.log('pg ready');

// 2. PostgREST (v16 requires a JWT secret once any Bearer token is sent —
// supabase-js always sends one, so mint a valid HS256 anon-role JWT)
import crypto from 'crypto';
const JWT_SECRET = 'e2e-test-only-secret-not-real-0123456789abcdef';
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const ANON_JWT = b64u({ alg: 'HS256', typ: 'JWT' }) + '.' + b64u({ role: 'anon' }) + '.' +
  crypto.createHmac('sha256', JWT_SECRET).update(b64u({ alg: 'HS256', typ: 'JWT' }) + '.' + b64u({ role: 'anon' })).digest('base64url');
writeFileSync('/tmp/postgrest.conf', `db-uri = "postgres://authenticator:authpw@127.0.0.1:5545/e2e"\ndb-schemas = "public"\ndb-anon-role = "anon"\nserver-port = 3001\njwt-secret = "${JWT_SECRET}"\n`);
const pr = spawn('/tmp/postgrest', ['/tmp/postgrest.conf'], { stdio: 'ignore' });
// 3. Prefix-strip proxy (supabase-js appends /rest/v1)
http.createServer((req, res) => {
  const u = req.url.replace(/^\/rest\/v1/, '');
  const p = http.request({ host: '127.0.0.1', port: 3001, path: u, method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  req.pipe(p); p.on('error', () => { res.statusCode = 502; res.end(); });
}).listen(3002);
await sleep(2000);

// 4. Next dev server
const dev = spawn('npm', ['run', 'dev', '--', '-p', '3100'], {
  cwd: new URL('..', import.meta.url).pathname,
  env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:3002', NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_JWT, APP_JWT_SECRET: 'test-only-dummy-secret-32chars-minimum', PORT: '3100' },
  stdio: 'ignore',
});
const api = async (path, opts = {}) => {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch('http://127.0.0.1:3100' + path, opts); return r; } catch { await sleep(1500); }
  }
  throw new Error('dev server never came up');
};
await api('/api/company-accounts');
console.log('dev server up');

// ── TESTS ──
const accs = await (await api('/api/company-accounts')).json();
check('company-accounts endpoint returns 2 accounts', accs.accounts?.length === 2, JSON.stringify(accs.accounts?.map(a => a.account_code)));

const monthsWith = (d) => (d.details?.allMonthsHistory || []).filter((m) => m.payrollRecord);
const d1 = await (await api('/api/lookup/details?national_id=11111111111111')).json();
check('conflict NID: monthly payroll WITHHELD', monthsWith(d1).length === 0, 'months=' + monthsWith(d1).length + ' err=' + (d1.error || ''));
check('conflict NID: withhold conflict surfaced', (d1.details?.conflicts || []).some((c) => c.includes('حُجبت')), (d1.details?.conflicts || []).find((c) => c.includes('حساب'))?.slice(0, 70) || 'NONE');
check('conflict NID: details accountDisplay = conflict with labeled sources', d1.details?.accountDisplay?.status === 'conflict' && d1.details.accountDisplay.masterCode === 'EG' && d1.details.accountDisplay.waradCode === 'MG', JSON.stringify(d1.details?.accountDisplay || null));
check('conflict NID: S6 not affirmative (insufficient_data, no مستمر)', d1.details?.s6_calculation?.status === 'insufficient_data' && !(d1.details?.s6_calculation?.message || '').includes('مستمر بالخدمة'), (d1.details?.s6_calculation?.message || 'NONE').slice(0, 60));
const s1 = await (await api('/api/lookup/search?q=11111111111111')).json();
check('search row: conflict badge labeled, not definitive', s1.success && s1.results?.[0]?.account_display?.status === 'conflict' && s1.results[0].company_account === '—' && s1.results[0].account_display.masterCode === 'EG' && s1.results[0].account_display.waradCode === 'MG', JSON.stringify({ca: s1.results?.[0]?.company_account, ad: s1.results?.[0]?.account_display}));
check('search row: monthly claims withheld on conflict', s1.results?.[0]?.first_both_month === 'محجوب — حساب غير محسوم' && (s1.results?.[0]?.joint_periods || []).length === 0, s1.results?.[0]?.first_both_month || 'NONE');

const d2 = await (await api('/api/lookup/details?national_id=22222222222222')).json();
check('agreeing NID: scoped payroll returned', monthsWith(d2).length === 1 && monthsWith(d2)[0].payrollRecord.account_id === 2, 'months=' + monthsWith(d2).length + ' err=' + (d2.error || ''));
check('conflict NID: latest_evidence withheld', d1.details?.latest_evidence?.withheld === true && d1.details.latest_evidence.payroll === null, JSON.stringify(d1.details?.latest_evidence || null));
check('agreeing NID: latest_evidence = real period + account label', d2.details?.latest_evidence?.withheld === false && d2.details?.latest_evidence?.payroll?.year === 2026 && d2.details?.latest_evidence?.payroll?.month === 10 && d2.details?.latest_evidence?.payroll?.accountCode === 'MG', JSON.stringify(d2.details?.latest_evidence || null));


const d3 = await (await api('/api/lookup/details?national_id=33333333333333')).json();
check('payroll-only NID: single-account rows scoped+returned', monthsWith(d3).length === 1 && monthsWith(d3)[0].payrollRecord.account_id === 2, 'months=' + monthsWith(d3).length + ' err=' + (d3.error || ''));
const d2f = await (await api('/api/lookup/details?national_id=22222222222222&company_account=MG')).json();
check('requested canonical code resolves by IDENTITY (not raw text): agreement stays agreement', d2f.details?.accountDisplay?.status === 'resolved' && d2f.details?.accountDisplay?.masterCode === 'MG' && d2f.details?.accountDisplay?.waradCode === 'MG' && !(d2f.details?.conflicts || []).some((c) => c.includes('مصدر واحد')), JSON.stringify({ad: d2f.details?.accountDisplay, conflicts: d2f.details?.conflicts}));
check('agreeing NID: latest_insurance evidence shown', d2.details?.latest_evidence?.insurance?.month === 9 && d2.details?.latest_evidence?.insurance?.accountCode === 'MG', JSON.stringify(d2.details?.latest_evidence || null));

check('payroll-only NID: single-source note', (d3.details?.conflicts || []).some((c) => c.includes('السجلات الشهرية نفسها')));

const mkXlsx = (rows) => { const ws = XLSX.utils.json_to_sheet(rows); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Sheet1'); return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })); };
const mapping = JSON.stringify({ national_id: 'الرقم القومي', employee_name: 'الاسم', employee_code: 'الكود' });
const postImport = (fields, buf) => {
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 't.xlsx');
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return api('/api/import/execute', { method: 'POST', body: fd });
};
const buf1 = mkXlsx([{ 'الرقم القومي': '44444444444444', 'الاسم': 'موظف جديد', 'الكود': '4004' }]);

const noAcct = await postImport({ source_type: 'monthly_payroll', column_mapping: mapping, period_year: '2026', period_month: '10' }, buf1);
check('import monthly w/o account → 400', noAcct.status === 400, String(noAcct.status));

const first = await postImport({ source_type: 'monthly_payroll', column_mapping: mapping, period_year: '2026', period_month: '10', company_account: 'MG' }, buf1);
check('import MG Oct existing → 409 requiresConfirmation', first.status === 409, String(first.status));

const ow = await postImport({ source_type: 'monthly_payroll', column_mapping: mapping, period_year: '2026', period_month: '10', company_account: 'MG', confirm_overwrite: 'true' }, buf1);
const owj = await ow.json().catch(() => ({}));
check('confirmed overwrite succeeds', ow.status === 200, String(ow.status) + ' ' + (owj.error || ''));

const mgRows = await db.query(`SELECT national_id FROM monthly_payroll_records WHERE period_year=2026 AND period_month=10 AND account_id=2`);
check('overwrite via route: MG Oct replaced (only new row)', mgRows.rows.length === 1 && mgRows.rows[0].national_id === '44444444444444', JSON.stringify(mgRows.rows));
const egRows = await db.query(`SELECT count(*)::int c FROM monthly_payroll_records WHERE period_year=2026 AND period_month=10 AND account_id=1`);
check('overwrite via route: EG Oct UNTOUCHED', egRows.rows[0].c === 1, 'count=' + egRows.rows[0].c);
const newRow = await db.query(`SELECT account_id FROM monthly_payroll_records WHERE national_id='44444444444444'`);
check('new row stamped with validated account (no default)', newRow.rows.length === 1 && newRow.rows[0].account_id === 2, JSON.stringify(newRow.rows));

// Blank-cell no-erase policy (user-approved 11:04). Seed an employee with
// existing values, then import files whose cells are BLANK for those fields.
await db.query(`INSERT INTO employees_master (company_account, account_id, national_id, employee_code, employee_name, current_status, current_job_title, consolidated_data) VALUES ('m.g', 2, '55555555555555', '5005', 'موظف خانات', 'Active', 'محاسب', '{"الوظيفه":"محاسب","الراتب":5000,"عدد أيام":0}')`);
// classic import: payroll file with NO job title column (missing column) must not erase current_job_title
const blankPay = mkXlsx([{ 'الرقم القومي': '55555555555555', 'الاسم': 'موظف خانات', 'الكود': '5005' }]);
const bp = await postImport({ source_type: 'monthly_payroll', column_mapping: mapping, period_year: '2026', period_month: '11', company_account: 'MG' }, blankPay);
check('classic import (missing job column) succeeds', bp.status === 200 || bp.status === 409, String(bp.status));
const bpw = bp.status === 409 ? await postImport({ source_type: 'monthly_payroll', column_mapping: mapping, period_year: '2026', period_month: '11', company_account: 'MG', confirm_overwrite: 'true' }, blankPay) : bp;
check('classic import overwrite ok', bpw.status === 200, String(bpw.status));
const mAfterClassic = (await db.query(`SELECT current_job_title, consolidated_data FROM employees_master WHERE national_id='55555555555555'`)).rows[0];
check('classic: missing column did NOT erase master job title', mAfterClassic.current_job_title === 'محاسب', String(mAfterClassic.current_job_title));
// smart-import merge: BLANK الوظيفه cell must not erase; nonempty الراتب must update; zero preserved
const smartBlank = mkXlsx([{ 'الرقم القومي': '55555555555555', 'الاسم': 'موظف خانات', 'الكود': '5005', 'الوظيفه': '', 'الراتب': 7000 }]);
const sm = await api('/api/smart-import/execute', { method: 'POST', body: (() => { const fd = new FormData(); fd.append('file', new Blob([smartBlank]), 't.xlsx'); fd.append('selected_sheets', '["Sheet1"]'); fd.append('company_account', 'MG'); return fd; })() });
const smj = await sm.json().catch(() => ({}));
const mAfterSmart = (await db.query(`SELECT consolidated_data FROM employees_master WHERE national_id='55555555555555'`)).rows[0];
const cd = mAfterSmart?.consolidated_data || {};
check('smart-import merge: blank cell did NOT erase existing value', cd['الوظيفه'] === 'محاسب', JSON.stringify(cd).slice(0, 120) + ' status=' + sm.status + ' err=' + (smj.error || ''));
check('smart-import merge: nonempty cell updated', String(cd['الراتب']) === '7000', String(cd['الراتب']));
check('smart-import merge: meaningful zero preserved', String(cd['عدد أيام']) === '0', String(cd['عدد أيام']));
// classic route: EXPLICIT zeros are meaningful and must survive the ledger path
const zeroPay = mkXlsx([{ 'الرقم القومي': '55555555555555', 'الاسم': 'موظف خانات', 'الكود': '5005', 'عدد ايام الحضور': 0, 'الراتب': 0 }]);
const zp = await postImport({ source_type: 'monthly_payroll', column_mapping: mapping, period_year: '2026', period_month: '12', company_account: 'MG' }, zeroPay);
check('classic import zero-row succeeds', zp.status === 200, String(zp.status));
const mAfterZero = (await db.query(`SELECT consolidated_data FROM employees_master WHERE national_id='55555555555555'`)).rows[0];
const led = (mAfterZero?.consolidated_data || {}).financial_ledger || {};
check('classic route: explicit 0 attendance recorded (not dropped)', String((led.attendance_by_month || {})['12']) === '0', JSON.stringify(led.attendance_by_month || null));
check('classic route: explicit 0 salary recorded (not dropped)', String((led.salaries_by_month || {})['12']) === '0', JSON.stringify(led.salaries_by_month || null));
// reimport SAME source (sheet name) must keep source identity (same dynamic_sheet id,
// no fabricated new source) and the corrected value must take effect
const sheetBefore = (await db.query(`SELECT id FROM dynamic_sheets WHERE sheet_name='Sheet1'`)).rows[0];
const smartCorr = mkXlsx([{ 'الرقم القومي': '55555555555555', 'الاسم': 'موظف خانات', 'الكود': '5005', 'الوظيفه': 'محاسب', 'الراتب': 8000 }]);
const sm2 = await api('/api/smart-import/execute', { method: 'POST', body: (() => { const fd = new FormData(); fd.append('file', new Blob([smartCorr]), 't2.xlsx'); fd.append('selected_sheets', '["Sheet1"]'); fd.append('company_account', 'MG'); return fd; })() });
check('smart reimport same sheet succeeds', sm2.status === 200, String(sm2.status));
const sheetAfter = (await db.query(`SELECT id FROM dynamic_sheets WHERE sheet_name='Sheet1'`)).rows[0];
check('reimport keeps source identity (same sheet id, no fabricated new source)', sheetBefore && sheetAfter && sheetBefore.id === sheetAfter.id, (sheetBefore||{}).id + ' vs ' + (sheetAfter||{}).id);
const mAfterRe = (await db.query(`SELECT consolidated_data FROM employees_master WHERE national_id='55555555555555'`)).rows[0];
check('reimport same-source correction applied', String((mAfterRe?.consolidated_data || {})['الراتب']) === '8000', JSON.stringify((mAfterRe?.consolidated_data || {})['الراتب']));

// cross-source disagreement (different sheet = independent source): scalar must be
// WITHHELD (NULL), conflict recorded with both sources, lookup details surfaces it
const mkXlsxB = (rows) => { const ws = XLSX.utils.json_to_sheet(rows); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'SheetB'); return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })); };
const smartConflict = mkXlsxB([{ 'الرقم القومي': '55555555555555', 'الاسم': 'موظف خانات', 'الكود': '5005', 'الوظيفه': 'محاسب أول' }]);
const sc = await api('/api/smart-import/execute', { method: 'POST', body: (() => { const fd = new FormData(); fd.append('file', new Blob([smartConflict]), 't3.xlsx'); fd.append('selected_sheets', '["SheetB"]'); fd.append('company_account', 'MG'); return fd; })() });
check('smart import conflicting second source succeeds', sc.status === 200, String(sc.status));
const mConf = (await db.query(`SELECT current_job_title, consolidated_data FROM employees_master WHERE national_id='55555555555555'`)).rows[0];
const fc = (mConf?.consolidated_data || {}).field_conflicts || {};
check('cross-source: scalar column WITHHELD (NULL, not latest-upload win)', mConf.current_job_title === null, String(mConf.current_job_title));
check('cross-source: blob scalar withheld', (mConf?.consolidated_data || {})['الوظيفه'] === undefined, JSON.stringify((mConf?.consolidated_data || {})['الوظيفه']));
check('cross-source: conflict records BOTH sources', Array.isArray(fc['الوظيفه']) && fc['الوظيفه'].length === 2 && new Set(fc['الوظيفه'].map((e) => e.source)).size === 2, JSON.stringify(fc['الوظيفه'] || null).slice(0, 160));
const dConf = await (await api('/api/lookup/details?national_id=55555555555555')).json();
check('lookup details surfaces field conflict with sources', JSON.stringify(dConf.details?.conflicts || []).includes('الوظيفة') && JSON.stringify(dConf.details?.conflicts || []).includes('محاسب أول'), JSON.stringify((dConf.details?.conflicts || []).slice(-1)).slice(0, 160));
check('lookup details returns structured field_conflicts', !!((dConf.details?.field_conflicts || {})['الوظيفه']), 'field_conflicts present');
// same-source correction resolving the conflict: fix SheetB to agree -> value restored, conflict cleared
const smartFix = mkXlsxB([{ 'الرقم القومي': '55555555555555', 'الاسم': 'موظف خانات', 'الكود': '5005', 'الوظيفه': 'محاسب' }]);
const sf = await api('/api/smart-import/execute', { method: 'POST', body: (() => { const fd = new FormData(); fd.append('file', new Blob([smartFix]), 't4.xlsx'); fd.append('selected_sheets', '["SheetB"]'); fd.append('company_account', 'MG'); return fd; })() });
check('correcting reimport succeeds', sf.status === 200, String(sf.status));
const mFix = (await db.query(`SELECT current_job_title, consolidated_data FROM employees_master WHERE national_id='55555555555555'`)).rows[0];
check('correction: agreement restores scalar', mFix.current_job_title === 'محاسب', String(mFix.current_job_title));
check('correction: conflict cleared on convergence', !((mFix?.consolidated_data || {}).field_conflicts || {})['الوظيفه'], JSON.stringify((mFix?.consolidated_data || {}).field_conflicts || null));
// source identity across sheet-name FORMATTING differences ('Sheet 1' vs 'Sheet1'
// normalize to the same registered sheet) — no duplicate source fabricated
const mkXlsxSp = (rows) => { const ws = XLSX.utils.json_to_sheet(rows); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Sheet 1'); return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })); };
const smartSp = mkXlsxSp([{ 'الرقم القومي': '55555555555555', 'الاسم': 'موظف خانات', 'الكود': '5005', 'الوظيفه': 'محاسب', 'الراتب': 9000 }]);
const ssp = await api('/api/smart-import/execute', { method: 'POST', body: (() => { const fd = new FormData(); fd.append('file', new Blob([smartSp]), 't5.xlsx'); fd.append('selected_sheets', '["Sheet 1"]'); fd.append('company_account', 'MG'); return fd; })() });
check('import with spaced sheet name succeeds', ssp.status === 200, String(ssp.status));
const sheetAfterSp = (await db.query(`SELECT id FROM dynamic_sheets WHERE sheet_name='Sheet1'`)).rows[0];
const sheetSpCount = (await db.query(`SELECT count(*)::int AS c FROM dynamic_sheets WHERE sheet_name ILIKE 'Sheet%1'`)).rows[0].c;
check('spaced sheet name maps to SAME source (no duplicate fabricated)', sheetAfterSp && sheetAfterSp.id === sheetAfter.id && sheetSpCount === 1, 'id=' + (sheetAfterSp||{}).id + ' count=' + sheetSpCount);
const mSp = (await db.query(`SELECT consolidated_data FROM employees_master WHERE national_id='55555555555555'`)).rows[0];
check('same-source correction via spaced name applied', String((mSp?.consolidated_data || {})['الراتب']) === '9000', JSON.stringify((mSp?.consolidated_data || {})['الراتب']));
// same-batch duplicate rows with DIFFERENT values: deterministic newest-row wins,
// but the import must WARN (never presented as silently verified)
const dupRows = mkXlsxB([{ 'الرقم القومي': '55555555555555', 'الاسم': 'موظف خانات', 'الكود': '5005', 'الوظيفه': 'محاسب' }, { 'الرقم القومي': '55555555555555', 'الاسم': 'موظف خانات', 'الكود': '5005', 'الوظيفه': 'محاسب أول' }]);
const dup = await api('/api/smart-import/execute', { method: 'POST', body: (() => { const fd = new FormData(); fd.append('file', new Blob([dupRows]), 't6.xlsx'); fd.append('selected_sheets', '["SheetB"]'); fd.append('company_account', 'MG'); return fd; })() });
const dupj = await dup.json().catch(() => ({}));
const dupWarnings = (dupj.detailed_results?.SheetB?.warnings) || [];
check('same-batch duplicate import succeeds', dup.status === 200, String(dup.status));
check('same-batch duplicate with different values raises a visible warning', dupWarnings.length >= 1 && dupWarnings[0].includes('مكرر'), JSON.stringify(dupWarnings).slice(0, 140));
// Regression: duplicate warning must also fire on the FIRST import of a
// brand-new employee (seenInFile previously only tracked existing employees).
const dupNewRows = mkXlsx([{ 'الرقم القومي': '88888888888888', 'الاسم': 'موظف مكرر جديد', 'الكود': '8008', 'الوظيفه': 'محاسب' }, { 'الرقم القومي': '88888888888888', 'الاسم': 'موظف مكرر جديد', 'الكود': '8008', 'الوظيفه': 'محاسب أول' }]);
const dupNew = await api('/api/smart-import/execute', { method: 'POST', body: (() => { const fd = new FormData(); fd.append('file', new Blob([dupNewRows]), 't7.xlsx'); fd.append('selected_sheets', '["Sheet1"]'); fd.append('company_account', 'EG'); return fd; })() });
const dupNewj = await dupNew.json().catch(() => ({}));
const dupNewWarnings = (dupNewj.detailed_results?.Sheet1?.warnings) || [];
check('first-import duplicate (new employee) also warns', dupNew.status === 200 && dupNewWarnings.length >= 1 && dupNewWarnings[0].includes('مكرر'), String(dupNew.status) + ' ' + JSON.stringify(dupNewWarnings).slice(0, 140));
// official-print audit regression (executable, actual service via real route):
// (a) conflict-withheld master hire_date must NOT fall back to a single source;
// (b) an explicit-0-salary payroll record counts as PRESENT (not absent)
await db.query(`INSERT INTO employees_master (company_account, account_id, national_id, employee_code, employee_name, current_status, hire_date, consolidated_data) VALUES ('m.g', 2, '77777777777777', '7007', 'موظف تدقيق', 'Active', NULL, '{"field_conflicts":{"hire_date":[{"source":"Sheet1","value":"2020-01-01","at":"2026-11-01T00:00:00Z"},{"source":"SheetB","value":"2021-01-01","at":"2026-11-02T00:00:00Z"}]}}')`);
await db.query(`INSERT INTO incoming_insurance_records (employee_code, employee_name, national_id, company_account, status, raw_data) VALUES ('7007', 'موظف تدقيق', '77777777777777', 'm.g', 'Active', '{"تاريخ استلام العمل":"2020-05-01"}')`);
await db.query(`INSERT INTO import_logs (source_type, file_name, period_year, period_month, account_id) VALUES ('monthly_payroll', 'audit-fixture.xlsx', 2026, 10, 2)`);
const mgLog = (await db.query(`SELECT id FROM import_logs WHERE file_name='audit-fixture.xlsx'`)).rows[0].id;
await db.query(`INSERT INTO monthly_payroll_records (import_id, period_year, period_month, national_id, employee_code, employee_name, account_id, raw_data) VALUES ($1, 2026, 10, '77777777777777', '7007', 'موظف تدقيق', 2, '{"الراتب":"0"}')`, [mgLog]);
const audit = await (await api('/api/official-print-audit?action=summary&account=ALL')).json();
const auditRec = (audit.records || audit.sampleRecords || []).find((r) => r.nationalId === '77777777777777' || r.nid === '77777777777777' || (r.identifiers || {}).national_id === '77777777777777');
check('official-print audit returns the fixture employee', !!auditRec, JSON.stringify(Object.keys(audit)).slice(0, 120));
if (auditRec) {
  check('withheld hire date: NO silent single-source fallback', String(auditRec.hireDate).includes('يحتاج مراجعة'), String(auditRec.hireDate));
  check('explicit-0 payroll record counts as present', auditRec.foundInPayroll === true, JSON.stringify(auditRec.foundInPayroll));
}

// ── Per-worksheet snapshot reimport semantics (user-approved 12:05) ─────────
// A re-upload of the SAME worksheet is a new snapshot of that source: rows
// absent from it lose THAT worksheet's contribution only; the employee and
// other worksheets' contributions are retained; absent whole worksheets are
// untouched; blank cells still never erase.
const mkXlsxMulti = (sheets) => { const wb = XLSX.utils.book_new(); for (const [nm, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), nm); return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })); };
const postSmart = (buf, sheets) => api('/api/smart-import/execute', { method: 'POST', body: (() => { const fd = new FormData(); fd.append('file', new Blob([buf]), 'snap.xlsx'); fd.append('selected_sheets', JSON.stringify(sheets)); fd.append('company_account', 'MG'); return fd; })() });

// SNAP1 (99999999999991): SheetC (title+salary) + SheetD (title+region), agreeing title
const snap1 = mkXlsxMulti({
  SheetC: [{ 'الرقم القومي': '99999999999991', 'الاسم': 'موظف لقطة أول', 'الكود': '9001', 'الوظيفه': 'محاسب', 'الراتب': 5000 }],
  SheetD: [{ 'الرقم القومي': '99999999999991', 'الاسم': 'موظف لقطة أول', 'الكود': '9001', 'الوظيفه': 'محاسب', 'المنطقه': 'القاهرة' }],
});
const snap1res = await postSmart(snap1, ['SheetC', 'SheetD']);
check('snapshot fixture: multi-worksheet import succeeds', snap1res.status === 200, String(snap1res.status));
const snapId = (await db.query(`SELECT id FROM employees_master WHERE national_id='99999999999991' AND account_id=2`)).rows[0].id;
// Reimport SheetC ONLY, SNAP1 absent (a different employee row keeps it non-empty)
const snap1b = mkXlsxMulti({ SheetC: [{ 'الرقم القومي': '99999999999992', 'الاسم': 'موظف لقطة بديل', 'الكود': '9002', 'الوظيفه': 'سائق', 'الراتب': 3000 }] });
const snap1bres = await postSmart(snap1b, ['SheetC']);
check('snapshot reimport (employee absent) succeeds', snap1bres.status === 200, String(snap1bres.status));
const sn1 = (await db.query(`SELECT current_job_title, current_region, consolidated_data FROM employees_master WHERE id=$1`, [snapId])).rows[0];
check('snapshot: removed-worksheet-only key (الراتب) gone from blob', sn1.consolidated_data['الراتب'] === undefined, JSON.stringify(Object.keys(sn1.consolidated_data)));
check('snapshot: other-worksheet contribution (المنطقه) retained', String(sn1.consolidated_data['المنطقه']) === 'القاهرة');
check('snapshot: scalar kept from surviving worksheet', sn1.current_job_title === 'محاسب', String(sn1.current_job_title));
const sn1alive = (await db.query(`SELECT count(*)::int c FROM employees_master WHERE id=$1`, [snapId])).rows[0].c;
check('snapshot: employee NOT deleted when absent from one worksheet', sn1alive === 1);

// SNAP2 (99999999999993): SheetE vs SheetF conflicting titles; remove SheetE row
const snap2 = mkXlsxMulti({
  SheetE: [{ 'الرقم القومي': '99999999999993', 'الاسم': 'موظف لقطة ثان', 'الكود': '9003', 'الوظيفه': 'مشرف' }],
  SheetF: [{ 'الرقم القومي': '99999999999993', 'الاسم': 'موظف لقطة ثان', 'الكود': '9003', 'الوظيفه': 'محاسب' }],
});
await postSmart(snap2, ['SheetE', 'SheetF']);
const snap2Id = (await db.query(`SELECT id FROM employees_master WHERE national_id='99999999999993' AND account_id=2`)).rows[0].id;
const sn2pre = (await db.query(`SELECT current_job_title, consolidated_data FROM employees_master WHERE id=$1`, [snap2Id])).rows[0];
check('snapshot conflict fixture: title withheld before removal', sn2pre.current_job_title === null && !!((sn2pre.consolidated_data.field_conflicts || {})['الوظيفه']));
const snap2b = mkXlsxMulti({ SheetE: [{ 'الرقم القومي': '99999999999996', 'الاسم': 'موظف لقطة بديل ثان', 'الكود': '9006', 'الوظيفه': 'فني' }] });
await postSmart(snap2b, ['SheetE']);
const sn2 = (await db.query(`SELECT current_job_title, consolidated_data FROM employees_master WHERE id=$1`, [snap2Id])).rows[0];
check('snapshot: formerly-conflicting source removed -> resolves from survivor', sn2.current_job_title === 'محاسب', String(sn2.current_job_title));
check('snapshot: conflict cleared after survivor resolution', !(sn2.consolidated_data.field_conflicts || {})['الوظيفه']);

// SNAP3 (99999999999994): only in SheetG; removed from it. Last source absence.
const snap3 = mkXlsxMulti({ SheetG: [{ 'الرقم القومي': '99999999999994', 'الاسم': 'موظف لقطة ثالث', 'الكود': '9004', 'الوظيفه': 'عامل', 'الحاله': 'Active' }] });
await postSmart(snap3, ['SheetG']);
const snap3Id = (await db.query(`SELECT id FROM employees_master WHERE national_id='99999999999994' AND account_id=2`)).rows[0].id;
const snap3b = mkXlsxMulti({ SheetG: [{ 'الرقم القومي': '99999999999995', 'الاسم': 'موظف لقطة بديل ثالث', 'الكود': '9005', 'الوظيفه': 'حارس' }] });
await postSmart(snap3b, ['SheetG']);
const sn3 = (await db.query(`SELECT current_job_title, current_status, national_id, consolidated_data FROM employees_master WHERE id=$1`, [snap3Id])).rows[0];
check('last source absent: scalar NULL, not resurrected', sn3.current_job_title === null, String(sn3.current_job_title));
check('last source absent: status NULL, never guessed termination', sn3.current_status === null, String(sn3.current_status));
check('last source absent: identity retained, blob sheet keys removed', sn3.national_id === '99999999999994' && sn3.consolidated_data['الوظيفه'] === undefined);

// ── Fail-closed snapshot guards (no destructive prune on partial failure) ──
// Header-only reimport of SheetH: must NOT prune SNAP4's previous snapshot.
const snap4 = mkXlsxMulti({ SheetH: [{ 'الرقم القومي': '99999999999997', 'الاسم': 'موظف لقطة رابع', 'الكود': '9007', 'الوظيفه': 'محاسب' }] });
await postSmart(snap4, ['SheetH']);
const snap4Id = (await db.query(`SELECT id FROM employees_master WHERE national_id='99999999999997' AND account_id=2`)).rows[0].id;
const headerOnly = mkXlsxMulti({ SheetH: [] });
const hoRes = await postSmart(headerOnly, ['SheetH']);
const hoj = await hoRes.json().catch(() => ({}));
const hoWarns = (hoj.detailed_results?.SheetH?.warnings) || [];
const snap4after = (await db.query(`SELECT current_job_title, consolidated_data FROM employees_master WHERE id=$1`, [snap4Id])).rows[0];
const sheetHlatest = (await db.query(`SELECT count(*)::int c FROM sheet_data sd JOIN dynamic_sheets ds ON ds.id=sd.sheet_id WHERE ds.sheet_name='SheetH' AND sd.employee_id=$1 AND sd.is_latest=true`, [snap4Id])).rows[0].c;
check('header-only reimport cannot mass-remove: previous snapshot kept', sheetHlatest === 1 && snap4after.current_job_title === 'محاسب' && snap4after.consolidated_data['الوظيفه'] === 'محاسب', 'latest=' + sheetHlatest + ' title=' + String(snap4after.current_job_title));
check('header-only reimport surfaces a visible not-a-delete-snapshot warning', hoWarns.some((w) => w.includes('بدون صفوف بيانات')), JSON.stringify(hoWarns).slice(0, 160));

// Unparseable file: import fails, prior snapshot intact
const corrupt = Buffer.from('this is not an xlsx file at all');
const corruptRes = await postSmart(corrupt, ['SheetH']);
const snap4after2 = (await db.query(`SELECT current_job_title FROM employees_master WHERE id=$1`, [snap4Id])).rows[0];
check('unparseable file cannot mass-remove: snapshot intact', corruptRes.status !== 200 && sheetHlatest === 1 && snap4after2.current_job_title === 'محاسب', 'status=' + String(corruptRes.status));

// Benign trailing empty rows do NOT block the prune (normal Excel files)
const snap5a = mkXlsxMulti({ SheetI: [{ 'الرقم القومي': '99999999999998', 'الاسم': 'موظف لقطة خامس', 'الكود': '9008', 'الوظيفه': 'فني' }, { 'الرقم القومي': '99999999999999', 'الاسم': 'موظف لقطة سادس', 'الكود': '9009', 'الوظيفه': 'حارس' }] });
await postSmart(snap5a, ['SheetI']);
const snap5b = mkXlsxMulti({ SheetI: [{ 'الرقم القومي': '99999999999998', 'الاسم': 'موظف لقطة خامس', 'الكود': '9008', 'الوظيفه': 'فني' }, {}, {}] });
const s5b = await postSmart(snap5b, ['SheetI']);
const snap6row = (await db.query(`SELECT count(*)::int c FROM sheet_data sd JOIN dynamic_sheets ds ON ds.id=sd.sheet_id JOIN employees_master em ON em.id=sd.employee_id WHERE ds.sheet_name='SheetI' AND em.national_id='99999999999999' AND sd.is_latest=true`)).rows[0].c;
check('valid rows + benign empty rows: prune still works', s5b.status === 200 && snap6row === 0, 'status=' + String(s5b.status) + ' latest=' + snap6row);

// ── Partial-failure prune protection (real route-level failures) ────────────
// A) valid row + identity-less DATA row: identity failure blocks the prune.
const snap7a = mkXlsxMulti({ SheetJ: [{ 'الرقم القومي': '99999999999987', 'الاسم': 'موظف لقطة سابع', 'الكود': '9010', 'الوظيفه': 'محاسب' }] });
await postSmart(snap7a, ['SheetJ']);
const snap7Id = (await db.query(`SELECT id FROM employees_master WHERE national_id='99999999999987' AND account_id=2`)).rows[0].id;
const snap7b = mkXlsxMulti({ SheetJ: [
  { 'الرقم القومي': '99999999999986', 'الاسم': 'موظف لقطة ثامن', 'الكود': '9011', 'الوظيفه': 'سائق', 'الراتب': 3000 },
  { 'الراتب': 4000 },
] });
const s7b = await postSmart(snap7b, ['SheetJ']);
const s7bj = await s7b.json().catch(() => ({}));
const s7Latest = (await db.query(`SELECT count(*)::int c FROM sheet_data sd JOIN dynamic_sheets ds ON ds.id=sd.sheet_id WHERE ds.sheet_name='SheetJ' AND sd.employee_id=$1 AND sd.is_latest=true`, [snap7Id])).rows[0].c;
check('identity-less DATA row: import reports the failure', s7b.status === 200 && (s7bj.detailed_results?.SheetJ?.errors || []).some((e) => e.includes('بدون كود')), JSON.stringify(s7bj.detailed_results?.SheetJ?.errors || s7bj.error || null).slice(0, 140));
check('identity-less DATA row: NO prune of the absent employee (fail closed)', s7Latest === 1, 'latest=' + s7Latest);
const partialApplied = (await db.query(`SELECT count(*)::int c FROM employees_master WHERE national_id='99999999999986' AND account_id=2`)).rows[0].c;
check('partial application is visible: valid row WAS written (no rollback), failure listed', partialApplied === 1 && (s7bj.detailed_results?.SheetJ?.errors || []).length >= 1);

// B) Simulated bridge failure (test-only CHECK constraint): prune blocked,
// old latest rows retained, partial writes remain visible.
const snap8a = mkXlsxMulti({ 'مرتبات تجريبية': [{ 'الرقم القومي': '99999999999988', 'الاسم': 'موظف مرتبات قديم', 'الكود': '9012', 'الوظيفه': 'عامل', 'شهر 10': 30 }] });
await postSmart(snap8a, ['مرتبات تجريبية']);
const snap8Id = (await db.query(`SELECT id FROM employees_master WHERE national_id='99999999999988' AND account_id=2`)).rows[0].id;
await db.query(`ALTER TABLE monthly_payroll_records ADD CONSTRAINT test_block_nid CHECK (national_id <> '99999999999990')`);
const snap8b = mkXlsxMulti({ 'مرتبات تجريبية': [
  { 'الرقم القومي': '99999999999989', 'الاسم': 'موظف مرتبات جديد', 'الكود': '9013', 'الوظيفه': 'فني', 'شهر 10': 30 },
  { 'الرقم القومي': '99999999999990', 'الاسم': 'موظف مرتبات فاشل', 'الكود': '9014', 'الوظيفه': 'حارس', 'شهر 10': 30 },
] });
const s8b = await postSmart(snap8b, ['مرتبات تجريبية']);
const s8bj = await s8b.json().catch(() => ({}));
await db.query(`ALTER TABLE monthly_payroll_records DROP CONSTRAINT test_block_nid`);
const s8Latest = (await db.query(`SELECT count(*)::int c FROM sheet_data sd JOIN dynamic_sheets ds ON ds.id=sd.sheet_id WHERE ds.sheet_name='مرتبات تجريبية' AND sd.employee_id=$1 AND sd.is_latest=true`, [snap8Id])).rows[0].c;
check('bridge failure: import reports failure (not silent success)', (s8bj.detailed_results?.['مرتبات تجريبية']?.errors || []).length >= 1 || s8bj.success === false, JSON.stringify(s8bj.detailed_results?.['مرتبات تجريبية']?.errors || s8bj.error || null).slice(0, 160));
check('bridge failure: NO prune of the absent employee (fail closed)', s8Latest === 1, 'latest=' + s8Latest);
check('bridge failure: failure visible as error text mentioning bridge/payroll', JSON.stringify(s8bj).includes('مرتبات') || JSON.stringify(s8bj).includes('payroll') || JSON.stringify(s8bj).includes('Bridge'), JSON.stringify(s8bj).slice(0, 140));

// Unseen worksheet untouched: SNAP1's SheetD rows still latest after all SheetC/E/G reimports
const sheetDlatest = (await db.query(`SELECT count(*)::int c FROM sheet_data sd JOIN dynamic_sheets ds ON ds.id=sd.sheet_id WHERE ds.sheet_name='SheetD' AND sd.employee_id=$1 AND sd.is_latest=true`, [snapId])).rows[0].c;
check("unseen worksheet untouched by other worksheets reimports", sheetDlatest === 1);

const si = await api('/api/smart-import/execute', { method: 'POST', body: (() => { const fd = new FormData(); fd.append('file', new Blob([buf1]), 't.xlsx'); fd.append('selected_sheets', '["Sheet1"]'); return fd; })() });
check('smart-import execute w/o account → 400 (no bypass)', si.status === 400, String(si.status));
const siBad = await api('/api/smart-import/execute', { method: 'POST', body: (() => { const fd = new FormData(); fd.append('file', new Blob([buf1]), 't.xlsx'); fd.append('selected_sheets', '["Sheet1"]'); fd.append('company_account', 'NOPE'); return fd; })() });
check('smart-import execute unknown account → 400', siBad.status === 400, String(siBad.status));
const pv = await api('/api/smart-import/preview', { method: 'POST', body: (() => { const fd = new FormData(); fd.append('file', new Blob([buf1]), 't.xlsx'); fd.append('company_account', 'EG'); return fd; })() });
check('smart-import preview accepts valid account (same source as execute)', pv.status !== 400, String(pv.status));

const qAll = await (await api('/api/dynamic-reports/query', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json();
check('reports query default = ALL accounts (no EG default)', qAll.success && qAll.total_count === 20 && qAll.query_info.company_account === 'ALL', 'count=' + qAll.total_count); // 12 prior + snap4 99999999999997 + snap5/6 99999999999998/99 (99999999999996 was created in SheetE reimport; counted)
const qEg = await (await api('/api/dynamic-reports/query', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"company_account":"E.G"}' })).json();
check('reports query explicit E.G scopes correctly', qEg.success && qEg.total_count === 2 && (qEg.data || []).every((r) => ['11111111111111','88888888888888'].includes(r.national_id)), 'count=' + qEg.total_count); // +1: first-import dup fixture 88888888888888 (EG)

// Convergence clearing: correct the master record upstream (both fields a
// real correction would touch) -> conflict must clear on next read, monthly
// evidence returns scoped to the corrected account. No stored conflict state.
await db.query(`UPDATE employees_master SET company_account='M.G', account_id=2 WHERE national_id='11111111111111'`);
// ...and a corrected reimport lands: fresh November payroll stamped MG
// (October MG rows were replaced by the overwrite test above, so November
// is clean ground for this assertion).
const mgNov = (await db.query(`INSERT INTO import_logs (source_type, file_name, period_year, period_month, account_id) VALUES ('monthly_payroll', 'MODERN NOV corrected.xlsx', 2026, 11, 2) RETURNING id`)).rows[0].id;
await db.query(`INSERT INTO monthly_payroll_records (import_id, period_year, period_month, national_id, employee_code, employee_name, account_id) VALUES ($1, 2026, 11, '11111111111111', '1001', 'موظف تعارض', 2)`, [mgNov]);
const d1b = await (await api('/api/lookup/details?national_id=11111111111111')).json();
check('after upstream correction: conflict cleared, account resolved MG', d1b.details?.accountDisplay?.status === 'resolved' && d1b.details?.accountDisplay?.code === 'MG', JSON.stringify(d1b.details?.accountDisplay || null));
check('after upstream correction: monthly returned scoped to MG only', monthsWith(d1b).length === 1 && monthsWith(d1b)[0].payrollRecord.account_id === 2, 'months=' + monthsWith(d1b).length);
check('after upstream correction: latest_evidence shown', d1b.details?.latest_evidence?.payroll?.month === 11 && d1b.details?.latest_evidence?.payroll?.year === 2026 && d1b.details?.latest_evidence?.payroll?.accountCode === 'MG', JSON.stringify(d1b.details?.latest_evidence || null));
check('after upstream correction: S6 computable again (not insufficient)', d1b.details?.s6_calculation?.status !== 'insufficient_data', d1b.details?.s6_calculation?.status || 'NONE');

console.log(failures === 0 ? 'ALL E2E API ASSERTIONS PASSED' : failures + ' FAILURES');
dev.kill(); pr.kill(); await db.end(); await ep.stop();
process.exit(failures === 0 ? 0 : 1);
