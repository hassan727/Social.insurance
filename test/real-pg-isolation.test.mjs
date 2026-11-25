// REAL Postgres isolation test — embedded-postgres (actual PostgreSQL binaries,
// unprivileged local instance, synthetic fixtures only, no external service).
// Applies EVERY baseline migration in order, then the new migration VERBATIM
// (plpgsql trigger + audit DO block + UPDATE...FROM included — no dialect gaps).
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { readFileSync, readdirSync } from 'fs';

const MIG_DIR = new URL('../supabase/migrations/', import.meta.url).pathname;
let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`);
  if (!cond) failures++;
};

const ep = new EmbeddedPostgres({
  databaseDir: '/tmp/pg-real-isolation',
  user: 'postgres',
  password: 'postgres',
  port: 5544,
  persistent: false,
});
await ep.initialise();
await ep.start();
await ep.createDatabase('testdb');
await ep.createDatabase('dupdb');
console.log('embedded postgres started');

const connect = (database) => new pg.Client({ host: '127.0.0.1', port: 5544, user: 'postgres', password: 'postgres', database });
const db = connect('testdb');
await db.connect();
// Supabase-specific roles referenced by one baseline migration's GRANTs
await db.query(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;`);

// ── Baseline migrations, in repo order ──────────────────────────────────────
const baseline = readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql') && !f.startsWith('20261125')).sort();
for (const f of baseline) {
  try {
    await db.query(readFileSync(MIG_DIR + f, 'utf8'));
    console.log('baseline applied:', f);
  } catch (e) {
    console.log('FAIL  baseline migration failed:', f, '—', String(e.message).split('\n')[0]);
    failures++;
  }
}

// ── Synthetic fixtures (incl. case-1-shaped conflict) ───────────────────────
await db.query(`
  INSERT INTO employees_master (company_account, account_id, national_id, employee_code, employee_name, current_status) VALUES
    ('E.G', 1, '11111111111111', '1001', 'موظف اختبار أول', 'Active'),
    ('m.g', 2, '22222222222222', '2002', 'موظف اختبار ثان', 'Active'),
    ('E.G', 1, '44444444444444', '4004', 'موظف اختبار رابع', 'Active');
  INSERT INTO incoming_insurance_records (employee_code, employee_name, national_id, company_account, status, insurance_status) VALUES
    ('1001', 'موظف اختبار أول', '11111111111111', 'M.G', 'Active', 'مؤمن عليه'),
    ('2002', 'موظف اختبار ثان', '22222222222222', 'm.g', 'Active', 'مؤمن عليه'),
    ('4004', 'موظف اختبار رابع', '44444444444444', 'E.G', 'Active', 'مؤمن عليه');
  INSERT INTO import_logs (source_type, file_name, period_year, period_month) VALUES
    ('monthly_payroll', 'EG OCT.xlsx', 2026, 10),
    ('monthly_payroll', 'MODERN OCT.xlsx', 2026, 10),
    ('monthly_payroll', 'UNRESOLVED OCT.xlsx', 2026, 10),
    ('monthly_payroll', 'MIXED OCT.xlsx', 2026, 10),
    ('monthly_payroll', 'MODERN NOV.xlsx', 2026, 11),
    ('monthly_insurance', 'EG INS OCT.xlsx', 2026, 10),
    ('monthly_insurance', 'CONFLICT INS OCT.xlsx', 2026, 10);
`);
const logId = async (file) => (await db.query(`SELECT id FROM import_logs WHERE file_name = $1`, [file])).rows[0].id;
const logEgP = { id: await logId('EG OCT.xlsx') };
const logMgP = { id: await logId('MODERN OCT.xlsx') };
const logUnP = { id: await logId('UNRESOLVED OCT.xlsx') };
const logMixP = { id: await logId('MIXED OCT.xlsx') };
const logMgNovP = { id: await logId('MODERN NOV.xlsx') };
const logEgI = { id: await logId('EG INS OCT.xlsx') };
const logConI = { id: await logId('CONFLICT INS OCT.xlsx') };
await db.query(
  `INSERT INTO monthly_payroll_records (import_id, period_year, period_month, national_id, employee_code, employee_name) VALUES
    ($1, 2026, 10, '44444444444444', '4004', 'موظف اختبار رابع'),
    ($2, 2026, 10, '22222222222222', '2002', 'موظف اختبار ثان'),
    ($3, 2026, 10, '11111111111111', '1001', 'موظف اختبار أول'),
    ($3, 2026, 10, '99999999999999', '9999', 'موظف بلا مصادر'),
    ($4, 2026, 10, '44444444444444', '4004', 'موظف اختبار رابع'),
    ($4, 2026, 10, '22222222222222', '2002', 'موظف اختبار ثان'),
    ($5, 2026, 11, '22222222222222', '2002', 'موظف اختبار ثان')`,
  [logEgP.id, logMgP.id, logUnP.id, logMixP.id, logMgNovP.id]
);
await db.query(
  `INSERT INTO monthly_insurance_records (import_id, period_year, period_month, national_id, employee_code, employee_name) VALUES
    ($1, 2026, 10, '44444444444444', '4004', 'موظف اختبار رابع'),
    ($2, 2026, 10, '11111111111111', '1001', 'موظف اختبار أول')`,
  [logEgI.id, logConI.id]
);

