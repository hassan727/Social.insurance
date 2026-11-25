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
const dev = spawn('npm', ['run', 'dev', '--', '-p', '3100'], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:3002', NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_JWT, APP_JWT_SECRET: 'test-only-dummy-secret-32chars-minimum', PORT: '3100' }, stdio: ['ignore', 'pipe', 'pipe'] });
dev.stdout.on('data', (d) => process.stdout.write('[dev] ' + d));
dev.stderr.on('data', (d) => process.stdout.write('[dev-err] ' + d));
for (let i = 0; i < 60; i++) { try { await fetch('http://localhost:3100/api/company-accounts'); break; } catch { await sleep(1500); } }
console.log('stack up');

const browser = await chromium.launch({ headless: true });
// 1. smart-import: dynamic account selector
let page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (m) => console.log('CONSOLE', m.type(), m.text().slice(0, 150)));
page.on('response', async (r) => { if (r.url().includes('/api/')) console.log('API', r.status(), r.url().slice(0, 80), (await r.text().catch(() => '')).slice(0, 150)); });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 200)));
page.on('requestfailed', (r) => console.log('REQFAIL', r.url().slice(0, 100), r.failure()?.errorText));
page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('/api/')) console.log('HTTP', r.status(), r.url().slice(0, 100)); });
await fetch('http://localhost:3100/smart-import').catch(() => {});
await page.goto('http://localhost:3100/smart-import', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('text=اختر حساب الشركة', { timeout: 60000 });
const diag = await page.evaluate(async () => {
  const r = await fetch('/api/company-accounts');
  const t = await r.text();
  return { status: r.status, body: t.slice(0, 200) };
}).catch((e) => ({ err: String(e).slice(0, 150) }));
console.log('DIAG', JSON.stringify(diag));
await sleep(6000);
console.log('BUTTONS', await page.locator('button').count(), 'ACCT-BTNS', await page.locator('button:has-text("غاز"), button:has-text("مودرن"), button:has-text("Gas")').count());
console.log('HYDRATED?', await page.evaluate(() => !!document.querySelector('input[type=file]')));
console.log('REACT_ATTACHED', await page.evaluate(() => { const el = document.querySelector('button'); return el ? Object.keys(el).filter((k) => k.startsWith('__react')).length : -1; }));
console.log('SCRIPTS', await page.evaluate(() => performance.getEntriesByType('resource').filter((e) => e.initiatorType === 'script').length), 'REACT_ROOT', await page.evaluate(() => Object.keys(document.getElementById('__next') || {}).length));
await page.addStyleTag({ content: '* { opacity: 1 !important; transform: none !important; transition: none !important; animation: none !important; }' });
await sleep(800);
await page.screenshot({ path: '/downloads/e2e-smart-import-dynamic-accounts.png', fullPage: false });
// /import page: dynamic account selector + empty period + validation gates
for (const [w, h, tag] of [[1440, 900, 'desktop'], [390, 844, 'mobile']]) {
  const ip = await browser.newPage({ viewport: { width: w, height: h } });
  await fetch('http://localhost:3100/import').catch(() => {});
  await ip.goto('http://localhost:3100/import', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await ip.waitForSelector('text=حساب', { timeout: 60000 }).catch(() => console.log('import page label not found'));
  await sleep(3000);
  await ip.addStyleTag({ content: '* { opacity: 1 !important; transform: none !important; transition: none !important; animation: none !important; }' });
  await sleep(500);
  await ip.screenshot({ path: `/downloads/e2e-import-page-${tag}.png`, fullPage: false });
  console.log('shot: import ' + tag);
  await ip.close();
}
const pv = await browser.newPage({ viewport: { width: 390, height: 844 } });
await pv.goto('http://localhost:3100/smart-import', { waitUntil: 'domcontentloaded', timeout: 60000 });
await pv.waitForSelector('text=اختر حساب الشركة', { timeout: 60000 });
await pv.addStyleTag({ content: '* { opacity: 1 !important; transform: none !important; transition: none !important; animation: none !important; }' });
await sleep(800);
await pv.screenshot({ path: '/downloads/e2e-smart-import-mobile.png', fullPage: false });
await pv.close();
console.log('shot: smart-import mobile');
console.log('shot: smart-import');
await page.close();
// 2. lookup: conflict NID details, desktop + mobile
for (const [w, h, tag] of []) {
  page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto('http://localhost:3100/lookup', { waitUntil: 'domcontentloaded', timeout: 60000 });
  const input = page.locator('input').first();
  await input.fill('11111111111111');
  await page.locator('button', { hasText: /بحث|استعلام/ }).first().click().catch(() => input.press('Enter'));
  await sleep(2500);
  const cand = page.locator('text=موظف تعارض').first();
  await cand.click().catch((e) => console.log('candidate click failed', String(e).slice(0, 80)));
  await page.waitForSelector('text=حُجبت', { timeout: 20000 }).catch(() => console.log('conflict text not found: ' + tag));
  await sleep(800);
  await page.screenshot({ path: `/downloads/e2e-lookup-conflict-${tag}.png`, fullPage: true });
  console.log('shot: lookup conflict ' + tag);
  await page.close();
}
await browser.close();
dev.kill(); pr.kill(); await db.end(); await ep.stop();
console.log('UI SHOTS DONE');
process.exit(0);
