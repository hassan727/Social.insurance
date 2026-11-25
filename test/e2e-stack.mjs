// Isolated E2E stack: real PG + real PostgREST serving the migrated schema
// with synthetic fixtures. Stays alive so the Next dev server can run
// against it. NO external services, synthetic data only.
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { readFileSync, readdirSync, writeFileSync } from 'fs';
import { spawn } from 'child_process';

const MIG_DIR = new URL('../supabase/migrations/', import.meta.url).pathname;

const ep = new EmbeddedPostgres({ databaseDir: '/tmp/pg-e2e', user: 'postgres', password: 'postgres', port: 5545, persistent: false });
await ep.initialise();
await ep.start();
await ep.createDatabase('e2e');
const db = new pg.Client({ host: '127.0.0.1', port: 5545, user: 'postgres', password: 'postgres', database: 'e2e' });
await db.connect();
await db.query(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN; CREATE ROLE authenticator NOINHERIT LOGIN PASSWORD 'authpw'; GRANT anon, authenticated, service_role TO authenticator;`);

const baseline = readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql')).sort();
for (const f of baseline) {
  await db.query(readFileSync(MIG_DIR + f, 'utf8'));
  console.log('applied:', f);
}
await db.query(`GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
  GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;`);

// ── Synthetic fixtures ──────────────────────────────────────────────────────
await db.query(`
  INSERT INTO employees_master (company_account, account_id, national_id, employee_code, employee_name, current_status) VALUES
    ('E.G', 1, '11111111111111', '1001', 'موظف تعارض', 'Active'),
    ('m.g', 2, '22222222222222', '2002', 'موظف متفق', 'Active');
  INSERT INTO incoming_insurance_records (employee_code, employee_name, national_id, company_account, status, insurance_status) VALUES
    ('1001', 'موظف تعارض', '11111111111111', 'M.G', 'Active', 'مؤمن عليه'),
    ('2002', 'موظف متفق', '22222222222222', 'm.g', 'Active', 'مؤمن عليه');
  INSERT INTO import_logs (source_type, file_name, period_year, period_month, account_id) VALUES
    ('monthly_payroll', 'EG OCT.xlsx', 2026, 10, 1),
    ('monthly_payroll', 'MODERN OCT.xlsx', 2026, 10, 2);
`);
const eg = (await db.query(`SELECT id FROM import_logs WHERE file_name='EG OCT.xlsx'`)).rows[0].id;
const mg = (await db.query(`SELECT id FROM import_logs WHERE file_name='MODERN OCT.xlsx'`)).rows[0].id;
await db.query(
  `INSERT INTO monthly_payroll_records (import_id, period_year, period_month, national_id, employee_code, employee_name, account_id) VALUES
    ($1, 2026, 10, '11111111111111', '1001', 'موظف تعارض', 1),
    ($2, 2026, 10, '11111111111111', '1001', 'موظف تعارض', 2),
    ($2, 2026, 10, '22222222222222', '2002', 'موظف متفق', 2),
    ($2, 2026, 10, '33333333333333', '3003', 'موظف مرتبات فقط', 2)`,
  [eg, mg]);

writeFileSync('/tmp/postgrest.conf', `db-uri = "postgres://authenticator:authpw@127.0.0.1:5545/e2e"
db-schemas = "public"
db-anon-role = "anon"
server-port = 3001
`);
const pr = spawn('/tmp/postgrest', ['/tmp/postgrest.conf'], { stdio: ['ignore', 'pipe', 'pipe'] });
pr.stdout.on('data', (d) => process.stdout.write('[postgrest] ' + d));
pr.stderr.on('data', (d) => process.stdout.write('[postgrest-err] ' + d));
await new Promise((r) => setTimeout(r, 2500));
const probe = await fetch('http://127.0.0.1:3001/company_accounts?select=id,account_code').then((r) => r.json()).catch((e) => String(e));
console.log('postgrest probe:', JSON.stringify(probe));
console.log('E2E STACK READY');
setInterval(() => {}, 60000);
