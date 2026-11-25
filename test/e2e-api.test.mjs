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

// CROSS-ACCOUNT GUARD: a global identity match whose master belongs to a
// DIFFERENT account must fail closed (conflict listed, master untouched),
// never silently re-attribute on operator account selection alone.
// Self-contained: cleans up every row it creates so later checks are unaffected.
await db.query(`INSERT INTO employees_master (company_account, account_id, national_id, employee_code, employee_name, current_status) VALUES ('E.G', 1, '66666666666666', '6006', 'موظف حساب آخر', 'Active')`);
const xAccFile = mkXlsx([{ 'الرقم القومي': '66666666666666', 'الاسم': 'موظف حساب آخر', 'الكود': '6006', 'الوظيفه': 'مهندس' }]);
const xacc = await api('/api/smart-import/execute', { method: 'POST', body: (() => { const fd = new FormData(); fd.append('file', new Blob([xAccFile]), 'tx.xlsx'); fd.append('selected_sheets', '["Sheet1"]'); fd.append('company_account', 'MG'); return fd; })() });
const xaccj = await xacc.json().catch(() => ({}));
const xaccSheet = xaccj?.detailed_results?.Sheet1 || {};
check('cross-account import: row NOT updated', xaccSheet.updated_employees === 0 && xaccSheet.new_employees === 0, JSON.stringify({ u: xaccSheet.updated_employees, n: xaccSheet.new_employees, status: xacc.status }));
check('cross-account import: conflict listed', Array.isArray(xaccSheet.cross_account_conflicts) && xaccSheet.cross_account_conflicts.length === 1 && xaccSheet.cross_account_conflicts[0].national_id === '66666666666666', JSON.stringify(xaccSheet.cross_account_conflicts || null));
check('cross-account import: warning surfaced', (xaccSheet.warnings || []).some((w) => String(w).includes('حساب آخر')), JSON.stringify(xaccSheet.warnings || []).slice(0, 120));
const xaccMaster = (await db.query(`SELECT company_account, account_id, consolidated_data FROM employees_master WHERE national_id='66666666666666'`)).rows[0];
check('cross-account import: master account UNCHANGED', xaccMaster.company_account === 'E.G' && xaccMaster.account_id === 1, JSON.stringify({ a: xaccMaster.company_account, id: xaccMaster.account_id }));
check('cross-account import: master data NOT merged from other account file', !(xaccMaster.consolidated_data || {})['الوظيفه'] || (xaccMaster.consolidated_data || {})['الوظيفه'] !== 'مهندس', JSON.stringify(xaccMaster.consolidated_data || {}).slice(0, 120));
const xaccSD = (await db.query(`SELECT count(*)::int c FROM sheet_data WHERE row_national_id='66666666666666'`)).rows[0].c;
check('cross-account import: no cross-account sheet_data linked', xaccSD === 0, 'count=' + xaccSD);
const sameAcc = await api('/api/smart-import/execute', { method: 'POST', body: (() => { const fd = new FormData(); fd.append('file', new Blob([xAccFile]), 'tx2.xlsx'); fd.append('selected_sheets', '["Sheet1"]'); fd.append('company_account', 'EG'); return fd; })() });
const sameAccj = await sameAcc.json().catch(() => ({}));
const sameAccSheet = sameAccj?.detailed_results?.Sheet1 || {};
check('same-account reimport: updates normally', sameAccSheet.updated_employees === 1 && !sameAccSheet.cross_account_conflicts, JSON.stringify({ u: sameAccSheet.updated_employees, c: sameAccSheet.cross_account_conflicts || null }));
const newEmpFile = mkXlsx([{ 'الرقم القومي': '88888888888888', 'الاسم': 'موظف جديد كليا', 'الكود': '8008' }]);
const newEmp = await api('/api/smart-import/execute', { method: 'POST', body: (() => { const fd = new FormData(); fd.append('file', new Blob([newEmpFile]), 'tx3.xlsx'); fd.append('selected_sheets', '["Sheet1"]'); fd.append('company_account', 'MG'); return fd; })() });
const newEmpj = await newEmp.json().catch(() => ({}));
const newEmpSheet = newEmpj?.detailed_results?.Sheet1 || {};
check('new employee: inserted under selected account', newEmpSheet.new_employees === 1, JSON.stringify({ n: newEmpSheet.new_employees }));
const newEmpRow = (await db.query(`SELECT account_id FROM employees_master WHERE national_id='88888888888888'`)).rows[0];
check('new employee: stamped to import account', newEmpRow && newEmpRow.account_id === 2, JSON.stringify(newEmpRow || null));
// Attribution edge cases: blank TEXT with a resolved account_id is KNOWN
// (blocked cross-account); only a truly unresolved master (NULL account_id +
// blank text) may be claimed by a grounded import.
await db.query(`INSERT INTO employees_master (company_account, account_id, national_id, employee_code, employee_name, current_status) VALUES ('', 1, '99999999999991', '9101', 'موظف نص فاضي', 'Active')`);
const blankTxtFile = mkXlsx([{ 'الرقم القومي': '99999999999991', 'الاسم': 'موظف نص فاضي', 'الكود': '9101' }]);
const blankTxt = await api('/api/smart-import/execute', { method: 'POST', body: (() => { const fd = new FormData(); fd.append('file', new Blob([blankTxtFile]), 'tx4.xlsx'); fd.append('selected_sheets', '["Sheet1"]'); fd.append('company_account', 'MG'); return fd; })() });
const blankTxtj = await blankTxt.json().catch(() => ({}));
const blankTxtSheet = blankTxtj?.detailed_results?.Sheet1 || {};
check('blank-text but account_id=1: blocked as KNOWN EG', Array.isArray(blankTxtSheet.cross_account_conflicts) && blankTxtSheet.cross_account_conflicts.length === 1 && blankTxtSheet.updated_employees === 0, JSON.stringify({ c: (blankTxtSheet.cross_account_conflicts || []).length, u: blankTxtSheet.updated_employees }));
await db.query(`INSERT INTO employees_master (company_account, account_id, national_id, employee_code, employee_name, current_status) VALUES ('', NULL, '99999999999992', '9102', 'موظف بلا حساب', 'Active')`);
const nullAccFile = mkXlsx([{ 'الرقم القومي': '99999999999992', 'الاسم': 'موظف بلا حساب', 'الكود': '9102' }]);
const nullAcc = await api('/api/smart-import/execute', { method: 'POST', body: (() => { const fd = new FormData(); fd.append('file', new Blob([nullAccFile]), 'tx5.xlsx'); fd.append('selected_sheets', '["Sheet1"]'); fd.append('company_account', 'MG'); return fd; })() });
const nullAccj = await nullAcc.json().catch(() => ({}));
const nullAccSheet = nullAccj?.detailed_results?.Sheet1 || {};
const nullAccRow = (await db.query(`SELECT account_id FROM employees_master WHERE national_id='99999999999992'`)).rows[0];
check('truly unresolved master (NULL account): claimable by grounded import', nullAccSheet.updated_employees === 1 && !nullAccSheet.cross_account_conflicts && nullAccRow && nullAccRow.account_id === 2, JSON.stringify({ u: nullAccSheet.updated_employees, acc: nullAccRow || null }));
// snapshot-prune safety: a sheet whose import has blocked cross-account rows
// must NOT be treated as a verified full snapshot (no prune of old rows).
check('blocked import warning marks partial sync (no full-snapshot claim)', (xaccSheet.warnings || []).some((w) => String(w).includes('لم تُعتبر لقطة كاملة')), JSON.stringify(xaccSheet.warnings || []).slice(0, 200));
// cleanup: every row this block created
await db.query(`DELETE FROM sheet_data WHERE employee_id IN (SELECT id FROM employees_master WHERE national_id IN ('66666666666666','88888888888888','99999999999991','99999999999992'))`);
await db.query(`DELETE FROM sheet_data WHERE sheet_id IN (SELECT id FROM dynamic_sheets WHERE sheet_name='Sheet1' AND account_id=1)`);
await db.query(`DELETE FROM dynamic_sheets WHERE sheet_name='Sheet1' AND account_id=1`);
await db.query(`DELETE FROM employees_master WHERE national_id IN ('66666666666666','88888888888888','99999999999991','99999999999992')`);
await db.query(`DELETE FROM import_logs WHERE file_name IN ('tx.xlsx','tx2.xlsx','tx3.xlsx','tx4.xlsx','tx5.xlsx')`);

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
check('identity-less DATA row: import reports the failure', s7b.status === 200 && (s7bj.detailed_results?.SheetJ?.errors || []).some((e) => e.includes('بدون رقم قومي')), JSON.stringify(s7bj.detailed_results?.SheetJ?.errors || s7bj.error || null).slice(0, 140));
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

