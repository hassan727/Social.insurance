// Sim stack on the RESTORED prod backup (PG17 :5417 db=sim) + PostgREST + proxy + Next dev :3101.
import { writeFileSync } from 'fs';
import { spawn } from 'child_process';
import http from 'http';
import crypto from 'crypto';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const JWT_SECRET = 'e2e-test-only-secret-not-real-0123456789abcdef';
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const ANON_JWT = b64u({ alg: 'HS256', typ: 'JWT' }) + '.' + b64u({ role: 'anon' }) + '.' +
  crypto.createHmac('sha256', JWT_SECRET).update(b64u({ alg: 'HS256', typ: 'JWT' }) + '.' + b64u({ role: 'anon' })).digest('base64url');
writeFileSync('/tmp/pgrst-sim.conf', `db-uri = "postgres://authenticator:authpw@127.0.0.1:5417/sim"\ndb-schemas = "public"\ndb-anon-role = "anon"\nserver-port = 3011\njwt-secret = "${JWT_SECRET}"\n`);
const pr = spawn('/tmp/postgrest', ['/tmp/pgrst-sim.conf'], { stdio: 'ignore' });
http.createServer((req, res) => {
  const u = req.url.replace(/^\/rest\/v1/, '');
  const p = http.request({ host: '127.0.0.1', port: 3011, path: u, method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  req.pipe(p); p.on('error', () => { res.statusCode = 502; res.end(); });
}).listen(3012);
await sleep(2500);
const probe = await fetch('http://127.0.0.1:3012/rest/v1/company_accounts?select=id,account_code', { headers: { apikey: ANON_JWT, authorization: 'Bearer ' + ANON_JWT } }).then((r) => r.json()).catch((e) => String(e));
console.log('probe:', JSON.stringify(probe));

const dev = spawn('npm', ['run', 'dev', '--', '-p', '3101'], {
  cwd: new URL('..', import.meta.url).pathname,
  env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:3012', NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_JWT, APP_JWT_SECRET: 'test-only-dummy-secret-32chars-minimum', PORT: '3101' },
  stdio: 'ignore',
});
for (let i = 0; i < 90; i++) {
  try { const r = await fetch('http://127.0.0.1:3101/smart-import'); if (r.status < 500) break; } catch { await sleep(1500); }
}
console.log('SIM STACK READY');
setInterval(() => {}, 60000);
