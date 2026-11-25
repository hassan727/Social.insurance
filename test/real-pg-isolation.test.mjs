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

// ── Forward migrations 000002..000004 VERBATIM (source-aware merge, trigger
// fix, source-removal recompute) ────────────────────────────────────────────
for (const f of ['20261125000002_blank_cell_no_erase_consolidation.sql', '20261125000003_fix_sheet_data_update_trigger.sql', '20261125000004_source_removal_recompute.sql']) {
  try {
    await db.query(readFileSync(MIG_DIR + f, 'utf8'));
    console.log('forward migration applied VERBATIM:', f);
  } catch (e) {
    console.log('FAIL  forward migration failed verbatim:', f, '—', String(e.message).split('\n')[0]);
    failures++;
  }
}

// ── Source-removal recompute fixtures ───────────────────────────────────────
await db.query(`
  INSERT INTO employees_master (company_account, account_id, national_id, employee_code, employee_name, current_status) VALUES
    ('E.G', 1, '12121212121212', 'RR1', 'موظف حذف أول', 'Active'),
    ('E.G', 1, '13131313131313', 'RR2', 'موظف حذف ثان', 'Active'),
    ('E.G', 1, '14141414141414', 'RR3', 'موظف حذف ثالث', 'Active'),
    ('E.G', 1, '15151515151515', 'RR4', 'موظف حذف رابع', 'Active'),
    ('E.G', 1, '16161616161616', 'RR5', 'موظف حذف خامس', 'Active');
  INSERT INTO dynamic_sheets (sheet_name, display_name, is_master_source, column_definitions, matching_keys) VALUES
    ('SA','SA',false,'[]'::jsonb,ARRAY['national_id']),
    ('SB','SB',false,'[]'::jsonb,ARRAY['national_id']),
    ('SC','SC',false,'[]'::jsonb,ARRAY['national_id']),
    ('SD','SD',false,'[]'::jsonb,ARRAY['national_id']),
    ('SE','SE',false,'[]'::jsonb,ARRAY['national_id']),
    ('SF','SF',false,'[]'::jsonb,ARRAY['national_id']),
    ('SG','SG',false,'[]'::jsonb,ARRAY['national_id'])
  ON CONFLICT DO NOTHING;
  INSERT INTO import_logs (source_type, file_name) VALUES ('smart_import', 'rr.xlsx');`);
const rrLog = (await db.query(`SELECT id FROM import_logs WHERE file_name='rr.xlsx'`)).rows[0].id;
const rr = {};
for (const [k, nid] of [['RR1','12121212121212'],['RR2','13131313131313'],['RR3','14141414141414'],['RR4','15151515151515'],['RR5','16161616161616']]) {
  rr[k] = (await db.query(`SELECT id FROM employees_master WHERE national_id=$1 AND account_id=1`, [nid])).rows[0].id;
}
const sh = {};
for (const n of ['SA','SB','SC','SD','SE','SF','SG']) {
  sh[n] = (await db.query(`SELECT id FROM dynamic_sheets WHERE sheet_name=$1`, [n])).rows[0].id;
}
const addRow = (sheet, emp, nid, code, name, data) => db.query(
  `INSERT INTO sheet_data (sheet_id, employee_id, row_data, row_code, row_national_id, row_name, import_id, row_number, is_latest, created_at) VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,1,true,NOW())`,
  [sh[sheet], emp, JSON.stringify(data), code, nid, name, rrLog]);

// RR1: two agreeing sources, distinct keys
await addRow('SA', rr.RR1, '12121212121212', 'RR1', 'موظف حذف أول', { 'الوظيفه': 'محاسب', 'الراتب': 5000 });
await addRow('SB', rr.RR1, '12121212121212', 'RR1', 'موظف حذف أول', { 'الوظيفه': 'محاسب', 'المنطقه': 'القاهرة' });
// RR2: two conflicting sources
await addRow('SC', rr.RR2, '13131313131313', 'RR2', 'موظف حذف ثان', { 'الوظيفه': 'مشرف' });
await addRow('SD', rr.RR2, '13131313131313', 'RR2', 'موظف حذف ثان', { 'الوظيفه': 'محاسب' });
// RR3: single source + a non-sheet blob key (classic-route shape)
await addRow('SE', rr.RR3, '14141414141414', 'RR3', 'موظف حذف ثالث', { 'الوظيفه': 'عامل', 'الحاله': 'Active' });
await db.query(`UPDATE employees_master SET consolidated_data = consolidated_data || '{"financial_ledger":{"total":123}}'::jsonb WHERE id=$1`, [rr.RR3]);
// RR4: single source, removed via is_latest flip (snapshot path)
await addRow('SF', rr.RR4, '15151515151515', 'RR4', 'موظف حذف رابع', { 'الوظيفه': 'سائق' });
// RR5: legacy blob key with NO provenance + one sheet key
await db.query(`UPDATE employees_master SET consolidated_data = consolidated_data || '{"قديم_بدون_مصدر":"قيمة"}'::jsonb, sheet_source_keys='[]'::jsonb WHERE id=$1`, [rr.RR5]);
await addRow('SG', rr.RR5, '16161616161616', 'RR5', 'موظف حذف خامس', { 'الوظيفه': 'فني' });