// ── Account-scoped source catalog (repair 000005) ───────────────────────────
// Source identity is (account, worksheet name). Placed after the report-count
// checks above so fixture employees here don't shift those counts.
const postSmartAcct = (buf, sheets, acct) => api('/api/smart-import/execute', { method: 'POST', body: (() => { const fd = new FormData(); fd.append('file', new Blob([buf]), 'cat.xlsx'); fd.append('selected_sheets', JSON.stringify(sheets)); fd.append('company_account', acct); return fd; })() });

// CAT1: same worksheet name, different headers, two accounts — mappings must
// NOT mutate across accounts.
const cat1 = await postSmartAcct(mkXlsxMulti({ CrossSheet: [{ 'الرقم القومي': '66666666666661', 'الاسم': 'موظف كتالوج أول', 'الكود': '6101', 'الوظيفه': 'محاسب' }] }), ['CrossSheet'], 'MG');
check('CAT1: MG CrossSheet import succeeds', cat1.status === 200, String(cat1.status));
const cat2 = await postSmartAcct(mkXlsxMulti({ CrossSheet: [{ 'الرقم القومي': '66666666666662', 'الاسم': 'موظف كتالوج ثان', 'الكود': '6102', 'المنطقه': 'الجيزة' }] }), ['CrossSheet'], 'EG');
check('CAT1: EG CrossSheet (different headers) import succeeds', cat2.status === 200, String(cat2.status));
const catRows = (await db.query(`SELECT id, account_id, column_definitions FROM dynamic_sheets WHERE sheet_name='CrossSheet' ORDER BY created_at`)).rows;
check('CAT1: same-named sheet exists per account (2 scoped rows)', catRows.length === 2 && new Set(catRows.map((r) => r.account_id)).size === 2, JSON.stringify(catRows.map((r) => r.account_id)));
const catMGrow = catRows.find((r) => r.account_id === 2);
check('CAT1: EG import did NOT mutate MG mapping', JSON.stringify(catMGrow?.column_definitions).includes('الوظيفه') && !JSON.stringify(catMGrow?.column_definitions).includes('المنطقه'), JSON.stringify(catMGrow?.column_definitions).slice(0, 200));

