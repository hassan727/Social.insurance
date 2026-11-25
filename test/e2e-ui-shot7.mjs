// Runtime UI screenshot: smart-import result card shows same-batch duplicate
// warnings visibly (amber review block), desktop + mobile.
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

const ep = new EmbeddedPostgres({ databaseDir: '/tmp/pg-e2e', user: 'postgres', password: 'postgres', port: 5545, persistent: false });
await ep.initialise(); await ep.start(); await ep.createDatabase('e2e');
const db = new pg.Client({ host: '127.0.0.1', port: 5545, user: 'postgres', password: 'postgres', database: 'e2e' });
await db.connect();
await db.query(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN; CREATE ROLE authenticator NOINHERIT LOGIN PASSWORD 'authpw'; GRANT anon TO authenticator;`);
for (const f of readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql')).sort()) await db.query(readFileSync(MIG_DIR + f, 'utf8'));
await db.query(`GRANT USAGE ON SCHEMA public TO anon; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon; GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon; GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon;`);

// xlsx with a same-file duplicate: same employee, different الوظيفه values
const ws = XLSX.utils.json_to_sheet([
  { 'الرقم القومي': '88888888888888', 'الاسم': 'موظف خانات مكررة', 'الكود': '8008', 'الوظيفه': 'محاسب' },
  { 'الرقم القومي': '88888888888888', 'الاسم': 'موظف خانات مكررة', 'الكود': '8008', 'الوظيفه': 'محاسب أول' },
]);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
writeFileSync('/tmp/dup-warn.xlsx', XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));

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
// Direct API probe: does the service emit warnings for this fixture?
const fd0 = new FormData();
fd0.append('file', new Blob([readFileSync('/tmp/dup-warn.xlsx')]), 'dup-warn.xlsx');
fd0.append('selected_sheets', '["Sheet1"]');
fd0.append('company_account', 'EG');
const probe = await fetch('http://localhost:3100/api/smart-import/execute', { method: 'POST', body: fd0 });
const probej = await probe.json().catch(() => ({}));
console.log('PROBE status=' + probe.status + ' warnings=' + JSON.stringify(probej.detailed_results?.Sheet1?.warnings || null) + ' summary=' + JSON.stringify(probej.summary || probej.error || null).slice(0, 200));

const browser = await chromium.launch({ headless: true });
for (const [w, h, tag] of [[1440, 900, 'desktop'], [390, 844, 'mobile']]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto('http://localhost:3100/smart-import', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(3500);
  await page.locator('button:has-text("غاز مصر")').first().click({ timeout: 20000 });
  await page.setInputFiles('#file-input', '/tmp/dup-warn.xlsx');
  await sleep(800);
  await page.locator('button:has-text("تحليل الملف")').first().click({ timeout: 15000 });
  await page.waitForSelector('text=/استيراد \\d+ ورقة/', { timeout: 45000 });
  await page.locator('button:has-text("استيراد")').last().click({ timeout: 15000 });
  await page.waitForSelector('text=تحذيرات تحتاج مراجعة', { timeout: 60000 }).catch(async (e) => {
    await page.screenshot({ path: `/downloads/e2e-import-warnings-FAIL-${tag}.png`, fullPage: true });
    const txt = await page.locator('main').innerText().catch(() => '');
    console.log('FAIL ' + tag + ' page text tail: ' + txt.slice(-500).replace(/\n/g, ' | '));
    throw e;
  });
  // dismiss sonner toasts
  for (let i = 0; i < 4; i++) {
    const n = await page.locator('[data-sonner-toast] [data-close-button], [data-sonner-toast] button[aria-label*="lose"]').count();
    if (!n) break;
    await page.locator('[data-sonner-toast] [data-close-button], [data-sonner-toast] button[aria-label*="lose"]').first().click({ timeout: 800 }).catch(() => {});
    await sleep(700);
  }
  await page.locator('[data-sonner-toast]').first().waitFor({ state: 'detached', timeout: 20000 }).catch(() => console.log('toast still present: ' + tag));
  await page.locator('text=تحذيرات تحتاج مراجعة').first().scrollIntoViewIfNeeded();
  await sleep(1200);
  await page.screenshot({ path: `/downloads/e2e-import-warnings-${tag}.png` });
  const warnText = await page.locator('text=تحذيرات تحتاج مراجعة').first().isVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  console.log(`${tag}: warnings visible=${warnText} horizontal-overflow=${overflow}`);
  await page.close();
}
await browser.close();
dev.kill('SIGINT'); pr.kill('SIGINT'); await ep.stop();
console.log('DONE');
process.exit(0);
