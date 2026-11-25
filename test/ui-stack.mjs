// UI verification stack: real PG + PostgREST + /rest/v1 proxy + Next dev on
// 3101, synthetic fixtures only. Stays alive for screenshot scripts.
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { readFileSync, readdirSync, writeFileSync } from 'fs';
import { spawn } from 'child_process';
import http from 'http';
import crypto from 'crypto';

const MIG_DIR = new URL('../supabase/migrations/', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ep = new EmbeddedPostgres({ databaseDir: '/tmp/pg-e2e-ui', user: 'postgres', password: 'postgres', port: 5546, persistent: false });
await ep.initialise(); await ep.start(); await ep.createDatabase('e2e');
const db = new pg.Client({ host: '127.0.0.1', port: 5546, user: 'postgres', password: 'postgres', database: 'e2e' });
await db.connect();
await db.query(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN; CREATE ROLE authenticator NOINHERIT LOGIN PASSWORD 'authpw'; GRANT anon TO authenticator;`);
for (const f of readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql')).sort()) await db.query(readFileSync(MIG_DIR + f, 'utf8'));
await db.query(`GRANT USAGE ON SCHEMA public TO anon; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon; GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon; GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon;`);
// Fixture: master lives under EG; the MG-selected upload of the same NID must
// surface as a cross-account conflict in the result card.
await db.query(`INSERT INTO employees_master (company_account, account_id, national_id, employee_code, employee_name, current_status) VALUES ('E.G', 1, '29803141601932', '53889', 'محمود سعيد محمد العزب', 'Active')`);
console.log('pg ready');

const JWT_SECRET = 'e2e-test-only-secret-not-real-0123456789abcdef';
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const ANON_JWT = b64u({ alg: 'HS256', typ: 'JWT' }) + '.' + b64u({ role: 'anon' }) + '.' +
  crypto.createHmac('sha256', JWT_SECRET).update(b64u({ alg: 'HS256', typ: 'JWT' }) + '.' + b64u({ role: 'anon' })).digest('base64url');
writeFileSync('/tmp/postgrest-ui.conf', `db-uri = "postgres://authenticator:authpw@127.0.0.1:5546/e2e"\ndb-schemas = "public"\ndb-anon-role = "anon"\nserver-port = 3011\njwt-secret = "${JWT_SECRET}"\n`);
const pr = spawn('/tmp/postgrest', ['/tmp/postgrest-ui.conf'], { stdio: 'ignore' });
http.createServer((req, res) => {
  const u = req.url.replace(/^\/rest\/v1/, '');
  const p = http.request({ host: '127.0.0.1', port: 3011, path: u, method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  req.pipe(p); p.on('error', () => { res.statusCode = 502; res.end(); });
}).listen(3012);
await sleep(2000);

const dev = spawn('npm', ['run', 'dev', '--', '-p', '3101'], {
  cwd: new URL('..', import.meta.url).pathname,
  env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:3012', NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_JWT, APP_JWT_SECRET: 'test-only-dummy-secret-32chars-minimum', PORT: '3101' },
  stdio: 'ignore',
});
for (let i = 0; i < 90; i++) {
  try { const r = await fetch('http://127.0.0.1:3101/smart-import'); if (r.status < 500) break; } catch { await sleep(1500); }
}
console.log('UI STACK READY');
setInterval(() => {}, 60000);