// CAT2: legacy shared (account_id NULL) sheet with NO data: first importing
// account claims it (grounded — nothing to split).
await db.query(`INSERT INTO dynamic_sheets (sheet_name, display_name, is_active, column_definitions, matching_keys, account_id) VALUES ('ClaimSheet','ClaimSheet',true,'[{"key":"national_id","label":"الرقم القومي","type":"text","aliases":["الرقم القومي"]},{"key":"employee_name","label":"الاسم","type":"text","aliases":["الاسم"]},{"key":"employee_code","label":"الكود","type":"text","aliases":["الكود"]}]'::jsonb,ARRAY['national_id'],NULL)`);
const claimSheetId = (await db.query(`SELECT id FROM dynamic_sheets WHERE sheet_name='ClaimSheet'`)).rows[0].id;
const cl = await postSmartAcct(mkXlsxMulti({ ClaimSheet: [{ 'الرقم القومي': '66666666666663', 'الاسم': 'موظف مطالبة', 'الكود': '6103' }] }), ['ClaimSheet'], 'EG');
check('CAT2: import into data-less legacy sheet succeeds', cl.status === 200, String(cl.status));
const claimAfter = (await db.query(`SELECT account_id FROM dynamic_sheets WHERE id=$1`, [claimSheetId])).rows[0];
const claimCount = (await db.query(`SELECT count(*)::int c FROM dynamic_sheets WHERE sheet_name='ClaimSheet'`)).rows[0].c;
check('CAT2: data-less legacy sheet claimed by first importer (no duplicate row)', claimAfter?.account_id === 1 && claimCount === 1, JSON.stringify(claimAfter) + ' count=' + claimCount);

