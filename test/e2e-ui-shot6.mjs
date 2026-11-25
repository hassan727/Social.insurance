// Runtime UI screenshots: generic cross-source FIELD CONFLICT display.
// Fixture: one employee whose two independent source sheets disagree on
// الوظيفه. The consolidation trigger withholds the scalar and records
// field_conflicts; the profile must show the conflict with both labeled
// source values, never a silently picked winner.
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
    ('m.g', 2, '66666666666666', '6006', 'موظف تعارض حقل', 'Active');
  INSERT INTO dynamic_sheets (sheet_name, display_name, is_master_source, column_definitions, matching_keys) VALUES
    ('Sheet1', 'Sheet1', false, '[]'::jsonb, ARRAY['national_id']),
    ('SheetB', 'SheetB', false, '[]'::jsonb, ARRAY['national_id'])
  ON CONFLICT DO NOTHING;
  INSERT INTO import_logs (source_type, file_name) VALUES ('smart_import', 'shot6.xlsx');`);
const empId = (await db.query(`SELECT id FROM employees_master WHERE national_id='66666666666666'`)).rows[0].id;
const s1 = (await db.query(`SELECT id FROM dynamic_sheets WHERE sheet_name='Sheet1'`)).rows[0].id;
const sB = (await db.query(`SELECT id FROM dynamic_sheets WHERE sheet_name='SheetB'`)).rows[0].id;
const logId = (await db.query(`SELECT id FROM import_logs WHERE file_name='shot6.xlsx'`)).rows[0].id;
await db.query(`INSERT INTO sheet_data (sheet_id, employee_id, row_data, row_code, row_national_id, row_name, import_id, row_number, is_latest, created_at) VALUES
  ($1, $3, '{"الوظيفه":"محاسب","الراتب":5000}'::jsonb, '6006', '66666666666666', 'موظف تعارض حقل', $4, 1, true, NOW()),
  ($2, $3, '{"الوظيفه":"محاسب أول"}'::jsonb, '6006', '66666666666666', 'موظف تعارض حقل', $4, 1, true, NOW() + interval '1 minute')`, [s1, sB, empId, logId]);
const chk = (await db.query(`SELECT current_job_title, consolidated_data FROM employees_master WHERE id=$1`, [empId])).rows[0];
console.log('fixture check: scalar=', chk.current_job_title, 'conflicts=', JSON.stringify((chk.consolidated_data || {}).field_conflicts || null));

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
for (const [w, h, tag] of [[1440, 900, 'desktop'], [390, 844, 'mobile']]) {
  // 1) lookup profile: conflict alert lists the field conflict with sources
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto('http://localhost:3100/lookup', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('input.input-dark', { timeout: 60000 });
  await sleep(3000);
  const input = page.locator('input[placeholder*="الرقم القومي"]').first();
  await input.click();
  await input.fill('66666666666666');
  await input.press('Enter');
  await page.waitForSelector('text=موظف تعارض حقل', { timeout: 45000 }).catch(() => console.log('candidate never appeared'));
  await page.locator('text=موظف تعارض حقل').first().click({ timeout: 15000 }).catch((e) => console.log('candidate click failed', String(e).slice(0, 60)));
  await page.waitForSelector('text=تعارض الوظيفة', { timeout: 20000 }).catch(() => console.log('field conflict line not found: ' + tag));
  // sonner toasts: click each close button once, then wait for full detach
  for (let i = 0; i < 4; i++) {
    const n = await page.locator('[data-sonner-toast] [data-close-button], [data-sonner-toast] button[aria-label*="lose"]').count();
    if (!n) break;
    await page.locator('[data-sonner-toast] [data-close-button], [data-sonner-toast] button[aria-label*="lose"]').first().click({ timeout: 800 }).catch(() => {});
    await sleep(700);
  }
  await page.locator('[data-sonner-toast]').first().waitFor({ state: 'detached', timeout: 25000 }).catch(() => console.log('toast still present: ' + tag));
  const remaining = await page.locator('[data-sonner-toast]').count();
  if (remaining) console.log('TOASTS REMAINING: ' + remaining + ' ' + tag);
  await sleep(2000); // animations settle, NO overrides
  await page.locator('text=تعارض الوظيفة').first().scrollIntoViewIfNeeded().catch(() => {});
  await sleep(800);
  await page.screenshot({ path: `/downloads/e2e-field-conflict-lookup-${tag}.png`, fullPage: false });
  console.log('shot: lookup field conflict ' + tag);
  await page.close();

  // 2) master profile page: withheld scalar shown as "محتاج مراجعة" + review card
  const page2 = await browser.newPage({ viewport: { width: w, height: h } });
  await page2.goto(`http://localhost:3100/employee/${empId}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page2.waitForSelector('text=حقول تحتاج مراجعة', { timeout: 30000 }).catch(() => console.log('review card not found: ' + tag));
  await sleep(4000);
  await page2.locator('text=حقول تحتاج مراجعة').first().evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'nearest' })).catch(() => {});
  await sleep(800);
  const overflow = await page2.evaluate(() => {
    const de = document.documentElement;
    const bad = [];
    document.querySelectorAll('*').forEach((el) => {
      const r = el.getBoundingClientRect();
      if ((r.right > de.clientWidth + 1 || r.left < -1) && bad.length < 8 && el.tagName !== 'HTML' && el.tagName !== 'BODY') bad.push(el.tagName + '.' + String(el.className).slice(0, 50) + ' l=' + Math.round(r.left) + ' r=' + Math.round(r.right));
    });
    return { scrollW: de.scrollWidth, clientW: de.clientWidth, bad };
  });
  console.log('overflow probe ' + tag + ':', JSON.stringify(overflow));
  await page2.screenshot({ path: `/downloads/e2e-field-conflict-profile-${tag}.png`, fullPage: false });
  console.log('shot: profile field conflict ' + tag);
  await page2.close();
}
await browser.close();
dev.kill(); pr.kill(); await db.end(); await ep.stop();
console.log('UI SHOTS DONE');
process.exit(0);
