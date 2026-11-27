'use client';

import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';

type MonthDetail = { month: number; name: string; net: number };
type Preview = {
  employee: {
    code: string; name: string; nid: string; job: string; insJob: string; insWage: number;
    hireDate: string; region: string; department: string; address: string; account: string;
  };
  quarter: string; sector: string; entity: string;
  months: MonthDetail[]; workedMonths: number; average: number; words: string; amount: number; startIso: string;
};

const SECTORS = [
  { id: 'bank', label: 'بنوك' },
  { id: 'consumer', label: 'تمويل استهلاكي' },
  { id: 'installment', label: 'تقسيط' },
  { id: 'gov', label: 'جهة حكومية' },
];

const DEFAULT_ENTITIES: Record<string, string[]> = {
  bank: ['البنك الاهلى', 'البنك الأهلي المصري', 'بنك مصر', 'بنك القاهرة', 'البنك التجاري الدولي (CIB)', 'بنك الإسكندرية', 'البنك العربي الأفريقي الدولي', 'QNB الأهلي', 'بنك SAIB', 'بنك أبوظبي الإسلامي', 'بنك الإمارات دبي الوطني', 'بنك فيصل الإسلامي', 'بنك التعمير والإسكان', 'بنك قناة السويس', 'البنك العقاري المصري العربي', 'بنك HSBC مصر', 'بنك كريدي أجريكول مصر', 'بنك عوده', 'البنك الأهلي الكويتي', 'بنك البركة مصر'],
  consumer: ['فاليو', 'كونتكت', 'سهولة', 'هالان', 'بريميوم كارد', 'بلينك', 'شهري', 'بدايتي', 'أمان', 'فوري', 'درايف', 'جلو سكورب', 'ميد تقسيط', 'رواج'],
  installment: ['فاليو', 'كونتكت', 'سهولة', 'هالان', 'أمان', 'سيمبل', 'بدايتي', 'شهري'],
  gov: ['صندوق الإسكان الاجتماعي ودعم التمويل العقاري', 'بنك ناصر الاجتماعي', 'الإدارة العامة للمرور'],
};

const QUARTERS = [
  { id: 'Q1', label: 'Q1 — يناير إلى مارس' },
  { id: 'Q2', label: 'Q2 — أبريل إلى يونيو' },
  { id: 'Q3', label: 'Q3 — يوليو إلى سبتمبر' },
  { id: 'Q4', label: 'Q4 — أكتوبر إلى ديسمبر' },
];

type PrintedRow = { code: string; name: string; nid: string; entity: string; quarter: string; amount: number; date: string };

const REQUESTS_HEADERS = ['الكود', 'الاسم', 'الرقم القومى ', 'الطلب', 'الحاله', 'التاريخ ', 'المستلم ', 'ملاحضات '];