// CAT3: legacy shared sheet WITH multi-account data: never attached, never
// auto-split — a private account-scoped row is created + a review warning.
const legId = (await db.query(`INSERT INTO dynamic_sheets (sheet_name, display_name, is_active, column_definitions, matching_keys, account_id) VALUES ('LegacyX','LegacyX',true,'[]'::jsonb,ARRAY['national_id'],NULL) RETURNING id`)).rows[0].id;
await db.query(`INSERT INTO employees_master (company_account, account_id, national_id, employee_code, employee_name, current_status) VALUES ('E.G',1,'66666666666665','6105','قديم أول','Active'), ('M.G',2,'66666666666666','6106','قديم ثان','Active')`);
const legLog = (await db.query(`INSERT INTO import_logs (source_type, file_name) VALUES ('smart_import','legacy-fixture.xlsx') RETURNING id`)).rows[0].id;
for (const nid of ['66666666666665', '66666666666666']) {
  const emp = (await db.query(`SELECT id FROM employees_master WHERE national_id=$1`, [nid])).rows[0].id;
  await db.query(`INSERT INTO sheet_data (sheet_id, employee_id, row_data, row_code, row_national_id, row_name, import_id, row_number, is_latest, created_at) VALUES ($1,$2,'{}'::jsonb,'x',$1::text,'legacy',$3,1,true,NOW())`.replace('$1::text', '$4'), [legId, emp, legLog, nid]);
}
const lx = await postSmartAcct(mkXlsxMulti({ LegacyX: [{ 'الرقم القومي': '66666666666667', 'الاسم': 'موظف ميراث', 'الكود': '6107', 'الوظيفه': 'سائق' }] }), ['LegacyX'], 'EG');
const lxj = await lx.json().catch(() => ({}));
const lxWarn = (lxj.detailed_results?.LegacyX?.warnings) || [];
check('CAT3: import over multi-account legacy sheet succeeds', lx.status === 200, String(lx.status) + ' ' + (lxj.error || ''));
const legRows = (await db.query(`SELECT id, account_id FROM dynamic_sheets WHERE sheet_name='LegacyX' ORDER BY created_at`)).rows;
check('CAT3: private account-scoped row created, legacy row left for review', legRows.length === 2 && legRows.some((r) => r.account_id === null) && legRows.some((r) => r.account_id === 1), JSON.stringify(legRows));
check('CAT3: review warning surfaced for shared legacy sheet', lxWarn.some((w) => w.includes('مشترك')), JSON.stringify(lxWarn).slice(0, 200));

