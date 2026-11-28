'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import * as XLSX from 'xlsx';
import { Search, Printer, FileSpreadsheet, Plus, Trash2, Landmark } from 'lucide-react';

type MonthDetail = { month: number; name: string; net: number };
type Preview = {
  employee: {
    code: string; name: string; nid: string; job: string; insJob: string; insWage: number;
    hireDate: string; region: string; department: string; address: string; account: string;
  };
  quarter: string; sector: string; entity: string;
  months: MonthDetail[]; workedMonths: number; average: number; words: string; amount: number; startIso: string;
  warning?: string;
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

const card: CSSProperties = {
  background: 'rgba(255,255,255,0.025)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 18,
  padding: 20,
  marginBottom: 16,
};
const h2style: CSSProperties = { fontSize: 15, fontWeight: 800, color: '#f1f5f9', margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 8 };
const labelStyle: CSSProperties = { display: 'block', fontSize: 12, fontWeight: 700, color: '#94a3b8', marginBottom: 6 };
const inputStyle: CSSProperties = {
  width: '100%', padding: '11px 14px', borderRadius: 12,
  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
  color: '#f1f5f9', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
};
const selectStyle: CSSProperties = { ...inputStyle, padding: '10px 12px' };
const optionStyle: CSSProperties = { background: '#0f172a' };
const primaryBtn = (disabled: boolean): CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '11px 18px', borderRadius: 12, border: '1px solid #6366f1',
  background: disabled ? 'rgba(79,70,229,0.4)' : '#4f46e5',
  color: '#ffffff', fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
  cursor: disabled ? 'not-allowed' : 'pointer',
});
const secondaryBtn = (disabled: boolean): CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '11px 16px', borderRadius: 12,
  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
  color: disabled ? '#475569' : '#cbd5e1', fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
  cursor: disabled ? 'not-allowed' : 'pointer',
});

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

  return (
    <div dir="rtl" style={{ maxWidth: 860, margin: '0 auto', padding: '28px 20px 60px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <h1 style={{ fontSize: 22, fontWeight: 900, color: '#f1f5f9', margin: 0 }}>مفردات مرتب</h1>
        <span style={{ padding: '3px 10px', borderRadius: 9999, fontSize: 12, fontWeight: 700, background: 'rgba(99,102,241,0.15)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)' }}>
          خطاب رسمي بصيغة وورد
        </span>
      </div>
      <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 20px' }}>
        خطاب مفردات المرتب لموظف بالرقم القومي: بنوك، تمويل استهلاكي، تقسيط، أو جهة حكومية — مع تصدير إكسل بنفس أعمدة شيت الطلبات.
      </p>

      {/* 1) Employee */}
      <div style={card}>
        <h2 style={h2style}><Search style={{ width: 15, height: 15, color: '#818cf8' }} /> ١) الموظف</h2>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <label style={labelStyle}>الرقم القومي</label>
            <input style={inputStyle} value={nid} maxLength={14} inputMode="numeric"
              onChange={(e) => setNid(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && search()} placeholder="١٤ رقم" />
          </div>
          <button onClick={search} disabled={loading || nid.length !== 14} style={primaryBtn(loading || nid.length !== 14)}>
            <Search style={{ width: 14, height: 14 }} />
            {loading ? 'جاري البحث…' : 'بحث'}
          </button>
        </div>
        {error && (
          <div style={{ marginTop: 12, borderRadius: 12, border: '1px solid rgba(248,113,113,0.35)', background: 'rgba(248,113,113,0.08)', padding: '10px 14px', fontSize: 13, color: '#fca5a5' }}>
            {error}
          </div>
        )}
        {preview && (
          <div style={{ marginTop: 12, borderRadius: 12, border: '1px dashed rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.03)', padding: '12px 14px', fontSize: 13, lineHeight: 2, color: '#cbd5e1' }}>
            <b style={{ color: '#f1f5f9' }}>{preview.employee.name}</b>
            <span style={{ color: '#94a3b8' }}> — كود: {preview.employee.code}</span>
            {preview.employee.account && (
              <span style={{ marginRight: 8, borderRadius: 9999, padding: '2px 10px', fontSize: 11, fontWeight: 700, background: 'rgba(52,211,153,0.15)', color: '#34d399', border: '1px solid rgba(52,211,153,0.3)' }}>
                {preview.employee.account}
              </span>
            )}
            <br />
            الوظيفة (المرتبات): <b style={{ color: '#f1f5f9' }}>{preview.employee.job || '—'}</b>
            {preview.employee.insJob && <> &nbsp;|&nbsp; الوظيفة في التأمينات: <b style={{ color: '#f1f5f9' }}>{preview.employee.insJob}</b></>}
            <br />
            <span style={{ color: '#94a3b8' }}>تاريخ التعيين:</span> {preview.employee.hireDate || '—'}
            <span style={{ color: '#94a3b8' }}> &nbsp;|&nbsp; المنطقة:</span> {preview.employee.region || '—'}
            <span style={{ color: '#94a3b8' }}> &nbsp;|&nbsp; الإدارة:</span> {preview.employee.department || '—'}
          </div>
        )}
      </div>

      {/* 2) Entity & period */}
      {preview && (
        <div style={card}>
          <h2 style={h2style}><Landmark style={{ width: 15, height: 15, color: '#818cf8' }} /> ٢) الجهة والفترة</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <div>
              <label style={labelStyle}>القطاع</label>
              <select style={selectStyle} value={sector}
                onChange={(e) => { const s = e.target.value; setEntity((DEFAULT_ENTITIES[s] || [])[0] || ''); reselect(s, (DEFAULT_ENTITIES[s] || [])[0] || '', quarter); }}>
                {SECTORS.map((s) => <option key={s.id} value={s.id} style={optionStyle}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>الجهة</label>
              <select style={selectStyle} value={entity} onChange={(e) => reselect(sector, e.target.value, quarter)}>
                {entities.map((en) => <option key={en} value={en} style={optionStyle}>{en}</option>)}
                <option value="__custom__" style={optionStyle}>أخرى… (كتابة يدوية)</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>الربع (٢٠٢٦)</label>
              <select style={selectStyle} value={quarter} onChange={(e) => reselect(sector, entity, e.target.value)}>
                {QUARTERS.map((q) => <option key={q.id} value={q.id} style={optionStyle}>{q.label}</option>)}
              </select>
            </div>
          </div>
          {entity === '__custom__' && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginTop: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 240 }}>
                <label style={labelStyle}>اسم الجهة</label>
                <input style={inputStyle} value={customEntity} onChange={(e) => setCustomEntity(e.target.value)} />
              </div>
              <button onClick={saveCustomEntity} style={secondaryBtn(false)}>
                <Plus style={{ width: 14, height: 14 }} />
                حفظ في القايمة
              </button>
            </div>
          )}
          {sector === 'gov' && (
            <p style={{ marginTop: 10, fontSize: 12, color: '#64748b', margin: '10px 0 0' }}>
              جهة حكومية: الوظيفة والمبلغ بيتسحبوا من بيانات التأمينات الرسمية.
            </p>
          )}
        </div>
      )}

      {/* 3) Result */}
      {preview && (
        <div style={card}>
          <h2 style={h2style}><FileSpreadsheet style={{ width: 15, height: 15, color: '#818cf8' }} /> ٣) النتيجة</h2>
          <div style={{ borderRadius: 12, border: '1px solid rgba(251,191,36,0.3)', background: 'rgba(251,191,36,0.07)', padding: '12px 14px', fontSize: 14, lineHeight: 2.1, color: '#e2e8f0' }}>
            {sector === 'gov' ? (
              <>الأجر التأميني: <span style={{ fontSize: 19, fontWeight: 900, color: '#fbbf24' }}>{preview.amount.toLocaleString('en-US')} جنيه</span></>
            ) : (
              <>
                صافي التحويل: {preview.months.filter((m) => m.net > 0).map((m) => `${m.name} ${m.net.toLocaleString('en-US')}`).join(' + ')}
                {' → '}المتوسط ({preview.workedMonths === 3 ? '٣ شهور' : preview.workedMonths === 2 ? 'شهرين' : 'شهر واحد'} عمل):
                <span style={{ fontSize: 19, fontWeight: 900, color: '#fbbf24' }}> {preview.amount.toLocaleString('en-US')} جنيه</span>
              </>
            )}
            <br />التفقيط: <b style={{ color: '#f1f5f9' }}>فقط {preview.words} جنيها مصري لا غير</b>
          </div>
          {preview.warning && (
            <div style={{ marginTop: 10, borderRadius: 12, border: '1px solid rgba(248,113,113,0.35)', background: 'rgba(248,113,113,0.08)', padding: '10px 14px', fontSize: 13, color: '#fca5a5' }}>
              {preview.warning}
            </div>
          )}
          <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button onClick={printWord} disabled={!effectiveEntity} style={primaryBtn(!effectiveEntity)}>
              <Printer style={{ width: 14, height: 14 }} />
              طباعة وورد
            </button>
            <button onClick={addToExcel} disabled={!effectiveEntity} style={secondaryBtn(!effectiveEntity)}>
              <Plus style={{ width: 14, height: 14 }} />
              إضافة لملف الإكسل
            </button>
            <button onClick={exportExcel} disabled={!printed.length} style={secondaryBtn(!printed.length)}>
              <FileSpreadsheet style={{ width: 14, height: 14 }} />
              تصدير إكسل{printed.length ? ` (${printed.length})` : ''}
            </button>
          </div>
          <p style={{ fontSize: 12, color: '#64748b', margin: '10px 0 0' }}>
            الطباعة بتنزل ملف وورد: الوش الخطاب، والضهر الأبيض عليه سطر خفيف فيه المحافظة والمنطقة والإدارة وتاريخ الطباعة والأكونت. الإكسل بنفس أعمدة شيت الطلبات.
          </p>
        </div>
      )}

      {/* Printed list */}
      {printed.length > 0 && (
        <div style={card}>
          <h2 style={h2style}><FileSpreadsheet style={{ width: 15, height: 15, color: '#34d399' }} /> قايمة المطبوع ({printed.length})</h2>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', color: '#cbd5e1' }}>
            <thead>
              <tr style={{ color: '#64748b', fontSize: 12 }}>
                <th style={{ textAlign: 'right', padding: '6px 4px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>الاسم</th>
                <th style={{ textAlign: 'right', padding: '6px 4px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>الجهة</th>
                <th style={{ textAlign: 'right', padding: '6px 4px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>الربع</th>
                <th style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}></th>
              </tr>
            </thead>
            <tbody>
              {printed.map((r, i) => (
                <tr key={r.nid + r.entity}>
                  <td style={{ padding: '8px 4px', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#f1f5f9' }}>{r.name}</td>
                  <td style={{ padding: '8px 4px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>{r.entity}</td>
                  <td style={{ padding: '8px 4px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>{r.quarter}</td>
                  <td style={{ padding: '8px 4px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <button onClick={() => removeRow(i)}
                      style={{ background: 'none', border: 'none', color: '#f87171', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: 'inherit' }}>
                      <Trash2 style={{ width: 12, height: 12 }} />
                      حذف
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