export default function HrLetterPage() {
  const [nid, setNid] = useState('');
  const [sector, setSector] = useState('bank');
  const [entity, setEntity] = useState(DEFAULT_ENTITIES.bank[0]);
  const [customEntity, setCustomEntity] = useState('');
  const [quarter, setQuarter] = useState('Q3');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [printed, setPrinted] = useState<PrintedRow[]>([]);
  const [customLists, setCustomLists] = useState<Record<string, string[]>>({});

  useEffect(() => {
    try {
      setPrinted(JSON.parse(localStorage.getItem('hr-letter-printed') || '[]'));
      setCustomLists(JSON.parse(localStorage.getItem('hr-letter-entities') || '{}'));
    } catch { /* ignore */ }
  }, []);

  const entities = useMemo(
    () => [...(DEFAULT_ENTITIES[sector] || []), ...(customLists[sector] || [])],
    [sector, customLists],
  );

  const effectiveEntity = entity === '__custom__' ? customEntity.trim() : entity;

  async function load(n: string, s: string, e: string, q: string) {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/hr-letter?nid=${encodeURIComponent(n)}&sector=${s}&entity=${encodeURIComponent(e)}&quarter=${q}`);
      const data = await res.json();
      if (!res.ok) { setPreview(null); setError(data.error || 'حصل خطأ'); return; }
      setPreview(data);
    } catch {
      setError('مشكلة في الاتصال');
    } finally {
      setLoading(false);
    }
  }

  function search() { if (nid.trim()) load(nid.trim(), sector, effectiveEntity, quarter); }
  function reselect(nextSector: string, nextEntity: string, nextQuarter: string) {
    setSector(nextSector); setEntity(nextEntity); setQuarter(nextQuarter);
    if (preview) load(nid.trim(), nextSector, nextEntity === '__custom__' ? customEntity.trim() : nextEntity, nextQuarter);
  }

  function printWord() {
    if (!preview || !effectiveEntity) return;
    const url = `/api/hr-letter?nid=${encodeURIComponent(nid.trim())}&sector=${sector}&entity=${encodeURIComponent(effectiveEntity)}&quarter=${quarter}&download=docx`;
    window.location.href = url;
  }

  function addToExcel() {
    if (!preview || !effectiveEntity) return;
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
    const row: PrintedRow = {
      code: preview.employee.code, name: preview.employee.name, nid: preview.employee.nid,
      entity: effectiveEntity, quarter, amount: preview.amount, date: today,
    };
    const next = [...printed.filter((r) => !(r.nid === row.nid && r.entity === row.entity)), row];
    setPrinted(next);
    localStorage.setItem('hr-letter-printed', JSON.stringify(next));
  }

  function removeRow(i: number) {
    const next = printed.filter((_, idx) => idx !== i);
    setPrinted(next);
    localStorage.setItem('hr-letter-printed', JSON.stringify(next));
  }

  function exportExcel() {
    const rows = printed.map((r) => ({
      [REQUESTS_HEADERS[0]]: r.code, [REQUESTS_HEADERS[1]]: r.name, [REQUESTS_HEADERS[2]]: r.nid,
      [REQUESTS_HEADERS[3]]: 'مفردات مرتب', [REQUESTS_HEADERS[4]]: '', [REQUESTS_HEADERS[5]]: r.date,
      [REQUESTS_HEADERS[6]]: '', [REQUESTS_HEADERS[7]]: `${r.entity} — ${r.quarter} — ${r.amount.toLocaleString('en-US')}`,
    }));
    const ws = XLSX.utils.json_to_sheet(rows, { header: REQUESTS_HEADERS });
    ws['!cols'] = [{ wch: 10 }, { wch: 34 }, { wch: 18 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 46 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'مفردات مرتب');
    XLSX.writeFile(wb, 'hr-letters.xlsx');
  }

  function saveCustomEntity() {
    const v = customEntity.trim();
    if (!v) return;
    const next = { ...customLists, [sector]: [...(customLists[sector] || []), v] };
    setCustomLists(next);
    localStorage.setItem('hr-letter-entities', JSON.stringify(next));
    setEntity(v);
    setCustomEntity('');
  }

  const inputCls = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white';
  const labelCls = 'block text-[13px] font-semibold text-slate-600 mb-1 mt-3';

  return (
    <div dir="rtl" className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-xl font-bold text-slate-900 mb-4">مفردات مرتب</h1>

      <div className="rounded-xl border border-slate-200 bg-white p-5 mb-4 shadow-sm">
        <h2 className="text-[15px] font-bold text-slate-800 mb-2">١) الموظف</h2>
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className={labelCls}>الرقم القومي</label>
            <input className={inputCls} value={nid} maxLength={14} inputMode="numeric"
              onChange={(e) => setNid(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && search()} placeholder="١٤ رقم" />
          </div>
          <button onClick={search} disabled={loading || nid.length !== 14}
            className="rounded-lg bg-slate-900 px-6 py-2 text-sm font-bold text-white disabled:opacity-40">
            {loading ? '...' : 'بحث'}
          </button>
        </div>
        {error && <div className="mt-3 rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-800">{error}</div>}
        {preview && (
          <div className="mt-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm leading-7">
            <b>{preview.employee.name}</b> — كود: {preview.employee.code}
            {preview.employee.account && <span className="mr-2 rounded-full bg-green-100 px-3 py-0.5 text-xs font-bold text-green-800">{preview.employee.account}</span>}
            <br />
            الوظيفة (المرتبات): <b>{preview.employee.job || '—'}</b>
            {preview.employee.insJob && <> &nbsp;|&nbsp; الوظيفة في التأمينات: <b>{preview.employee.insJob}</b></>}
            <br />
            تاريخ التعيين: {preview.employee.hireDate || '—'} &nbsp;|&nbsp; المنطقة: {preview.employee.region || '—'} &nbsp;|&nbsp; الإدارة: {preview.employee.department || '—'}
          </div>
        )}
      </div>

      {preview && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 mb-4 shadow-sm">
          <h2 className="text-[15px] font-bold text-slate-800 mb-2">٢) الجهة والفترة</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>القطاع</label>
              <select className={inputCls} value={sector}
                onChange={(e) => { const s = e.target.value; setEntity((DEFAULT_ENTITIES[s] || [])[0] || ''); reselect(s, (DEFAULT_ENTITIES[s] || [])[0] || '', quarter); }}>
                {SECTORS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>الجهة</label>
              <select className={inputCls} value={entity} onChange={(e) => reselect(sector, e.target.value, quarter)}>
                {entities.map((en) => <option key={en} value={en}>{en}</option>)}
                <option value="__custom__">أخرى… (كتابة يدوية)</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>الربع (٢٠٢٦)</label>
              <select className={inputCls} value={quarter} onChange={(e) => reselect(sector, entity, e.target.value)}>
                {QUARTERS.map((q) => <option key={q.id} value={q.id}>{q.label}</option>)}
              </select>
            </div>
          </div>
          {entity === '__custom__' && (
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <label className={labelCls}>اسم الجهة</label>
                <input className={inputCls} value={customEntity} onChange={(e) => setCustomEntity(e.target.value)} />
              </div>
              <button onClick={saveCustomEntity} className="rounded-lg bg-slate-200 px-4 py-2 text-sm font-bold text-slate-800">حفظ في القايمة</button>
            </div>
          )}
          {sector === 'gov' && (
            <p className="mt-2 text-xs text-slate-500">جهة حكومية: الوظيفة والمبلغ بيتسحبوا من بيانات التأمينات الرسمية.</p>
          )}
        </div>
      )}

      {preview && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 mb-4 shadow-sm">
          <h2 className="text-[15px] font-bold text-slate-800 mb-2">٣) النتيجة</h2>
          <div className="rounded-lg border border-amber-400 bg-amber-50 px-4 py-3 text-[15px] leading-8">
            {sector === 'gov' ? (
              <>الأجر التأميني: <span className="text-xl font-extrabold text-amber-700">{preview.amount.toLocaleString('en-US')} جنيه</span></>
            ) : (
              <>
                صافي التحويل: {preview.months.filter((m) => m.net > 0).map((m) => `${m.name} ${m.net.toLocaleString('en-US')}`).join(' + ')}
                {' → '}المتوسط ({preview.workedMonths === 3 ? '٣ شهور' : preview.workedMonths === 2 ? 'شهرين' : 'شهر واحد'} عمل):
                <span className="text-xl font-extrabold text-amber-700"> {preview.amount.toLocaleString('en-US')} جنيه</span>
              </>
            )}
            <br />التفقيط: <b>فقط {preview.words} جنيها مصري لا غير</b>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button onClick={printWord} disabled={!effectiveEntity}
              className="rounded-lg bg-slate-900 px-5 py-2 text-sm font-bold text-white disabled:opacity-40">طباعة وورد</button>
            <button onClick={addToExcel} disabled={!effectiveEntity}
              className="rounded-lg bg-slate-200 px-5 py-2 text-sm font-bold text-slate-800 disabled:opacity-40">إضافة لملف الإكسل</button>
            <button onClick={exportExcel} disabled={!printed.length}
              className="rounded-lg bg-slate-200 px-5 py-2 text-sm font-bold text-slate-800 disabled:opacity-40">
              تصدير إكسل{printed.length ? ` (${printed.length})` : ''}
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-500">الطباعة بتنزل ملف وورد: الوش الخطاب، والضهر الأبيض عليه سطر خفيف فيه المحافظة والمنطقة والإدارة وتاريخ الطباعة والأكونت. الإكسل بنفس أعمدة شيت الطلبات.</p>
        </div>
      )}

      {printed.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-[15px] font-bold text-slate-800 mb-2">قايمة المطبوع ({printed.length})</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-500 text-xs">
                <th className="text-right py-1">الاسم</th><th className="text-right">الجهة</th><th className="text-right">الربع</th><th></th>
              </tr>
            </thead>
            <tbody>
              {printed.map((r, i) => (
                <tr key={r.nid + r.entity} className="border-t border-slate-100">
                  <td className="py-1.5">{r.name}</td>
                  <td>{r.entity}</td>
                  <td>{r.quarter}</td>
                  <td><button onClick={() => removeRow(i)} className="text-red-500 text-xs">حذف</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