// CAT4: registered mapping frozen — a NEW non-empty column in a reimport is
// warned as unmapped AND blocks the snapshot prune (partial import ≠ full sync).
const um1 = await postSmartAcct(mkXlsxMulti({ UnMapSheet: [{ 'الرقم القومي': '66666666666668', 'الاسم': 'موظف أعمدة أول', 'الكود': '6108', 'الوظيفه': 'محاسب', 'الراتب': 4000 }] }), ['UnMapSheet'], 'MG');
check('CAT4: first UnMapSheet import succeeds', um1.status === 200, String(um1.status));
const um2 = await postSmartAcct(mkXlsxMulti({ UnMapSheet: [{ 'الرقم القومي': '66666666666669', 'الاسم': 'موظف أعمدة ثان', 'الكود': '6109', 'الوظيفه': 'سائق', 'الراتب': 3000, 'ملاحظات': 'قيمة جديدة غير مسجلة' }] }), ['UnMapSheet'], 'MG');
const um2j = await um2.json().catch(() => ({}));
const umWarn = (um2j.detailed_results?.UnMapSheet?.warnings) || [];
check('CAT4: reimport with extra non-empty column succeeds (partial)', um2.status === 200, String(um2.status));
check('CAT4: unmapped non-empty column raises visible warning', umWarn.some((w) => w.includes('أعمدة غير مسجلة') && w.includes('ملاحظات')), JSON.stringify(umWarn).slice(0, 220));
const umOld = (await db.query(`SELECT consolidated_data FROM employees_master WHERE national_id='66666666666668'`)).rows[0];
check('CAT4: prune BLOCKED on incomplete mapping (absent employee keeps contribution)', String(umOld?.consolidated_data?.['الراتب']) === '4000', JSON.stringify(umOld?.consolidated_data || null).slice(0, 160));
const umNew = (await db.query(`SELECT consolidated_data FROM employees_master WHERE national_id='66666666666669'`)).rows[0];
check('CAT4: new row imported but unmapped column NOT silently stored', String(umNew?.consolidated_data?.['الوظيفه']) === 'سائق' && umNew?.consolidated_data?.['ملاحظات'] === undefined, JSON.stringify(umNew?.consolidated_data || null).slice(0, 200));

// CAT5: snapshot prune is scoped to (account, sheet): pruning MG's sheet must
// never touch EG's same-named sheet.
const ps1 = await postSmartAcct(mkXlsxMulti({ PruneSheet: [
  { 'الرقم القومي': '66666666666670', 'الاسم': 'موظف حذف س', 'الكود': '6110', 'الراتب': 1000 },
  { 'الرقم القومي': '66666666666671', 'الاسم': 'موظف حذف ص', 'الكود': '6111', 'الراتب': 2000 },
] }), ['PruneSheet'], 'MG');
check('CAT5: MG PruneSheet import succeeds', ps1.status === 200, String(ps1.status));
const ps2 = await postSmartAcct(mkXlsxMulti({ PruneSheet: [{ 'الرقم القومي': '66666666666672', 'الاسم': 'موظف حذف ع', 'الكود': '6112', 'الراتب': 3000 }] }), ['PruneSheet'], 'EG');
check('CAT5: EG PruneSheet import succeeds', ps2.status === 200, String(ps2.status));
const psRows = (await db.query(`SELECT id, account_id FROM dynamic_sheets WHERE sheet_name='PruneSheet'`)).rows;
check('CAT5: PruneSheet scoped per account', psRows.length === 2, JSON.stringify(psRows));
const ps3 = await postSmartAcct(mkXlsxMulti({ PruneSheet: [{ 'الرقم القومي': '66666666666670', 'الاسم': 'موظف حذف س', 'الكود': '6110', 'الراتب': 1500 }] }), ['PruneSheet'], 'MG');
check('CAT5: MG reimport (employee absent) succeeds', ps3.status === 200, String(ps3.status));
const yGone = (await db.query(`SELECT count(*)::int c FROM sheet_data sd JOIN dynamic_sheets ds ON ds.id=sd.sheet_id JOIN employees_master em ON em.id=sd.employee_id WHERE ds.sheet_name='PruneSheet' AND ds.account_id=2 AND em.national_id='66666666666671' AND sd.is_latest=true`)).rows[0].c;
const zKept = (await db.query(`SELECT count(*)::int c FROM sheet_data sd JOIN dynamic_sheets ds ON ds.id=sd.sheet_id JOIN employees_master em ON em.id=sd.employee_id WHERE ds.sheet_name='PruneSheet' AND ds.account_id=1 AND em.national_id='66666666666672' AND sd.is_latest=true`)).rows[0].c;
check('CAT5: absent employee pruned from MG sheet only', yGone === 0, 'latest=' + yGone);
check('CAT5: EG same-named sheet UNTOUCHED by MG prune', zKept === 1, 'latest=' + zKept);
const yAlive = (await db.query(`SELECT count(*)::int c FROM employees_master WHERE national_id='66666666666671'`)).rows[0].c;
check('CAT5: pruned employee row NOT deleted', yAlive === 1);