let m1 = (await db.query(`SELECT current_job_title, consolidated_data, sheet_source_keys, sheet_source_columns FROM employees_master WHERE id=$1`, [rr.RR1])).rows[0];
check('provenance maintained by merge: الراتب in sheet_source_keys, current_job_title in sheet_source_columns',
  (m1.sheet_source_keys || []).includes('الراتب') && (m1.sheet_source_columns || []).includes('current_job_title'),
  JSON.stringify({ k: m1.sheet_source_keys, c: m1.sheet_source_columns }));
check('merge before removal: agreed title set, both blob keys present',
  m1.current_job_title === 'محاسب' && m1.consolidated_data['الراتب'] !== undefined && m1.consolidated_data['المنطقه'] !== undefined);

// DELETE one of two agreeing sources (admin delete path)
await db.query(`DELETE FROM sheet_data WHERE sheet_id=$1 AND employee_id=$2`, [sh.SA, rr.RR1]);
m1 = (await db.query(`SELECT current_job_title, consolidated_data FROM employees_master WHERE id=$1`, [rr.RR1])).rows[0];
check('admin DELETE: removed-source-only key (الراتب) gone from blob', m1.consolidated_data['الراتب'] === undefined, JSON.stringify(Object.keys(m1.consolidated_data)));
check('admin DELETE: surviving-source key (المنطقه) retained', String(m1.consolidated_data['المنطقه']) === 'القاهرة');
check('admin DELETE: agreed scalar kept (other source still provides)', m1.current_job_title === 'محاسب', String(m1.current_job_title));

// DELETE one of two conflicting sources -> resolves from survivor
let m2 = (await db.query(`SELECT current_job_title, consolidated_data FROM employees_master WHERE id=$1`, [rr.RR2])).rows[0];
check('before removal: conflict withheld + recorded', m2.current_job_title === null && !!((m2.consolidated_data.field_conflicts || {})['current_job_title'] || (m2.consolidated_data.field_conflicts || {})['الوظيفه']));
await db.query(`DELETE FROM sheet_data WHERE sheet_id=$1 AND employee_id=$2`, [sh.SC, rr.RR2]);
m2 = (await db.query(`SELECT current_job_title, consolidated_data FROM employees_master WHERE id=$1`, [rr.RR2])).rows[0];
check('conflicting source removed: resolves from surviving source', m2.current_job_title === 'محاسب', String(m2.current_job_title));
check('conflict cleared after resolution', !(m2.consolidated_data.field_conflicts || {})['current_job_title'] && !(m2.consolidated_data.field_conflicts || {})['الوظيفه']);

// DELETE the LAST source: no resurrection, no termination, identity kept
await db.query(`DELETE FROM sheet_data WHERE sheet_id=$1 AND employee_id=$2`, [sh.SE, rr.RR3]);
const m3 = (await db.query(`SELECT current_job_title, current_status, national_id, consolidated_data FROM employees_master WHERE id=$1`, [rr.RR3])).rows[0];
check('last source removed: sheet-sourced scalar NULL (not resurrected)', m3.current_job_title === null, String(m3.current_job_title));
check('last source removed: status NULL (never guessed termination)', m3.current_status === null, String(m3.current_status));
check('last source removed: identity (national_id) retained for reimport matching', m3.national_id === '14141414141414');
check('last source removed: sheet blob keys gone, non-sheet key (financial_ledger) preserved',
  m3.consolidated_data['الوظيفه'] === undefined && JSON.stringify(m3.consolidated_data.financial_ledger) === '{"total":123}',
  JSON.stringify(m3.consolidated_data));
const rr3alive = (await db.query(`SELECT count(*)::int c FROM employees_master WHERE id=$1`, [rr.RR3])).rows[0].c;
check('last source removed: employee row NOT deleted', rr3alive === 1);

// is_latest flip (snapshot replacement path) removes contribution the same way
await db.query(`UPDATE sheet_data SET is_latest=false WHERE sheet_id=$1 AND employee_id=$2`, [sh.SF, rr.RR4]);
const m4 = (await db.query(`SELECT current_job_title, consolidated_data FROM employees_master WHERE id=$1`, [rr.RR4])).rows[0];
check('snapshot flip: removed-source scalar NULL via is_latest path', m4.current_job_title === null, String(m4.current_job_title));
check('snapshot flip: blob key removed via is_latest path', m4.consolidated_data['الوظيفه'] === undefined);

// No-provenance fallback: unknown-provenance keys are preserved, sheet keys removed
await db.query(`DELETE FROM sheet_data WHERE sheet_id=$1 AND employee_id=$2`, [sh.SG, rr.RR5]);
const m5 = (await db.query(`SELECT current_job_title, consolidated_data FROM employees_master WHERE id=$1`, [rr.RR5])).rows[0];
check('no-provenance key preserved (documented fallback)', String(m5.consolidated_data['قديم_بدون_مصدر']) === 'قيمة', JSON.stringify(m5.consolidated_data));
check('provenanced sheet key removed while fallback key kept', m5.consolidated_data['الوظيفه'] === undefined && m5.current_job_title === null);

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
