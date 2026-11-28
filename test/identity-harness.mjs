// Identity / import harness against a LOCAL copy of the data (no production access).
// Real importer code -> supabase-js -> local PostgREST (max-rows=1000, like Supabase) -> local Postgres.
import { spawn, execSync } from 'child_process';
import http from 'http';
import { readFileSync } from 'fs';
import pg from 'pg';
import * as XLSX from 'xlsx';

const SVC = readFileSync('/tmp/h/svc.jwt', 'utf8').trim();
const ANON = readFileSync('/tmp/h/anon.jwt', 'utf8').trim();
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:3012';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON;
process.env.SUPABASE_SERVICE_ROLE_KEY = SVC;

const MODE = process.argv[2] || 'new';           // 'old' | 'new'
const only = process.argv[3];
const sis = await import(MODE === 'old' ? '../lib/smartImportService.old.ts' : '../lib/smartImportService.ts');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const resetDb = async () => { execSync('/tmp/mkbase.sh', { stdio: 'pipe' }); };
await resetDb();
const pr = spawn('/tmp/pgr/postgrest', ['/tmp/h/pgrst.conf'], { stdio: 'ignore' });
http.createServer((req, res) => {
  const u = req.url.replace(/^\/rest\/v1/, '');
  const p = http.request({ host: '127.0.0.1', port: 3011, path: u, method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  req.pipe(p); p.on('error', () => { res.statusCode = 502; res.end(); });
}).listen(3012);
await sleep(2500);
const db = new pg.Client({ host: '127.0.0.1', port: 5433, user: 'postgres', database: 't' });
let db2;
const connect = async () => { db2 = new pg.Client({ host: '127.0.0.1', port: 5433, user: 'postgres', database: 't' }); await db2.connect(); return db2; };
let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '   [' + extra + ']' : ''}`); if (!ok) fails++; };
const q = async (sql, params) => (await db2.query(sql, params)).rows;

const rest = await fetch('http://127.0.0.1:3012/rest/v1/employees_master?select=id', { headers: { apikey: SVC, Authorization: 'Bearer ' + SVC, Prefer: 'count=exact' } });
console.log('API read of all employees returns', (await rest.json()).length, 'rows, content-range', rest.headers.get('content-range'));

const HEAD = ['الكود', 'الاسم', 'الرقم القومى', 'الوظيفه', 'المنطقه', 'الاداره'];
function wb(rows, extraHeader) {
  const head = extraHeader ? [...HEAD, extraHeader.name] : HEAD;
  const aoa = [head, ...rows.map((r) => extraHeader ? [r.code, r.name, r.nid, r.job || 'مهندس', r.region || 'القاهرة', r.dept || 'ادارة', r.pno || ''] : [r.code, r.name, r.nid, r.job || 'مهندس', r.region || 'القاهرة', r.dept || 'ادارة'])];
  const w = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(w, XLSX.utils.aoa_to_sheet(aoa), 'Database');
  return w;
}
const run = async (rows, acc = 'E.G', accId = 1, extraHeader) => {
  const r = await sis.importMultiSheetExcel(acc, wb(rows, extraHeader), ['Database'], 'test.xlsx', accId);
  return r['Database'];
};
const allRows = async () => (await q(`select employee_code code, employee_name name, national_id nid, current_job_title job, person_uid, operating_no from employees_master where account_id=1 order by national_id`)).filter((r) => /^\d{14}$/.test(r.nid || ''));

const summary = (r) => `ok=${r.success} new=${r.new_employees} upd=${r.updated_employees} skipped=${r.skipped_rows} errors=${r.errors.length}`;
const T = {};

T.t1 = async () => {
  console.log('\n== T1: re-upload of the SAME full sheet (6320+ real employees, nothing changed)');
  const rows = await allRows();
  const before = (await q(`select count(*) c, count(distinct person_uid) p from employees_master`))[0];
  const res = await run(rows);
  const after = (await q(`select count(*) c, count(distinct person_uid) p, min(operating_no) a, max(operating_no) b from employees_master`))[0];
  console.log('result:', summary(res), res.errors.slice(0, 2).map((e) => e.slice(0, 140)));
  console.log('employees before', before.c, 'after', after.c, 'persons', after.p);
  check('no new employees created, none lost', Number(after.c) === Number(before.c) && res.new_employees === 0, `${before.c} -> ${after.c}`);
  check('every employee updated, no errors', res.updated_employees === rows.length && res.errors.length === 0, `updated ${res.updated_employees}/${rows.length}`);
};
T.t2 = async () => {
  console.log('\n== T2: corrected name, corrected code, same NID');
  const rows = await allRows(); const a = rows[10], b = rows[20];
  const bef = { a: a.operating_no, b: b.operating_no, ap: a.person_uid, bp: b.person_uid };
  const res = await run([{ ...a, name: a.name + ' (مصحح)' }, { ...b, code: '99' + b.code }]);
  console.log('result:', summary(res), res.errors.map((e) => e.slice(0, 160)));
  const ra = (await q(`select * from employees_master where national_id=$1`, [a.nid]))[0];
  const rb = (await q(`select * from employees_master where national_id=$1`, [b.nid]))[0];
  check('name corrected, person+number unchanged', ra.employee_name.endsWith('(مصحح)') && ra.person_uid === bef.ap && ra.operating_no === bef.a, `${ra.person_uid} ${ra.operating_no}`);
  check('code changed, person+number unchanged', rb.employee_code === '99' + b.code && rb.person_uid === bef.bp && rb.operating_no === bef.b, `${rb.employee_code} ${rb.person_uid} ${rb.operating_no}`);
  const ids = await q(`select kind,value,is_current,reason from person_identifiers where person_id=$1 order by valid_from`, [rb.person_id]);
  console.log('identity history of that person:', JSON.stringify(ids));
  check('old code kept as history', ids.some((i) => i.kind === 'employee_code' && !i.is_current && i.value === b.code) && ids.some((i) => i.kind === 'employee_code' && i.is_current && i.value === '99' + b.code));
  check('employees total unchanged', Number((await q(`select count(*) c from employees_master`))[0].c) === 6322);
};
T.t3 = async () => {
  console.log('\n== T3: corrected NID, sheet has NO permanent number -> must not make a duplicate person');
  const rows = await allRows(); const a = rows[30];
  const newNid = '2' + a.nid.slice(1, 13) + (a.nid[13] === '9' ? '8' : String(Number(a.nid[13]) + 1));
  const res = await run([{ ...a, nid: newNid }]);
  console.log('result:', summary(res)); res.errors.forEach((e) => console.log('  msg:', e.slice(0, 330)));
  const c = (await q(`select count(*) c from employees_master`))[0].c;
  check('no duplicate created, row stopped with a clear message', Number(c) === 6322 && res.new_employees === 0 && res.errors.length === 1);
};
T.t4 = async () => {
  console.log('\n== T4: corrected NID WITH the permanent number column -> same person, history kept');
  const rows = await allRows(); const a = rows[30];
  const newNid = '2' + a.nid.slice(1, 13) + (a.nid[13] === '9' ? '8' : String(Number(a.nid[13]) + 1));
  const res = await run([{ ...a, nid: newNid, pno: a.person_uid }], 'E.G', 1, { name: 'الرقم الموحد' });
  console.log('result:', summary(res), res.warnings || []);
  const r = (await q(`select * from employees_master where person_uid=$1`, [a.person_uid]))[0];
  const ids = await q(`select kind,value,is_current,reason from person_identifiers where person_id=$1 and kind='national_id' order by valid_from`, [r.person_id]);
  console.log('NID history:', JSON.stringify(ids));
  check('same person, same numbers, new NID', r.national_id === newNid && r.operating_no === a.operating_no && Number((await q(`select count(*) c from employees_master`))[0].c) === 6322);
  check('old NID kept as history (not current)', ids.length === 2 && ids[0].value === a.nid && !ids[0].is_current && ids[1].is_current);
  const h = await q(`select change_type from employee_history where employee_id=$1 and change_type='identity_change'`, [r.id]);
  check('audit row written', h.length === 1);
  const wrong = await run([{ ...rows[40], nid: rows[41].nid, pno: rows[40].person_uid }], 'E.G', 1, { name: 'الرقم الموحد' });
  check('number pointing to a different person than the NID is refused', wrong.errors.length === 1 && wrong.updated_employees === 0, (wrong.errors[0] || '').slice(0, 120));
  const unk = await run([{ ...rows[50], pno: 'P-9999999' }], 'E.G', 1, { name: 'الرقم الموحد' });
  check('unknown permanent number is refused', unk.errors.length === 1 && unk.updated_employees === 0);
};
T.t5 = async () => {
  console.log('\n== T5: move EG -> MG -> back to EG; leave and return with a new code');
  const rows = await allRows(); const a = rows[60];
  const mv = (await q(`select confirm_account_transfer($1,'M.G',current_date,'account_transfer','test move',null,'test',null,null) r`, [(await q(`select id from employees_master where national_id=$1`, [a.nid]))[0].id]))[0].r;
  const m = (await q(`select * from employees_master where national_id=$1`, [a.nid]))[0];
  console.log('after move:', mv.success, m.company_account, m.person_uid, m.operating_no);
  // the transfer RPC updates company_account only; account_id comes from the resolve trigger
  check('same person, new MG number (first MG number)', mv.success && m.person_uid === a.person_uid && m.operating_no === 'MG-000001', m.operating_no);
  await q(`select confirm_account_transfer($1,'E.G',current_date,'account_transfer','back',null,'test',null,null)`, [m.id]);
  const b = (await q(`select * from employees_master where national_id=$1`, [a.nid]))[0];
  check('back in EG: SAME EG number as before', b.operating_no === a.operating_no && b.person_uid === a.person_uid, b.operating_no);
  const nums = await q(`select a.account_code, n.operating_no from person_account_numbers n join company_accounts a on a.id=n.account_id where person_id=$1 order by 1`, [b.person_id]);
  console.log('numbers this person holds:', JSON.stringify(nums));
  // leave and return with a new code via re-upload
  await q(`update employees_master set current_status='Not Active' where id=$1`, [b.id]);
  const res = await run([{ ...rows[60], code: '7' + a.code }]);
  const c = (await q(`select * from employees_master where national_id=$1`, [a.nid]))[0];
  check('returns with new code: same person, same number, one row', c.person_uid === a.person_uid && c.operating_no === a.operating_no && c.employee_code === '7' + a.code && res.new_employees === 0, `${c.employee_code} ${c.person_uid} ${c.operating_no}`);
};
T.t6 = async () => {
  console.log('\n== T6: duplicate rows inside one sheet; new people in every account; sequential numbering');
  const rows = await allRows(); const x = { code: '880001', name: 'موظف جديد اختبار', nid: '29901010101011' };
  const res = await run([x, x]);
  console.log('result:', summary(res), res.warnings || []);
  const r = await q(`select person_uid, operating_no from employees_master where national_id='29901010101011'`);
  check('duplicate rows in sheet -> exactly one employee', r.length === 1, JSON.stringify(r));
  check('next numbers are the next in sequence (P-0006323 / EG-006323)', r[0].person_uid === 'P-0006323' && r[0].operating_no === 'EG-006323');
  const outs = [];
  for (const [acc, id, code, nid] of [['M.G', 2, '1', '29901010101012'], ['GASCO', 3, '1', '29901010101013'], ['DMC', 4, '1', '29901010101014'], ['M.G', 2, '2', '29901010101015']]) {
    const res2 = await run([{ code, name: 'اختبار ' + acc + code, nid }], acc, id);
    outs.push(JSON.stringify((await q(`select operating_no from employees_master where national_id=$1`, [nid]))[0]) + (res2.errors.length ? ' ERR ' + res2.errors[0].slice(0, 80) : ''));
  }
  console.log(outs.join(' | '));
  check('each account counts on its own: MG-000001, GASCO-000001, DMC-000001, MG-000002', outs[0].includes('MG-000001') && outs[1].includes('GASCO-000001') && outs[2].includes('DMC-000001') && outs[3].includes('MG-000002'));
};
T.t7 = async () => {
  console.log('\n== T7: 30 inserts at the same moment (race) and a failed insert');
  const before = (await q(`select last_seq from number_counters where scope='PERSON'`))[0].last_seq;
  const pool = [];
  for (let i = 0; i < 30; i++) { const c = new pg.Client({ host: '127.0.0.1', port: 5433, user: 'postgres', database: 't' }); await c.connect(); pool.push(c); }
  await Promise.all(pool.map((c, i) => c.query(`insert into employees_master(company_account, employee_code, national_id, employee_name) values ('E.G', $1, $2, 'سباق')`, ['77' + i, '2990202020' + String(1000 + i)])));
  const rs = await q(`select person_uid, operating_no from employees_master where employee_name='سباق' order by person_uid`);
  const seqs = rs.map((r) => Number(r.person_uid.slice(2))).sort((a, b) => a - b);
  const consecutive = seqs.every((v, i) => v === Number(before) + 1 + i);
  check('30 parallel inserts -> 30 distinct, consecutive numbers, no gaps', rs.length === 30 && new Set(rs.map((r) => r.operating_no)).size === 30 && consecutive, `${seqs[0]}..${seqs[29]}`);
  let err = null; try { await q(`insert into employees_master(company_account, employee_code, national_id, employee_name) values ('E.G','77','29902020201000','مكرر')`); } catch (e) { err = e.message; }
  const after = (await q(`select last_seq from number_counters where scope='PERSON'`))[0].last_seq;
  check('failed insert burns no number', !!err && Number(after) === Number(before) + 30, err);
  pool.forEach((c) => c.end());
};

await connect();
const order = only ? [only] : ['t1', 't2', 't3', 't4', 't5', 't6', 't7'];
for (const k of order) {
  if (k !== order[0]) { await db2.end(); await resetDb(); await sleep(500); await connect(); }
  try { await T[k](); } catch (e) { console.log('ERROR in', k, e.message); fails++; }
}
console.log('\nTOTAL FAILS:', fails);
await db2.end(); pr.kill(); process.exit(fails ? 1 : 0);