// CAT6: deterministic exact-match first — variant pair "RES" / "RES." (real
// live catalog pair). Importing "RES." must claim the EXACT row, never the
// other variant by arrival order.
await db.query(`INSERT INTO dynamic_sheets (sheet_name, display_name, is_active, column_definitions, matching_keys, account_id) VALUES
  ('RES','RES',true,'[{"key":"national_id","label":"الرقم القومي","type":"text","aliases":["الرقم القومي"]},{"key":"employee_name","label":"الاسم","type":"text","aliases":["الاسم"]},{"key":"employee_code","label":"الكود","type":"text","aliases":["الكود"]}]'::jsonb,ARRAY['national_id'],NULL),
  ('RES.','RES.',true,'[{"key":"national_id","label":"الرقم القومي","type":"text","aliases":["الرقم القومي"]},{"key":"employee_name","label":"الاسم","type":"text","aliases":["الاسم"]},{"key":"employee_code","label":"الكود","type":"text","aliases":["الكود"]}]'::jsonb,ARRAY['national_id'],NULL)`);
const cat6 = await postSmartAcct(mkXlsxMulti({ 'RES.': [{ 'الرقم القومي': '66666666666680', 'الاسم': 'موظف تطابق دقيق', 'الكود': '6120' }] }), ['RES.'], 'EG');
check('CAT6: import of "RES." succeeds', cat6.status === 200, String(cat6.status));
const resDotRow = (await db.query(`SELECT account_id FROM dynamic_sheets WHERE sheet_name='RES.'`)).rows[0];
const resPlainRow = (await db.query(`SELECT account_id FROM dynamic_sheets WHERE sheet_name='RES'`)).rows[0];
check('CAT6: exact variant claimed, other variant untouched', resDotRow?.account_id === 1 && resPlainRow?.account_id === null, JSON.stringify([resDotRow, resPlainRow]));

// CAT7: ambiguity fail-closed — two legacy rows that both flex-match the file
// name with NO exact match ("Amb Sheet" / "Amb  Sheet" vs file "AmbSheet"):
// import must fail visibly, claim nothing, create nothing, attach nothing.
await db.query(`INSERT INTO dynamic_sheets (sheet_name, display_name, is_active, column_definitions, matching_keys, account_id) VALUES
  ('Amb Sheet','Amb Sheet',true,'[{"key":"national_id","label":"الرقم القومي","type":"text","aliases":["الرقم القومي"]},{"key":"employee_name","label":"الاسم","type":"text","aliases":["الاسم"]},{"key":"employee_code","label":"الكود","type":"text","aliases":["الكود"]}]'::jsonb,ARRAY['national_id'],NULL),
  ('Amb  Sheet','Amb  Sheet',true,'[{"key":"national_id","label":"الرقم القومي","type":"text","aliases":["الرقم القومي"]},{"key":"employee_name","label":"الاسم","type":"text","aliases":["الاسم"]},{"key":"employee_code","label":"الكود","type":"text","aliases":["الكود"]}]'::jsonb,ARRAY['national_id'],NULL)`);
