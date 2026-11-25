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

const d2 = await (await api('/api/lookup/details?national_id=22222222222222')).json();
check('agreeing NID: scoped payroll returned', monthsWith(d2).length === 1 && monthsWith(d2)[0].payrollRecord.account_id === 2, 'months=' + monthsWith(d2).length + ' err=' + (d2.error || ''));

const d3 = await (await api('/api/lookup/details?national_id=33333333333333')).json();
check('payroll-only NID: single-account rows scoped+returned', monthsWith(d3).length === 1 && monthsWith(d3)[0].payrollRecord.account_id === 2, 'months=' + monthsWith(d3).length + ' err=' + (d3.error || ''));
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

const si = await api('/api/smart-import/execute', { method: 'POST', body: (() => { const fd = new FormData(); fd.append('file', new Blob([buf1]), 't.xlsx'); fd.append('selected_sheets', '["Sheet1"]'); return fd; })() });
check('smart-import execute w/o account → 400 (no bypass)', si.status === 400, String(si.status));
const siBad = await api('/api/smart-import/execute', { method: 'POST', body: (() => { const fd = new FormData(); fd.append('file', new Blob([buf1]), 't.xlsx'); fd.append('selected_sheets', '["Sheet1"]'); fd.append('company_account', 'NOPE'); return fd; })() });
check('smart-import execute unknown account → 400', siBad.status === 400, String(siBad.status));
const pv = await api('/api/smart-import/preview', { method: 'POST', body: (() => { const fd = new FormData(); fd.append('file', new Blob([buf1]), 't.xlsx'); fd.append('company_account', 'EG'); return fd; })() });
check('smart-import preview accepts valid account (same source as execute)', pv.status !== 400, String(pv.status));

console.log(failures === 0 ? 'ALL E2E API ASSERTIONS PASSED' : failures + ' FAILURES');
dev.kill(); pr.kill(); await db.end(); await ep.stop();
process.exit(failures === 0 ? 0 : 1);