// ── Apply the NEW migration VERBATIM (whole file, one call) ─────────────────
try {
  await db.query(readFileSync(MIG_DIR + '20261125000001_account_period_isolation.sql', 'utf8'));
  console.log('new migration applied VERBATIM (trigger + DO block + UPDATE...FROM)');
} catch (e) {
  console.log('FAIL  new migration failed verbatim:', String(e.message).split('\n')[0]);
  failures++;
}

// ── Backfill: cross-source agreement rule ────────────────────────────────────
const rows = (await db.query(`SELECT national_id, period_month, account_id FROM monthly_payroll_records ORDER BY national_id, period_month`)).rows;
const accOf = (nid, m) => rows.filter((r) => r.national_id === nid && r.period_month === m).map((r) => r.account_id);
check('case-1 shape (master EG vs warad MG): payroll row QUARANTINED, not stamped from blind master mapping', accOf('11111111111111', 10)[0] === null);
check('agreeing MG employee: payroll rows -> account 2 (Oct + Nov)', String(accOf('22222222222222', 10)) === '2,2' && String(accOf('22222222222222', 11)) === '2');
check('agreeing EG employee: payroll rows -> account 1 (both batches)', String(accOf('44444444444444', 10)) === '1,1');
check('no master + no warad: stays NULL', accOf('99999999999999', 10)[0] === null);
const ins = (await db.query(`SELECT national_id, account_id FROM monthly_insurance_records ORDER BY national_id`)).rows;
check('insurance: conflict NID quarantined, agreeing NID stamped', ins.find((r) => r.national_id === '11111111111111').account_id === null && ins.find((r) => r.national_id === '44444444444444').account_id === 1);

// ── import_logs backfill: only single-account batches ───────────────────────
const logsAfter = (await db.query(`SELECT id, account_id FROM import_logs`)).rows;
const la = (id) => logsAfter.find((l) => l.id === id).account_id;
check('import_logs: EG payroll batch -> 1', la(logEgP.id) === 1);
check('import_logs: MG payroll batch -> 2 (Oct), Nov batch -> 2', la(logMgP.id) === 2 && la(logMgNovP.id) === 2);
check('import_logs: unresolved batch stays NULL', la(logUnP.id) === null);
check('import_logs: MIXED batch stays NULL', la(logMixP.id) === null);
check('import_logs: EG insurance batch -> 1, conflict batch NULL', la(logEgI.id) === 1 && la(logConI.id) === null);

// ── Quarantine view ──────────────────────────────────────────────────────────
const q = (await db.query(`SELECT source_table, national_id FROM v_unassigned_monthly_records ORDER BY 1, 2`)).rows;
check('quarantine view: conflict NID (payroll+insurance) + orphan listed', q.length === 3, q.map((r) => `${r.source_table}:${r.national_id}`).join(','));

