'use client';

// ═══════════════════════════════════════════════════════════════════════════
// TEST PREVIEW ONLY — synthetic fixture data, no database, no real employees.
// Renders the changed UI sections (import context controls + source-separated
// status fields + conflict banner) for screenshot review. Must be removed or
// gated before any production publish.
// ═══════════════════════════════════════════════════════════════════════════

import { useState } from 'react';
import { Calendar, AlertTriangle } from 'lucide-react';

const FIXTURE_ACCOUNTS = [
  { id: 1, account_code: 'EG', account_name: 'شركة غاز مصر (Egypt Gas)' },
  { id: 2, account_code: 'MG', account_name: 'شركة مودرن جاس (Modern Gas)' },
];

const FIXTURE_FIELDS = [
  { icon: '🗂️', label: 'حالة وارد التأمين (مصدره)', value: 'Active', color: '#e2e8f0' },
  { icon: '🛡️', label: 'الحالة التأمينية (وارد)', value: 'مؤمن عليه', color: '#c4b5fd' },
  { icon: '📇', label: 'حالة الدليل (Database)', value: 'Not Active', color: '#fda4af' },
  { icon: '📇', label: 'التأمين في الدليل', value: 'غير مؤمن', color: '#fda4af' },
];

const FIXTURE_CONFLICTS = [
  'تعارض حالة: يوجد 1 سجل استقالة بينما حالة وارد التأمين "Active" — يحتاج مراجعة',
  'تعارض حالة: حالة الدليل "Not Active" بينما حالة وارد التأمين "Active" — يحتاج مراجعة',
  '3 سجل مرتبات شهري للموظف بلا حساب مؤكد — أُقصيت من العرض وتحتاج مراجعة',
];

export default function TestPreviewPage() {
  const [selectedAccount, setSelectedAccount] = useState('');
  const [periodMonth, setPeriodMonth] = useState<number | null>(null);
  const [periodYear, setPeriodYear] = useState<number | null>(null);
  const monthlyContextMissing = !selectedAccount || !periodYear || !periodMonth;

  return (
    <div dir="rtl" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 900, margin: '0 auto' }}>
      <h1 style={{ fontSize: 16, color: '#f1f5f9' }}>معاينة اختبار — بيانات synthetic فقط</h1>

      {/* ── Import context controls (new: explicit account + period, no defaults) ── */}
      <div style={{ padding: '1rem 1.25rem', borderRadius: 16, background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Calendar style={{ width: 18, height: 18, color: '#818cf8' }} />
          <div>
            <p style={{ fontSize: 12, fontWeight: 700, color: '#f1f5f9', margin: 0 }}>حساب وفترة الملف الشهري</p>
            <p style={{ fontSize: 11, color: '#64748b', margin: 0 }}>اختر الحساب والسنة والشهر الذين ينتمي لهم هذا الملف — بلا أي افتراض تلقائي</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 12, background: 'rgba(255,255,255,0.05)', border: `1px solid ${!selectedAccount ? 'rgba(251,113,133,0.4)' : 'rgba(52,211,153,0.3)'}` }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: '#64748b' }}>الحساب:</label>
            <select
              value={selectedAccount}
              onChange={(e) => setSelectedAccount(e.target.value)}
              style={{ background: 'transparent', border: 'none', color: '#f1f5f9', fontSize: 13, fontWeight: 700, cursor: 'pointer', outline: 'none', maxWidth: 220 }}
            >
              <option value="" style={{ background: '#111827' }}>اختر الحساب…</option>
              {FIXTURE_ACCOUNTS.map((a) => (
                <option key={a.id} value={a.account_code} style={{ background: '#111827' }}>{a.account_name}</option>
              ))}
            </select>
          </div>
          {[
            { label: 'الشهر', value: periodMonth, onChange: setPeriodMonth, options: Array.from({ length: 12 }, (_, i) => ({ v: i + 1, l: `${i + 1} · ${new Date(2026, i).toLocaleString('ar-EG', { month: 'long' })}` })) },
            { label: 'السنة', value: periodYear, onChange: setPeriodYear, options: [2024, 2025, 2026, 2027].map((y) => ({ v: y, l: String(y) })) },
          ].map((sel) => (
            <div key={sel.label} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 12, background: 'rgba(255,255,255,0.05)', border: `1px solid ${sel.value === null ? 'rgba(251,113,133,0.4)' : 'rgba(148,163,184,0.1)'}` }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#64748b' }}>{sel.label}:</label>
              <select
                value={sel.value ?? ''}
                onChange={(e) => { const v = parseInt(e.target.value, 10); if (!Number.isNaN(v)) sel.onChange(v); }}
                style={{ background: 'transparent', border: 'none', color: '#f1f5f9', fontSize: 13, fontWeight: 700, cursor: 'pointer', outline: 'none' }}
              >
                <option value="" style={{ background: '#111827' }}>اختر…</option>
                {sel.options.map((o) => (
                  <option key={o.v} value={o.v} style={{ background: '#111827' }}>{o.l}</option>
                ))}
              </select>
            </div>
          ))}
          {monthlyContextMissing && (
            <span style={{ fontSize: 11, color: '#fda4af', alignSelf: 'center' }}>الحساب والشهر والسنة مطلوبون قبل الاستيراد</span>
          )}
        </div>
      </div>

      {/* ── Source-separated status fields (new labels) ── */}
      <div style={{ borderRadius: 18, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(148,163,184,0.12)', overflow: 'hidden' }}>
        <div style={{ padding: '10px 18px', borderBottom: '1px solid rgba(148,163,184,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: '#f1f5f9' }}>موظف اختبار (بيانات synthetic)</span>
          <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 8, fontWeight: 700, background: 'rgba(244,63,94,0.18)', border: '1.5px solid rgba(244,63,94,0.5)', color: '#fda4af' }}>
            ⚠️ شيت الرزاين: مسجل (1 سجل)
          </span>
        </div>
        <div style={{ padding: '10px 18px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
          {FIXTURE_FIELDS.map((f, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 10px', borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <span style={{ fontSize: 13 }}>{f.icon}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 9, color: '#64748b', fontWeight: 700, marginBottom: 1 }}>{f.label}</div>
                <div style={{ fontSize: 11, fontWeight: 800, color: f.color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.value}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Conflict banner (new conflicts surface here) ── */}
      <div className="status-warning" style={{ borderRadius: 18, padding: '1.25rem 1.5rem', display: 'flex', gap: 12 }}>
        <AlertTriangle style={{ width: 20, height: 20, color: '#fbbf24', flexShrink: 0, marginTop: 2 }} />
        <div>
          <p style={{ fontSize: 13, fontWeight: 700, color: '#fbbf24', marginBottom: 8 }}>تعارض في المعرفات</p>
          {FIXTURE_CONFLICTS.map((c, i) => <p key={i} style={{ fontSize: 12, color: '#fde68a', margin: '0 0 4px' }}>• {c}</p>)}
        </div>
      </div>
    </div>
  );
}
