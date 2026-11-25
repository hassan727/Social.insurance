// Runtime UI screenshots against the isolated stack (synthetic fixtures).
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { readFileSync, readdirSync, writeFileSync } from 'fs';
import { spawn } from 'child_process';
import http from 'http';
import crypto from 'crypto';
import { chromium } from 'playwright-core';

const MIG_DIR = new URL('../supabase/migrations/', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  ($2, 2026, 10, '22222222222222', '2002', 'موظف متفق', 2)`, [eg, mg]);

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

const browser = await chromium.launch({ headless: true });
// v6 captures: conflict badge in the RESULT ROW + profile header, after toasts dismiss
for (const [w, h, tag] of [[1440, 900, 'desktop'], [390, 844, 'mobile']]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await fetch('http://localhost:3100/lookup').catch(() => {});
  await page.goto('http://localhost:3100/lookup', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('input.input-dark', { timeout: 60000 });
  await sleep(3000);
  const input = page.locator('input[placeholder*="الرقم القومي"]').first();
  await input.click();
  await input.fill('11111111111111');
  await input.press('Enter');
  await page.waitForSelector('text=موظف تعارض', { timeout: 45000 }).catch(() => console.log('candidate never appeared'));
  await page.waitForSelector('text=غير محسوم', { timeout: 20000 }).catch(() => console.log('row conflict badge not found: ' + tag));
  await sleep(6000); // hydration + framer-motion settle, NO overrides
  await page.screenshot({ path: `/downloads/e2e-search-row-conflict-${tag}.png`, fullPage: false });
  console.log('shot: search row conflict ' + tag);
  const cand = page.locator('text=موظف تعارض').first();
  await cand.click({ timeout: 15000 }).catch((e) => console.log('candidate click failed', String(e).slice(0, 60)));
  await page.waitForSelector('text=حُجبت', { timeout: 20000 }).catch(() => console.log('conflict text not found: ' + tag));
  await sleep(9000); // let toasts auto-dismiss before capturing (Main: toast covered chips)
  await page.locator('text=الحساب: غير محسوم').first().scrollIntoViewIfNeeded().catch(() => {});
  await sleep(800);
  await page.screenshot({ path: `/downloads/e2e-profile-header-conflict-${tag}.png`, fullPage: false });
  console.log('shot: profile header conflict ' + tag);
  await page.close();
}
await browser.close();
dev.kill(); pr.kill(); await db.end(); await ep.stop();
console.log('UI SHOTS DONE');
process.exit(0);
