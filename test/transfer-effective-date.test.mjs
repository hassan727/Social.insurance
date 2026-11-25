// TRANSFER / STAMP-CORRECTION suite — real Postgres, synthetic fixtures.
// Proves migration 20261125000006: explicit reviewed transfers with effective
// dating, canonical company text, atomic master+history writes, UID-collision
// rejection, backdated/out-of-order handling, future-date REJECTION (no
// scheduler, no stale lists, no writes-on-read), concurrency guard, evidence
// provenance, corrections alongside transfer chronology, and per-company fact
// preservation. apply_due_company_transfers is exercised as the OPS-ONLY
// helper it is (never wired to a read path).
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
  databaseDir: '/tmp/pg-transfer',
  user: 'postgres',
  password: 'postgres',
  port: 5548,
  persistent: false,
});
await ep.initialise();
await ep.start();
await ep.createDatabase('testdb');
const db = new pg.Client({ host: '127.0.0.1', port: 5548, user: 'postgres', password: 'postgres', database: 'testdb' });
await db.connect();
await db.query(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;`);

for (const f of readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql')).sort()) {
  try {
    await db.query(readFileSync(MIG_DIR + f, 'utf8'));
  } catch (e) {
    console.log('FAIL  migration failed:', f, '—', String(e.message).split('\n')[0]);
    failures++;
  }
}
console.log('migrations applied');

// ── Fixtures ────────────────────────────────────────────────────────────────
await db.query(`
  INSERT INTO employees_master (company_account, account_id, national_id, employee_code, employee_name, current_status) VALUES
    ('E.G', 1, '11111111111111', '1001', 'موظف أول', 'Active'),
    ('m.g', 2, '22222222222222', '2002', 'موظف ثان', 'Active'),
    ('E.G', 1, '44444444444444', '4004', 'موظف رابع', 'Active'),
    ('m.g', 2, '55555555555555', '4004', 'موظف خامس', 'Active'),
    ('E.G', 1, '66666666666666', '5005', 'موظف سادس', 'Active'),
    ('E.G', 1, '77777777777777', '6006', 'موظف سابع', 'Active'),
    ('E.G', 1, '12121212121212', '7007', 'موظف ثامن', 'Active'),
    ('E.G', 1, '14141414141414', '8008', 'موظف تاسع', 'Active');
  INSERT INTO import_logs (source_type, file_name, period_year, period_month, account_id) VALUES
    ('monthly_payroll', 'EG OCT.xlsx', 2026, 10, 1);
`);
const DAY = 24 * 60 * 60 * 1000;
const TODAY = new Date().toISOString().slice(0, 10);
const FUTURE = new Date(Date.now() + 400 * DAY).toISOString().slice(0, 10);
const AFTER_MATURITY = new Date(Date.now() + 401 * DAY).toISOString().slice(0, 10);
const YESTERDAY = new Date(Date.now() - DAY).toISOString().slice(0, 10);
const DAY_BEFORE = new Date(Date.now() - 2 * DAY).toISOString().slice(0, 10);
const idOf = async (nid) => (await db.query(`SELECT id FROM employees_master WHERE national_id=$1`, [nid])).rows[0].id;
const A = await idOf('11111111111111');
const B = await idOf('22222222222222');
const D = await idOf('44444444444444');
const F = await idOf('66666666666666');
const G = await idOf('77777777777777');
const H = await idOf('12121212121212');
const I2 = await idOf('14141414141414');
const logId = (await db.query(`SELECT id FROM import_logs WHERE file_name='EG OCT.xlsx'`)).rows[0].id;
const confirm = async (emp, params) =>
  (await db.query(
    `SELECT public.confirm_account_transfer($1,$2,$3,$4,$5,$6,$7,$8,$9) AS r`,
    [emp, params.to ?? null, params.eff ?? null, params.type ?? 'account_transfer',
     params.reason ?? null, params.notes ?? null, params.by ?? null, params.expected ?? null, params.importId ?? null]
  )).rows[0].r;
const master = async (emp) => (await db.query(`SELECT company_account, account_id, account_employee_uid FROM employees_master WHERE id=$1`, [emp])).rows[0];
const hist = async (emp) => (await db.query(`SELECT *, effective_date::text AS eff_text FROM employee_history WHERE employee_id=$1 ORDER BY created_at ASC`, [emp])).rows;
const resolve = async (emp, asOf) =>
  (await db.query(`SELECT public.resolve_current_company($1, $2::date) AS r`, [emp, asOf])).rows[0].r;
const applyDue = async (emp) => (await db.query(`SELECT public.apply_due_company_transfers($1) AS r`, [emp])).rows[0].r;

// ── T-A: happy transfer — atomic master+history, CANONICAL text, facts kept ─
await db.query(
  `INSERT INTO monthly_payroll_records (import_id, period_year, period_month, national_id, employee_code, employee_name, account_id) VALUES
   ($1, 2026, 10, '11111111111111', '1001', 'موظف أول', 1)`, [logId]);
const payrollBefore = (await db.query(`SELECT row_to_json(t) j FROM (SELECT * FROM monthly_payroll_records WHERE national_id='11111111111111') t`)).rows.map((r) => JSON.stringify(r.j)).sort();

const ra = await confirm(A, { to: 'm.g', eff: YESTERDAY, reason: 'نقل حقيقي', notes: 'ملاحظة اختبار', by: 'hassan', expected: 'E.G', importId: logId });
check('A: transfer accepted', ra.success === true, JSON.stringify(ra));
check('A: applied immediately (effective yesterday)', ra.applied_now === true && ra.scheduled === false && ra.current_company === 'M.G', JSON.stringify({ a: ra.applied_now, s: ra.scheduled, c: ra.current_company }));
const ma = await master(A);
check('A: master stores CANONICAL text (M.G, not client m.g) + regenerated account/UID', ma.company_account === 'M.G' && ma.account_id === 2 && ma.account_employee_uid === 'MG-1001', JSON.stringify(ma));
const ha = await hist(A);
check('A: one account_transfer history row with canonical from/to', ha.length === 1 && ha[0].change_type === 'account_transfer' && ha[0].from_company_account === 'E.G' && ha[0].to_company_account === 'M.G', 'rows=' + ha.length + ' to=' + ha[0]?.to_company_account);
check('A: history carries effective_date (not just created_at)', ha[0].eff_text === YESTERDAY, ha[0].eff_text);
check('A: provenance recorded (confirmed_by + evidence import link)', ha[0].confirmed_by === 'hassan' && ha[0].import_id === logId, JSON.stringify({ by: ha[0].confirmed_by, imp: ha[0].import_id }));
check('A: old_values snapshot preserved', ha[0].old_values?.company_account === 'E.G' && ha[0].old_values?.account_employee_uid === 'EG-1001', JSON.stringify(ha[0].old_values));
const payrollAfter = (await db.query(`SELECT row_to_json(t) j FROM (SELECT * FROM monthly_payroll_records WHERE national_id='11111111111111') t`)).rows.map((r) => JSON.stringify(r.j)).sort();
check('A: old-company payroll row byte-identical after transfer', JSON.stringify(payrollBefore) === JSON.stringify(payrollAfter), '');

// canonical mapping from ANY accepted spelling (Arabic alias here)
const ra2 = await confirm(I2, { to: 'مودرن جاس', eff: YESTERDAY, by: 'hassan' });
check('A2: Arabic alias maps to canonical M.G on master + history', ra2.success === true && (await master(I2)).company_account === 'M.G' && (await hist(I2))[0].to_company_account === 'M.G', JSON.stringify(ra2).slice(0, 140));
// exact-text list filter (the load-bearing read) includes the transferred employee
const listMg = (await db.query(`SELECT count(*)::int c FROM employees_master WHERE company_account='M.G' AND id=$1`, [A])).rows[0].c;
const listMgLower = (await db.query(`SELECT count(*)::int c FROM employees_master WHERE company_account='m.g' AND id=$1`, [A])).rows[0].c;
check('A3: exact-text list filter finds employee under canonical M.G', listMg === 1 && listMgLower === 0, `M.G=${listMg} m.g=${listMgLower}`);

// ── T-B: future effective date REJECTED; ops helper handles raw rows ────────
const rb = await confirm(B, { to: 'E.G', eff: FUTURE, reason: 'نقل مستقبلي', by: 'hassan', expected: 'm.g' });
check('B: future-dated confirmation REJECTED', rb.success === false && rb.error === 'future_effective_date', JSON.stringify(rb));
check('B: rejection wrote no history', (await hist(B)).length === 0, 'rows=' + (await hist(B)).length);
check('B: master snapshot untouched', (await master(B)).company_account === 'm.g', '');
// ops-only helper: a row that landed OUTSIDE the function (legacy/manual)
await db.query(
  `INSERT INTO employee_history (employee_id, change_type, from_company_account, to_company_account, confirmed_by, effective_date) VALUES ($1, 'account_transfer', 'm.g', 'E.G', 'ops', $2)`, [B, FUTURE]);
check('B: resolver keeps pre-transfer state before maturity', (await resolve(B, TODAY)) === 'm.g' && (await resolve(B, AFTER_MATURITY)) === 'E.G', '');
check('B: ops apply_due is a no-op before maturity', (await applyDue(B)).changed === false, '');
await db.query(`UPDATE employee_history SET effective_date=$2 WHERE employee_id=$1`, [B, YESTERDAY]);
const rb2 = await applyDue(B);
check('B: ops apply_due applies a matured row, canonically', rb2.changed === true && (await master(B)).company_account === 'E.G', JSON.stringify(rb2));

// ── T-C: backdated / out-of-order — latest applicable wins, no clobber ──────
await confirm(F, { to: 'm.g', eff: '2026-01-01', by: 'hassan' });
check('F: first transfer applied canonically', (await master(F)).company_account === 'M.G', '');
const rc2 = await confirm(F, { to: 'E.G', eff: '2025-06-01', by: 'hassan' });
check('F: backdated out-of-order event accepted but does NOT clobber current', rc2.success === true && rc2.applied_now === false && (await master(F)).company_account === 'M.G', JSON.stringify(rc2));
const rc3 = await confirm(F, { to: 'E.G', eff: '2026-03-01', by: 'hassan' });
check('F: later effective date wins the snapshot', rc3.applied_now === true && (await master(F)).company_account === 'E.G', JSON.stringify(rc3));
check('F: resolver timeline — E.G in 2025-07, M.G in 2026-02, E.G today',
  (await resolve(F, '2025-07-01')) === 'E.G' && (await resolve(F, '2026-02-01')) === 'M.G' && (await resolve(F, TODAY)) === 'E.G', '');

// ── T-C2: stamp_correction alongside transfer chronology ────────────────────
const rk0 = await confirm(F, { to: 'M.G', type: 'stamp_correction', eff: '2026-05-01', reason: 'إسناد غلط', by: 'hassan' });
check('C2: correction interleaved with transfers wins its effective window', rk0.success === true && (await master(F)).company_account === 'M.G', JSON.stringify(rk0).slice(0, 140));
check('C2: correction is not misread as a transfer in the trail', (await hist(F)).filter((h) => h.change_type === 'stamp_correction').length === 1 && (await hist(F)).filter((h) => h.change_type === 'account_transfer').length === 3, '');
const rk1 = await confirm(F, { to: 'E.G', eff: '2026-06-01', by: 'hassan' });
check('C2: later real transfer wins over earlier correction', rk1.applied_now === true && (await master(F)).company_account === 'E.G', '');

// ── T-D: self-transfer rejected by CANONICAL comparison (variant-proof) ─────
const rd = await confirm(A, { to: 'm.g', eff: TODAY, by: 'hassan' });
check('D: same-account text variant rejected as self_transfer', rd.success === false && rd.error === 'self_transfer', JSON.stringify(rd));
check('D: no history row written on rejection', (await hist(A)).length === 1, 'rows=' + (await hist(A)).length);

// ── T-E: concurrency guard — expected snapshot mismatch ─────────────────────
const re = await confirm(A, { to: 'E.G', eff: TODAY, by: 'hassan', expected: 'E.G' });
check('E: stale-view confirmation rejected (409-shaped)', re.success === false && re.error === 'concurrent_update' && re.actual_current_company === 'M.G', JSON.stringify(re));
check('E: no history row written on concurrency rejection', (await hist(A)).length === 1, 'rows=' + (await hist(A)).length);

// ── T-F: UID collision pre-check — explicit rejection, master untouched ─────
const rf = await confirm(D, { to: 'm.g', eff: YESTERDAY, by: 'hassan' });
check('F: UID collision rejected with candidate named', rf.success === false && rf.error === 'uid_collision' && rf.candidate_uid === 'MG-4004', JSON.stringify(rf));
const md = await master(D);
check('F: master untouched on collision', md.company_account === 'E.G' && md.account_employee_uid === 'EG-4004', JSON.stringify(md));
check('F: no history row written on collision', (await hist(D)).length === 0, '');

// ── T-G/H/I/J: input validation ─────────────────────────────────────────────
check('G: unknown target company rejected', (await confirm(G, { to: 'NOPE', eff: YESTERDAY, by: 'hassan' })).error === 'unknown_company_account', '');
check('H: account_transfer requires effective_date', (await confirm(G, { to: 'm.g', by: 'hassan' })).error === 'effective_date_required', '');
check('I: invalid change_type rejected', (await confirm(G, { to: 'm.g', eff: YESTERDAY, type: 'data_update', by: 'hassan' })).error === 'invalid_change_type', '');
check('J: confirmed_by required (provenance)', (await confirm(G, { to: 'm.g', eff: YESTERDAY })).error === 'confirmed_by_required', '');
check('J: validation failures wrote no history', (await hist(G)).length === 0, '');

// ── T-K/L: stamp_correction — distinct event, canonical, defaults today ─────
const rk = await confirm(G, { to: 'm.g', type: 'stamp_correction', reason: 'تصحيح إسناد خاطئ', notes: 'batch:1315', by: 'hassan' });
check('K: correction accepted without explicit date (defaults today)', rk.success === true && rk.applied_now === true && String(rk.effective_date).startsWith(TODAY), JSON.stringify(rk).slice(0, 180));
const hg = await hist(G);
check('K: correction recorded as stamp_correction with canonical text, NOT a fake transfer', hg.length === 1 && hg[0].change_type === 'stamp_correction' && hg[0].to_company_account === 'M.G', hg[0]?.change_type + ' to=' + hg[0]?.to_company_account);
check('L: correction provenance (reason + batch note + confirmer)', hg[0].confirmed_by === 'hassan' && hg[0].change_reason === 'تصحيح إسناد خاطئ' && hg[0].notes === 'batch:1315', JSON.stringify({ r: hg[0].change_reason, n: hg[0].notes }));
check('L: correction-only history — resolver snapshot after effective date, pre-state fallback before it (NOT an employment claim)',
  (await resolve(G, TODAY)) === 'M.G' && (await resolve(G, DAY_BEFORE)) === 'E.G', '');

// ── T-M: no events — resolver NULL, ops helper a no-op ──────────────────────
check('M: resolver NULL with no events (master stays truth)', (await resolve(D, TODAY)) === null, '');
const rm = await applyDue(D);
check('M: apply_due no-op with no events', rm.changed === false && rm.reason === 'no_due_events', '');

// ── T-N: ops helper — UID collision at apply time fails closed ──────────────
await db.query(
  `INSERT INTO employee_history (employee_id, change_type, from_company_account, to_company_account, confirmed_by, effective_date) VALUES ($1, 'account_transfer', 'E.G', 'M.G', 'ops', $2)`, [H, FUTURE]);
await db.query(`INSERT INTO employees_master (company_account, account_id, national_id, employee_code, employee_name, current_status) VALUES ('m.g', 2, '13131313131313', '7007', 'موظف عاشر', 'Active')`);
await db.query(`UPDATE employee_history SET effective_date=$2 WHERE employee_id=$1`, [H, YESTERDAY]);
const rn = await applyDue(H);
check('N: ops apply blocked by colliding row, fails closed', rn.changed === false && rn.error === 'uid_collision_at_maturity' && rn.candidate_uid === 'MG-7007', JSON.stringify(rn));
check('N: stored snapshot kept on collision', (await master(H)).company_account === 'E.G', (await master(H)).company_account);

await db.end();
await ep.stop();
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
