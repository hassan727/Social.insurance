// UI proof: reviewed transfer end-to-end in the running app.
// 1) smart-import surfaces a cross-account conflict with a "تسجيل نقل فعلي" action
// 2) the inline confirmation (effective date + reviewer) records the transfer
// 3) the employee profile history tab shows the transfer with effective date
//    and provenance, and the profile reflects the new current company
// Synthetic fixtures only; isolated stack (embedded PG + PostgREST + Next dev).
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { readFileSync, readdirSync, writeFileSync } from 'fs';
import { spawn } from 'child_process';
import http from 'http';
import crypto from 'crypto';
import * as XLSX from 'xlsx';
import { chromium } from 'playwright-core';

const MIG_DIR = new URL('../supabase/migrations/', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`); if (!cond) failures++; };

const ep = new EmbeddedPostgres({ databaseDir: '/tmp/pg-e2e', user: 'postgres', password: 'postgres', port: 5545, persistent: false });
await ep.initialise(); await ep.start(); await ep.createDatabase('e2e');
const db = new pg.Client({ host: '127.0.0.1', port: 5545, user: 'postgres', password: 'postgres', database: 'e2e' });
await db.connect();
await db.query(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN; CREATE ROLE authenticator NOINHERIT LOGIN PASSWORD 'authpw'; GRANT anon TO authenticator;`);
for (const f of readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql')).sort()) await db.query(readFileSync(MIG_DIR + f, 'utf8'));
await db.query(`GRANT USAGE ON SCHEMA public TO anon; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon; GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon; GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon;`);
await db.query(`INSERT INTO employees_master (company_account, account_id, national_id, employee_code, employee_name, current_status, current_job_title) VALUES
  ('E.G', 1, '88888888888881', '8101', 'موظف منقول تجريبي', 'Active', 'فني')`);
const empId = (await db.query(`SELECT id FROM employees_master WHERE national_id='88888888888881'`)).rows[0].id;

const ws = XLSX.utils.json_to_sheet([{ 'الرقم القومي': '88888888888881', 'الاسم': 'موظف منقول تجريبي', 'الكود': '8101', 'الوظيفه': 'فني أول' }]);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
writeFileSync('/tmp/mg-transfer-case.xlsx', XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));

const JWT_SECRET = 'e2e-test-only-secret-not-real-0123456789abcdef';
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const ANON_JWT = b64u({ alg: 'HS256', typ: 'JWT' }) + '.' + b64u({ role: 'anon' }) + '.' + crypto.createHmac('sha256', JWT_SECRET).update(b64u({ alg: 'HS256', typ: 'JWT' }) + '.' + b64u({ role: 'anon' })).digest('base64url');
writeFileSync('/tmp/postgrest.conf', `db-uri = "postgres://authenticator:authpw@127.0.0.1:5545/e2e"\ndb-schemas = "public"\ndb-anon-role = "anon"\nserver-port = 3001\njwt-secret = "${JWT_SECRET}"\n`);
const pr = spawn('/tmp/postgrest', ['/tmp/postgrest.conf'], { stdio: 'ignore' });
http.createServer((req, res) => {
  const u = req.url.replace(/^\/rest\/v1/, '');
  const p = http.request({ host: '127.0.0.1', port: 3001, path: u, method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  req.pipe(p); p.on('error', () => { res.statusCode = 502; res.end(); });
}).listen(3002);
await sleep(2000);
const dev = spawn('npm', ['run', 'dev', '--', '-p', '3100'], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:3002', NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_JWT, APP_JWT_SECRET: 'test-only-dummy-secret-32chars-minimum', PORT: '3100' }, stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { await fetch('http://localhost:3100/api/company-accounts'); break; } catch { await sleep(1500); } }
console.log('stack up');

// Login via API and carry the session cookie into the browser
const login = await fetch('http://localhost:3100/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin@insurance2026' }) });
const cookiePair = ((login.headers.getSetCookie ? login.headers.getSetCookie()[0] : login.headers.get('set-cookie')) || '').split(';')[0];
const [cookieName, cookieValue] = cookiePair.split('=');
check('login issued session cookie', !!cookieValue, '');

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addCookies([{ name: cookieName, value: cookieValue, domain: 'localhost', path: '/' }]);
const page = await context.newPage();
try {
  // 1) Import an MG file containing an EG employee -> reviewed conflict
  await page.goto('http://localhost:3100/smart-import', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(3500);
  await page.locator('button:has-text("مودرن")').first().click({ timeout: 20000 });
  await page.setInputFiles('#file-input', '/tmp/mg-transfer-case.xlsx');
  await sleep(800);
  await page.locator('button:has-text("تحليل الملف")').first().click({ timeout: 15000 });
  await page.waitForSelector('text=/استيراد \\d+ ورقة/', { timeout: 45000 });
  await page.locator('button:has-text("استيراد")').last().click({ timeout: 15000 });
  await page.waitForSelector('text=تعارض حسابات', { timeout: 60000 });
  await page.waitForSelector('button:has-text("تسجيل نقل فعلي")', { timeout: 15000 });
  await page.screenshot({ path: '/downloads/ui-transfer-1-conflict.png', fullPage: true });
  check('conflict row offers reviewed transfer action', true, '');

  // 2) Confirm the transfer inline with effective date + reviewer
  await page.locator('button:has-text("تسجيل نقل فعلي")').first().click();
  await page.locator('input[placeholder="من يؤكد النقل"]').fill('حسن (اختبار)');
  await page.screenshot({ path: '/downloads/ui-transfer-2-form.png', fullPage: true });
  await page.locator('button:has-text("تأكيد النقل")').first().click();
  await page.waitForSelector('text=/تم النقل|يسري في/', { timeout: 20000 });
  await page.screenshot({ path: '/downloads/ui-transfer-3-confirmed.png', fullPage: true });
  const mAfter = (await db.query(`SELECT company_account, account_employee_uid FROM employees_master WHERE id=$1`, [empId])).rows[0];
  check('UI confirmation moved the master', mAfter.company_account === 'M.G' || mAfter.company_account === 'm.g', JSON.stringify(mAfter));

  // 3) Profile: history tab shows the transfer with effective date + provenance
  await page.goto(`http://localhost:3100/employee/${empId}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(3000);
  await page.locator('button:has-text("سجل التغييرات")').first().click({ timeout: 20000 });
  await page.waitForSelector('text=نقل فعلي', { timeout: 20000 });
  const histText = await page.locator('main').innerText();
  check('history shows transfer label + effective date + confirmer', histText.includes('نقل فعلي') && histText.includes('فعّال من') && histText.includes('أكّده: حسن (اختبار)'), '');
  await page.screenshot({ path: '/downloads/ui-transfer-4-history.png', fullPage: true });
} catch (e) {
  failures++;
  await page.screenshot({ path: '/downloads/ui-transfer-FAIL.png', fullPage: true }).catch(() => {});
  console.log('FAIL driver:', String(e).split('\n')[0]);
}
await browser.close();
dev.kill(); pr.kill(); await db.end(); await ep.stop();
console.log(failures === 0 ? 'UI_TRANSFER_PASS' : 'UI_TRANSFER_FAIL');
process.exit(failures === 0 ? 0 : 1);