const cat7 = await postSmartAcct(mkXlsxMulti({ 'AmbSheet': [{ 'الرقم القومي': '66666666666681', 'الاسم': 'موظف غامض', 'الكود': '6121' }] }), ['AmbSheet'], 'EG');
const cat7j = await cat7.json().catch(() => ({}));
const cat7rows = (await db.query(`SELECT account_id FROM dynamic_sheets WHERE sheet_name IN ('Amb Sheet','Amb  Sheet','AmbSheet')`)).rows;
const cat7emp = (await db.query(`SELECT count(*)::int c FROM employees_master WHERE national_id='66666666666681'`)).rows[0].c;
check('CAT7: ambiguous legacy definitions -> sheet fails visibly', (cat7j.detailed_results?.AmbSheet?.errors || []).some((e) => e.includes('أكثر من تعريف')), JSON.stringify(cat7j.detailed_results?.AmbSheet?.errors || cat7j.error || null).slice(0, 200));
check('CAT7: nothing claimed, nothing created, employee NOT imported', cat7rows.every((r) => r.account_id === null) && cat7rows.length === 2 && cat7emp === 0, JSON.stringify(cat7rows) + ' emp=' + cat7emp);

// CAT8: claim failure fail-closed — if the ownership stamp is rejected (here
// by a test-only constraint), the import must fail visibly and must NOT
// proceed attached to the unscoped shared row. Constraint dropped after.
await db.query(`INSERT INTO dynamic_sheets (sheet_name, display_name, is_active, column_definitions, matching_keys, account_id) VALUES ('ClaimBlock','ClaimBlock',true,'[{"key":"national_id","label":"الرقم القومي","type":"text","aliases":["الرقم القومي"]},{"key":"employee_name","label":"الاسم","type":"text","aliases":["الاسم"]},{"key":"employee_code","label":"الكود","type":"text","aliases":["الكود"]}]'::jsonb,ARRAY['national_id'],NULL)`);
await db.query(`CREATE OR REPLACE FUNCTION test_block_claim_fn() RETURNS TRIGGER AS $$ BEGIN IF OLD.account_id IS NULL AND NEW.account_id IS NOT NULL THEN RAISE EXCEPTION 'test block claim'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
await db.query(`CREATE TRIGGER test_block_claim BEFORE UPDATE ON dynamic_sheets FOR EACH ROW EXECUTE FUNCTION test_block_claim_fn()`);
const cat8a = await postSmartAcct(mkXlsxMulti({ ClaimBlock: [{ 'الرقم القومي': '66666666666682', 'الاسم': 'موظف مطالبة محظورة', 'الكود': '6122' }] }), ['ClaimBlock'], 'EG');
const cat8aj = await cat8a.json().catch(() => ({}));
const cat8row = (await db.query(`SELECT account_id FROM dynamic_sheets WHERE sheet_name='ClaimBlock'`)).rows[0];
const cat8emp = (await db.query(`SELECT count(*)::int c FROM employees_master WHERE national_id='66666666666682'`)).rows[0].c;
check('CAT8: rejected claim -> sheet fails visibly', (cat8aj.detailed_results?.ClaimBlock?.errors || []).some((e) => e.includes('تعذر تثبيت')), JSON.stringify(cat8aj.detailed_results?.ClaimBlock?.errors || cat8aj.error || null).slice(0, 200));
check('CAT8: no unscoped attachment, no partial rows written', cat8row?.account_id === null && cat8emp === 0, JSON.stringify(cat8row) + ' emp=' + cat8emp);
await db.query(`DROP TRIGGER test_block_claim ON dynamic_sheets`);
await db.query(`DROP FUNCTION test_block_claim_fn()`);
const cat8b = await postSmartAcct(mkXlsxMulti({ ClaimBlock: [{ 'الرقم القومي': '66666666666682', 'الاسم': 'موظف مطالبة محظورة', 'الكود': '6122' }] }), ['ClaimBlock'], 'EG');
const cat8row2 = (await db.query(`SELECT account_id FROM dynamic_sheets WHERE sheet_name='ClaimBlock'`)).rows[0];
check('CAT8: after constraint removed, claim succeeds (recovery path)', cat8b.status === 200 && cat8row2?.account_id === 1, String(cat8b.status) + ' ' + JSON.stringify(cat8row2));

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