// ── Trigger: no silent Egypt Gas fallback ───────────────────────────────────
await db.query(`INSERT INTO employees_master (company_account, employee_code, employee_name) VALUES ('UnknownCo', '7777', 'موظف شركة مجهولة')`);
const unk = (await db.query(`SELECT account_id, account_employee_uid FROM employees_master WHERE employee_code = '7777'`)).rows[0];
check('trigger: unknown company -> account_id NULL (not EG)', unk.account_id === null, `uid=${unk.account_employee_uid}`);
check('trigger: unknown company UID prefixed UNASSIGNED', String(unk.account_employee_uid).startsWith('UNASSIGNED-'));
await db.query(`INSERT INTO employees_master (company_account, employee_code, employee_name) VALUES ('غاز مصر', '8888', 'موظف اسم عربي')`);
const ar = (await db.query(`SELECT account_id, account_employee_uid FROM employees_master WHERE employee_code = '8888'`)).rows[0];
check('trigger: Arabic alias resolves to EG account 1', ar.account_id === 1, `uid=${ar.account_employee_uid}`);

// ── Audit-guarded uniqueness re-scope ───────────────────────────────────────
const idx = (await db.query(`SELECT indexname FROM pg_indexes WHERE tablename = 'employees_master'`)).rows.map((r) => r.indexname);
check('global NID unique index dropped, per-account index created', !idx.includes('idx_employees_master_unique_national_global') && idx.includes('idx_employees_master_unique_national_per_account'));

// ── Same NID in TWO accounts is now possible per-account (assess ambiguity) ─
await db.query(`INSERT INTO employees_master (company_account, account_id, national_id, employee_code, employee_name) VALUES ('m.g', 2, '11111111111111', 'MG-1001', 'موظف اختبار أول')`);
check('same national_id allowed in a second account after re-scope', true);
const dup = (await db.query(`SELECT COUNT(*)::int c FROM employees_master WHERE national_id = '11111111111111'`)).rows[0].c;
check('conflict NID now exists in 2 accounts (ambiguity visible, must be resolved by review)', dup === 2);

// ── Scoped delete isolation (route behavior at SQL level) ────────────────────
await db.query(`DELETE FROM monthly_payroll_records WHERE period_year = 2026 AND period_month = 10 AND account_id = 2`);
const survivors = (await db.query(`SELECT national_id, account_id FROM monthly_payroll_records WHERE period_year = 2026 AND period_month = 10 ORDER BY national_id`)).rows;
check('scoped delete: only MG Oct rows removed; EG + quarantined Oct rows survive', survivors.length === 4 && survivors.every((r) => r.account_id !== 2), `survivors=${survivors.length}`);

// ── dupdb: audit DO block must ABORT the migration on existing duplicates ───
const db2 = connect('dupdb');
await db2.connect();
// roles are cluster-wide; already created for testdb above
for (const f of baseline) { try { await db2.query(readFileSync(MIG_DIR + f, 'utf8')); } catch { /* same baseline result as testdb */ } }
await db2.query(`INSERT INTO employees_master (company_account, account_id, national_id, employee_code, employee_name) VALUES ('E.G', 1, '55555555555555', 'A1', 'أ'), ('m.g', 2, '55555555555555', 'A2', 'ب')`).catch(() => {});
// remove the global unique first? No: baseline blocks duplicate NID. Instead drop the index to simulate a pre-existing dup state:
await db2.query(`DROP INDEX IF EXISTS idx_employees_master_unique_national_global`);
await db2.query(`INSERT INTO employees_master (company_account, account_id, national_id, employee_code, employee_name) VALUES ('E.G', 1, '55555555555555', 'A1', 'أ'), ('m.g', 2, '55555555555555', 'A2', 'ب')`);
let auditAborted = false;
try {
  await db2.query(readFileSync(MIG_DIR + '20261125000001_account_period_isolation.sql', 'utf8'));
} catch (e) {
  auditAborted = /duplicate national_id groups/.test(e.message);
}
check('audit DO block ABORTS migration when duplicate NIDs exist', auditAborted);
await db2.end();

console.log(failures === 0 ? '\nALL REAL-PG ASSERTIONS PASSED' : `\n${failures} ASSERTION(S) FAILED`);
await db.end();
await ep.stop();
process.exit(failures === 0 ? 0 : 1);
