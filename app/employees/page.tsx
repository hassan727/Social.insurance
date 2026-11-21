'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  Search, Users, Building2, Shield, ChevronLeft, ChevronRight,
  ExternalLink, Filter, RefreshCw, AlertTriangle, CheckCircle2,
  SortAsc, SortDesc, UserX, User, Briefcase, Phone, Mail, Calendar,
  Copy, Check, Info, FileSpreadsheet, MapPin, Hash, HelpCircle, X
} from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface EmployeeSummary {
  id: string;
  company_account: string;
  employee_code: string | null;
  national_id: string | null;
  employee_name: string;
  current_status: string | null;
  current_job_title: string | null;
  current_region: string | null;
  current_department: string | null;
  insurance_number: string | null;
  insurance_status: string | null;
  insurance_salary: number | null;
  insurance_job_title: string | null;
  insurance_start_date: string | null;
  hire_date: string | null;
  resignation_date: string | null;
  last_working_day: string | null;
  data_completeness_score: number | null;
  has_duplicate_risk: boolean | null;
  last_updated_at: string;
  phone_number: string | null;
  email: string | null;
}

interface Aggregates {
  by_status: Record<string, number>;
  by_account: Record<string, number>;
}

interface ApiResponse {
  employees: EmployeeSummary[];
  total: number;
  limit: number;
  offset: number;
  aggregates: Aggregates;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function statusBadge(status: string | null) {
  if (!status) return { text: 'غير محدد', bg: 'rgba(100,116,139,0.15)', color: '#94a3b8', border: 'rgba(100,116,139,0.3)' };
  const s = status.trim();
  const l = s.toLowerCase();
  if (l.includes('active') || l.includes('نشط') || l.includes('مستمر')) {
    return { text: s, bg: 'rgba(52,211,153,0.12)', color: '#34d399', border: 'rgba(52,211,153,0.3)' };
  }
  if (l.includes('resign') || l.includes('استق') || l.includes('منتهي') || l.includes('انهاء')) {
    return { text: s, bg: 'rgba(251,113,133,0.12)', color: '#fb7185', border: 'rgba(251,113,133,0.3)' };
  }
  if (l.includes('new') || l.includes('جديد')) {
    return { text: s, bg: 'rgba(245,158,11,0.12)', color: '#f59e0b', border: 'rgba(245,158,11,0.3)' };
  }
  return { text: s, bg: 'rgba(148,163,184,0.12)', color: '#cbd5e1', border: 'rgba(148,163,184,0.25)' };
}

function completenessColor(score: number | null) {
  if (score == null) return '#475569';
  if (score >= 80) return '#34d399';
  if (score >= 50) return '#38bdf8';
  if (score >= 35) return '#f59e0b';
  return '#fb7185';
}

// ═══════════════════════════════════════════════════════════════════════════
// COPY BUTTON COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

function CopyPill({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      onClick={handleCopy}
      title={label ? `نسخ ${label}` : 'نسخ'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '3px 8px',
        borderRadius: 6,
        background: copied ? 'rgba(52,211,153,0.2)' : 'rgba(255,255,255,0.06)',
        border: `1px solid ${copied ? 'rgba(52,211,153,0.5)' : 'rgba(255,255,255,0.1)'}`,
        color: copied ? '#34d399' : '#e2e8f0',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 12,
        fontWeight: 600,
        cursor: 'pointer',
        transition: 'all 0.15s ease',
      }}
    >
      <span>{text}</span>
      {copied ? (
        <Check style={{ width: 11, height: 11, color: '#34d399' }} />
      ) : (
        <Copy style={{ width: 11, height: 11, opacity: 0.6 }} />
      )}
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════════

export default function EmployeesListPage() {
  const [employees, setEmployees] = useState<EmployeeSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [aggregates, setAggregates] = useState<Aggregates>({ by_status: {}, by_account: {} });
  const [loading, setLoading] = useState(true);

  // Filters
  const [q, setQ] = useState('');
  const [account, setAccount] = useState('ALL');
  const [status, setStatus] = useState('');
  const [hasInsurance, setHasInsurance] = useState('');
  const [completeness, setCompleteness] = useState('');
  const [sortBy, setSortBy] = useState('employee_code');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  // Pagination
  const LIMIT = 50;
  const [offset, setOffset] = useState(0);
  const [showFilters, setShowFilters] = useState(false);
  const [showCompletenessModal, setShowCompletenessModal] = useState(false);

  const searchTimeout = useRef<NodeJS.Timeout | null>(null);

  const load = useCallback(async (overrideOffset?: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(LIMIT),
        offset: String(overrideOffset ?? offset),
        sort_by: sortBy,
        sort_order: sortOrder,
      });
      if (q) params.set('q', q);
      if (account !== 'ALL') params.set('account', account);
      if (status) params.set('status', status);
      if (hasInsurance) params.set('has_insurance', hasInsurance);
      if (completeness) params.set('completeness', completeness);

      const res = await fetch(`/api/employee?${params}`);
      const data: ApiResponse = await res.json();
      setEmployees(data.employees ?? []);
      setTotal(data.total ?? 0);
      setAggregates(data.aggregates ?? { by_status: {}, by_account: {} });
    } catch (err) {
      console.error('Failed to load employees:', err);
    } finally {
      setLoading(false);
    }
  }, [q, account, status, hasInsurance, completeness, sortBy, sortOrder, offset]);

  // Debounce search
  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      setOffset(0);
      load(0);
    }, 300);
    return () => { if (searchTimeout.current) clearTimeout(searchTimeout.current); };
  }, [q, account, status, hasInsurance, completeness, sortBy, sortOrder]);

  useEffect(() => { load(); }, [offset]);

  const totalPages = Math.ceil(total / LIMIT);
  const currentPage = Math.floor(offset / LIMIT) + 1;

  const toggleSort = (field: string) => {
    if (sortBy === field) setSortOrder(o => o === 'asc' ? 'desc' : 'asc');
    else { setSortBy(field); setSortOrder('asc'); }
    setOffset(0);
  };

  const SortIcon = ({ field }: { field: string }) => {
    if (sortBy !== field) return <SortAsc style={{ width: 12, height: 12, opacity: 0.25 }} />;
    return sortOrder === 'asc'
      ? <SortAsc style={{ width: 12, height: 12, color: '#818cf8' }} />
      : <SortDesc style={{ width: 12, height: 12, color: '#818cf8' }} />;
  };

  return (
    <div style={{ width: '100%', maxWidth: '100%', padding: '24px 20px', boxSizing: 'border-box' }} dir="rtl">

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 14 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ fontSize: 22, fontWeight: 900, color: '#f1f5f9', margin: 0 }}>الدليل الموحد للموظفين</h1>
            <span style={{ padding: '3px 10px', borderRadius: 9999, fontSize: 12, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, background: 'rgba(99,102,241,0.15)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)' }}>
              {total.toLocaleString('ar-EG')} سجل موحد
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: '#64748b' }}>المرجع الشامل لاستمارات س1 / س6 والمطابقة الرقمية واستدعاء الموظف 360°</span>
            <button
              onClick={() => setShowCompletenessModal(true)}
              style={{ background: 'none', border: 'none', color: '#818cf8', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, textDecoration: 'underline', padding: 0 }}
            >
              <HelpCircle style={{ width: 14, height: 14 }} />
              كيف تُحسب نسبة الاكتمال؟
            </button>
          </div>
        </div>

        {/* Account summary pills */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            onClick={() => { setAccount('ALL'); setOffset(0); }}
            style={{
              padding: '6px 14px', borderRadius: 10,
              background: account === 'ALL' ? '#4f46e5' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${account === 'ALL' ? '#6366f1' : 'rgba(255,255,255,0.08)'}`,
              color: account === 'ALL' ? '#ffffff' : '#94a3b8',
              fontSize: 12, fontWeight: 800, cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            الكل ({total.toLocaleString('ar-EG')})
          </button>
          {Object.entries(aggregates.by_account).map(([acc, cnt]) => (
            <button
              key={acc}
              onClick={() => { setAccount(account === acc ? 'ALL' : acc); setOffset(0); }}
              style={{
                padding: '6px 14px', borderRadius: 10,
                background: account === acc ? '#4f46e5' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${account === acc ? '#6366f1' : 'rgba(255,255,255,0.08)'}`,
                color: account === acc ? '#ffffff' : '#94a3b8',
                fontSize: 12, fontWeight: 800, cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              {acc}: {cnt.toLocaleString('ar-EG')}
            </button>
          ))}
        </div>
      </div>

      {/* ── Search & Filter Controls ── */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        {/* Search Input */}
        <div style={{ position: 'relative', flex: 1, minWidth: 280 }}>
          <Search style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', width: 15, height: 15, color: '#64748b', pointerEvents: 'none' }} />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="بحث بالاسم الكامل، الرقم القومي (14 رقم)، كود الموظف، أو الرقم التأميني..."
            style={{
              width: '100%',
              padding: '11px 40px 11px 36px',
              borderRadius: 12,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: '#f1f5f9',
              fontSize: 13,
              fontFamily: 'inherit',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          {q && (
            <button
              onClick={() => setQ('')}
              style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: 0, display: 'flex' }}
            >
              <X style={{ width: 14, height: 14 }} />
            </button>
          )}
        </div>

        {/* Filter Toggle */}
        <button
          onClick={() => setShowFilters(!showFilters)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '11px 16px', borderRadius: 12,
            background: (showFilters || status || hasInsurance || completeness) ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${(showFilters || status || hasInsurance || completeness) ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.08)'}`,
            color: (showFilters || status || hasInsurance || completeness) ? '#818cf8' : '#94a3b8',
            fontSize: 12, fontWeight: 800, cursor: 'pointer',
          }}
        >
          <Filter style={{ width: 14, height: 14 }} />
          <span>تصفية متقدمة</span>
          {(status || hasInsurance || completeness) && (
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#f59e0b', display: 'inline-block' }} />
          )}
        </button>

        {/* Refresh */}
        <button
          onClick={() => load()}
          disabled={loading}
          title="تحديث البيانات"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '11px 14px', borderRadius: 12,
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            color: '#94a3b8', cursor: loading ? 'default' : 'pointer',
          }}
        >
          <RefreshCw style={{ width: 14, height: 14, animation: loading ? 'spin 0.8s linear infinite' : 'none' }} />
        </button>
      </div>

      {/* ── Advanced Filter Bar ── */}
      {showFilters && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 16, padding: '16px', borderRadius: 14, background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(148,163,184,0.15)' }}>
          {/* Status */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 4 }}>الحالة الوظيفية</div>
            <select
              value={status}
              onChange={(e) => { setStatus(e.target.value); setOffset(0); }}
              style={{ width: '100%', padding: '8px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#f1f5f9', fontSize: 12, fontFamily: 'inherit' }}
            >
              <option value="" style={{ background: '#0f172a' }}>جميع الحالات</option>
              {Object.keys(aggregates.by_status).map((s) => (
                <option key={s} value={s} style={{ background: '#0f172a' }}>{s} ({aggregates.by_status[s]})</option>
              ))}
            </select>
          </div>

          {/* Insurance */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 4 }}>الموقف التأميني</div>
            <select
              value={hasInsurance}
              onChange={(e) => { setHasInsurance(e.target.value); setOffset(0); }}
              style={{ width: '100%', padding: '8px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#f1f5f9', fontSize: 12, fontFamily: 'inherit' }}
            >
              <option value="" style={{ background: '#0f172a' }}>الكل</option>
              <option value="yes" style={{ background: '#0f172a' }}>مؤمن عليه (لديه رقم تأميني)</option>
              <option value="no" style={{ background: '#0f172a' }}>غير مؤمن (بلا رقم تأميني)</option>
            </select>
          </div>

          {/* Completeness */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 4 }}>نسبة اكتمال البيانات</div>
            <select
              value={completeness}
              onChange={(e) => { setCompleteness(e.target.value); setOffset(0); }}
              style={{ width: '100%', padding: '8px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#f1f5f9', fontSize: 12, fontFamily: 'inherit' }}
            >
              <option value="" style={{ background: '#0f172a' }}>جميع النسب</option>
              <option value="high" style={{ background: '#0f172a' }}>مرتفع (&gt;= 75%) — جاهز للاستمارات</option>
              <option value="medium" style={{ background: '#0f172a' }}>متوسط (40% - 74%)</option>
              <option value="low" style={{ background: '#0f172a' }}>منخفض (&lt; 40%) — يحتاج استكمال</option>
            </select>
          </div>

          {/* Clear Filters */}
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            {(status || hasInsurance || completeness) && (
              <button
                onClick={() => { setStatus(''); setHasInsurance(''); setCompleteness(''); setOffset(0); }}
                style={{ width: '100%', padding: '8px 12px', borderRadius: 8, background: 'rgba(251,113,133,0.12)', border: '1px solid rgba(251,113,133,0.3)', color: '#fb7185', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
              >
                مسح جميع الفلاتر
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── DESKTOP & TABLET VIEW (TABLE) ── */}
      <div className="hide-mobile" style={{ background: 'rgba(15,23,42,0.65)', border: '1px solid rgba(148,163,184,0.12)', borderRadius: 16, overflow: 'hidden', boxShadow: '0 8px 30px rgba(0,0,0,0.5)' }}>
        <div style={{ width: '100%', overflowX: 'auto' }}>
          <div style={{ minWidth: 1100 }}>
            {/* Table Header */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '120px 2.2fr 2fr 1.7fr 1.6fr 100px 110px 55px',
              padding: '12px 16px',
              background: 'rgba(15,23,42,0.95)',
              borderBottom: '1px solid rgba(148,163,184,0.12)',
              gap: 12,
              alignItems: 'center',
            }}>
              {[
                { label: 'الكود / الحساب', field: 'employee_code' },
                { label: 'الموظف والرقم القومي', field: 'employee_name' },
                { label: 'بيانات التأمين (س1/س6)', field: 'insurance_number' },
                { label: 'الوظيفة والإدارة', field: 'current_job_title' },
                { label: 'التواصل والتواريخ', field: '' },
                { label: 'الحالة', field: 'current_status', center: true },
                { label: 'الاكتمال', field: 'data_completeness_score', center: true },
                { label: 'فتح', field: '', center: true },
              ].map(({ label, field, center }) => (
                <button
                  key={label}
                  onClick={() => field && toggleSort(field)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: center ? 'center' : 'flex-start',
                    gap: 5,
                    background: 'none',
                    border: 'none',
                    color: '#94a3b8',
                    fontSize: 12,
                    fontWeight: 800,
                    cursor: field ? 'pointer' : 'default',
                    padding: 0,
                    textAlign: center ? 'center' : 'right',
                  }}
                >
                  <span>{label}</span>
                  {field && <SortIcon field={field} />}
                </button>
              ))}
            </div>

            {/* Table Rows */}
            {loading ? (
              <div style={{ padding: '60px 20px', textAlign: 'center', color: '#64748b' }}>
                <div style={{ width: 32, height: 32, border: '3px solid rgba(99,102,241,0.3)', borderTop: '3px solid #6366f1', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
                <span style={{ fontSize: 13, fontWeight: 600 }}>جاري تحميل سجلات الموظفين...</span>
              </div>
            ) : employees.length === 0 ? (
              <div style={{ padding: '60px 20px', textAlign: 'center', color: '#64748b' }}>
                <UserX style={{ width: 40, height: 40, opacity: 0.35, margin: '0 auto 12px' }} />
                <div style={{ fontSize: 14, fontWeight: 700 }}>لا يوجد موظفون مطابقون لهذا البحث</div>
              </div>
            ) : (
              employees.map((emp, idx) => {
                const sb = statusBadge(emp.current_status);
                const cc = completenessColor(emp.data_completeness_score);
                const score = emp.data_completeness_score ?? 0;

                return (
                  <div
                    key={emp.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '120px 2.2fr 2fr 1.7fr 1.6fr 100px 110px 55px',
                      padding: '14px 16px',
                      borderBottom: idx < employees.length - 1 ? '1px solid rgba(148,163,184,0.06)' : 'none',
                      gap: 12,
                      alignItems: 'center',
                      transition: 'background 0.15s ease',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(99,102,241,0.08)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    {/* Code & Account */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 900, color: '#818cf8' }}>
                        {emp.employee_code ?? '—'}
                      </span>
                      <span style={{ padding: '2px 7px', borderRadius: 6, fontSize: 11, fontWeight: 800, background: 'rgba(255,255,255,0.06)', color: '#cbd5e1', border: '1px solid rgba(255,255,255,0.1)' }}>
                        {emp.company_account}
                      </span>
                    </div>

                    {/* Name & National ID */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Link
                          href={`/employee/${emp.id}`}
                          style={{ fontSize: 14, fontWeight: 800, color: '#f1f5f9', textDecoration: 'none' }}
                          onMouseEnter={(e) => { e.currentTarget.style.color = '#818cf8'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = '#f1f5f9'; }}
                        >
                          {emp.employee_name}
                        </Link>
                        {emp.has_duplicate_risk && (
                          <span title="تنبيه: يوجد سجل مشابه بنفس الرقم القومي" style={{ fontSize: 12, color: '#fb7185' }}>⚠️</span>
                        )}
                      </div>
                      {emp.national_id ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 11, color: '#64748b', fontWeight: 700 }}>الرقم القومي:</span>
                          <CopyPill text={emp.national_id} label="الرقم القومي" />
                        </div>
                      ) : (
                        <span style={{ fontSize: 11, color: '#fb7185', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <AlertTriangle style={{ width: 12, height: 12 }} />
                          بدون رقم قومي
                        </span>
                      )}
                    </div>

                    {/* Insurance Details (S1 / S6) */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {emp.insurance_number ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 11, color: '#64748b', fontWeight: 700 }}>التأمين:</span>
                          <CopyPill text={emp.insurance_number} label="الرقم التأميني" />
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 6px', borderRadius: 5, fontSize: 10, fontWeight: 800, background: 'rgba(52,211,153,0.12)', color: '#34d399', border: '1px solid rgba(52,211,153,0.3)' }}>
                            <CheckCircle2 style={{ width: 10, height: 10 }} />
                            مؤمّن
                          </span>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 8px', borderRadius: 5, fontSize: 11, fontWeight: 800, background: 'rgba(251,113,133,0.12)', color: '#fb7185', border: '1px solid rgba(251,113,133,0.3)' }}>
                            <AlertTriangle style={{ width: 11, height: 11 }} />
                            غير مؤمن
                          </span>
                        </div>
                      )}

                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 11, color: '#94a3b8' }}>
                        {emp.insurance_start_date && (
                          <span title="تاريخ بداية الاشتراك التأميني (استمارة 1)">
                            اشتراك: <strong style={{ color: '#e2e8f0', fontFamily: 'monospace' }}>{emp.insurance_start_date}</strong>
                          </span>
                        )}
                        {emp.insurance_salary != null && (
                          <span title="الأجر التأميني">
                            أجر: <strong style={{ color: '#e2e8f0', fontFamily: 'monospace' }}>{Number(emp.insurance_salary).toLocaleString('ar-EG')} ج.م</strong>
                          </span>
                        )}
                        {emp.insurance_job_title && !emp.insurance_start_date && (
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }} title="الوظيفة التأمينية">
                            {emp.insurance_job_title}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Job & Location */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <span style={{ fontSize: 13, fontWeight: 800, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {emp.current_job_title ?? '—'}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#64748b' }}>
                        {emp.current_department && (
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }} title={emp.current_department}>
                            {emp.current_department}
                          </span>
                        )}
                        {emp.current_region && (
                          <span style={{ padding: '1px 5px', borderRadius: 4, background: 'rgba(255,255,255,0.06)', color: '#94a3b8' }}>
                            {emp.current_region}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Contact & Dates */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {emp.phone_number ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <Phone style={{ width: 12, height: 12, color: '#64748b' }} />
                          <CopyPill text={emp.phone_number} label="رقم الهاتف" />
                        </div>
                      ) : (
                        <span style={{ fontSize: 11, color: '#475569' }}>بلا هاتف</span>
                      )}

                      {emp.resignation_date ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#fb7185', fontFamily: 'monospace' }} title="تاريخ الاستقالة (استمارة 6)">
                          <Calendar style={{ width: 12, height: 12 }} />
                          <span>استقالة: {emp.resignation_date}</span>
                        </div>
                      ) : emp.hire_date ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#94a3b8', fontFamily: 'monospace' }} title="تاريخ التعيين (استمارة 1)">
                          <Calendar style={{ width: 12, height: 12, color: '#64748b' }} />
                          <span>تعيين: {emp.hire_date}</span>
                        </div>
                      ) : null}
                    </div>

                    {/* Status */}
                    <div style={{ display: 'flex', justifyContent: 'center' }}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center',
                        padding: '3px 8px', borderRadius: 9999,
                        fontSize: 11, fontWeight: 800,
                        background: sb.bg, color: sb.color,
                        border: `1px solid ${sb.border}`,
                        whiteSpace: 'nowrap',
                      }}>
                        {sb.text}
                      </span>
                    </div>

                    {/* Completeness */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                      <div style={{ width: '100%', height: 6, borderRadius: 3, background: 'rgba(148,163,184,0.15)', overflow: 'hidden' }}>
                        <div style={{ width: `${score}%`, height: '100%', borderRadius: 3, background: cc, boxShadow: `0 0 6px ${cc}` }} />
                      </div>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 900, color: cc }}>
                        {score}%
                      </span>
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', justifyContent: 'center' }}>
                      <Link
                        href={`/employee/${emp.id}`}
                        title="عرض ملف الموظف 360°"
                        style={{
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          padding: 6, borderRadius: 8,
                          background: 'rgba(255,255,255,0.06)',
                          color: '#cbd5e1',
                          textDecoration: 'none',
                          border: '1px solid rgba(255,255,255,0.08)',
                          transition: 'all 0.15s ease',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = '#4f46e5'; e.currentTarget.style.color = '#ffffff'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = '#cbd5e1'; }}
                      >
                        <ExternalLink style={{ width: 14, height: 14 }} />
                      </Link>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* ── MOBILE VIEW (RESPONSIVE CARDS) ── */}
      <div className="show-mobile" style={{ marginTop: 12 }}>
        {loading ? (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: '#64748b', background: 'rgba(15,23,42,0.6)', borderRadius: 14, border: '1px solid rgba(148,163,184,0.1)' }}>
            <div style={{ width: 28, height: 28, border: '3px solid rgba(99,102,241,0.3)', borderTop: '3px solid #6366f1', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 10px' }} />
            <span style={{ fontSize: 12 }}>جاري تحميل سجلات الموظفين...</span>
          </div>
        ) : employees.length === 0 ? (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: '#64748b', background: 'rgba(15,23,42,0.6)', borderRadius: 14, border: '1px solid rgba(148,163,184,0.1)' }}>
            <UserX style={{ width: 36, height: 36, opacity: 0.35, margin: '0 auto 10px' }} />
            <div style={{ fontSize: 13, fontWeight: 700 }}>لا يوجد موظفون مطابقون لهذا البحث</div>
          </div>
        ) : (
          employees.map((emp) => {
            const sb = statusBadge(emp.current_status);
            const cc = completenessColor(emp.data_completeness_score);
            const score = emp.data_completeness_score ?? 0;

            return (
              <div
                key={emp.id}
                style={{
                  background: 'rgba(15,23,42,0.75)',
                  border: '1px solid rgba(148,163,184,0.12)',
                  borderRadius: 14,
                  padding: 14,
                  marginBottom: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
                }}
              >
                {/* Card Top: Name & Badges */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, borderBottom: '1px solid rgba(148,163,184,0.08)', paddingBottom: 10 }}>
                  <div>
                    <Link
                      href={`/employee/${emp.id}`}
                      style={{ fontSize: 15, fontWeight: 900, color: '#f1f5f9', textDecoration: 'none' }}
                    >
                      {emp.employee_name}
                    </Link>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, fontWeight: 800, color: '#818cf8' }}>
                        كود: {emp.employee_code ?? '—'}
                      </span>
                      <span style={{ padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 800, background: 'rgba(255,255,255,0.06)', color: '#cbd5e1' }}>
                        {emp.company_account}
                      </span>
                    </div>
                  </div>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center',
                    padding: '3px 8px', borderRadius: 9999,
                    fontSize: 10, fontWeight: 800,
                    background: sb.bg, color: sb.color,
                    border: `1px solid ${sb.border}`,
                    whiteSpace: 'nowrap',
                  }}>
                    {sb.text}
                  </span>
                </div>

                {/* Card Mid: National ID & Insurance */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, fontSize: 12 }}>
                  {/* National ID */}
                  <div style={{ padding: '8px 10px', borderRadius: 8, background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(148,163,184,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700 }}>الرقم القومي:</span>
                    {emp.national_id ? (
                      <CopyPill text={emp.national_id} label="الرقم القومي" />
                    ) : (
                      <span style={{ fontSize: 10, color: '#fb7185' }}>غير مسجل</span>
                    )}
                  </div>

                  {/* Insurance Number */}
                  <div style={{ padding: '8px 10px', borderRadius: 8, background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(148,163,184,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700 }}>رقم التأمين:</span>
                    {emp.insurance_number ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <CopyPill text={emp.insurance_number} label="الرقم التأميني" />
                        <span style={{ fontSize: 9, padding: '1px 4px', borderRadius: 3, background: 'rgba(52,211,153,0.15)', color: '#34d399' }}>مؤمن</span>
                      </div>
                    ) : (
                      <span style={{ fontSize: 10, color: '#fb7185' }}>غير مؤمن</span>
                    )}
                  </div>
                </div>

                {/* Card Job & Contact Strip */}
                <div style={{ padding: '8px 10px', borderRadius: 8, background: 'rgba(0,0,0,0.15)', border: '1px solid rgba(148,163,184,0.06)', display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, color: '#e2e8f0' }}>
                      <Briefcase style={{ width: 13, height: 13, color: '#64748b' }} />
                      <span>{emp.current_job_title ?? 'بدون مسمى'}</span>
                    </div>
                    {emp.current_region && (
                      <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'rgba(255,255,255,0.06)', color: '#94a3b8' }}>
                        {emp.current_region}
                      </span>
                    )}
                  </div>

                  {emp.phone_number && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4, borderTop: '1px solid rgba(148,163,184,0.06)' }}>
                      <span style={{ fontSize: 11, color: '#64748b' }}>الهاتف:</span>
                      <CopyPill text={emp.phone_number} label="الهاتف" />
                    </div>
                  )}

                  {emp.resignation_date ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4, borderTop: '1px solid rgba(148,163,184,0.06)', color: '#fb7185', fontSize: 11 }}>
                      <span>تاريخ الاستقالة (س6):</span>
                      <span style={{ fontFamily: 'monospace' }}>{emp.resignation_date}</span>
                    </div>
                  ) : emp.hire_date ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4, borderTop: '1px solid rgba(148,163,184,0.06)', color: '#94a3b8', fontSize: 11 }}>
                      <span>تاريخ التعيين (س1):</span>
                      <span style={{ fontFamily: 'monospace', color: '#e2e8f0' }}>{emp.hire_date}</span>
                    </div>
                  ) : null}
                </div>

                {/* Card Footer: Completeness & Link */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingTop: 4 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                      <span style={{ color: '#94a3b8' }}>اكتمال الملف:</span>
                      <span style={{ fontFamily: 'monospace', fontWeight: 900, color: cc }}>{score}%</span>
                    </div>
                    <div style={{ width: '100%', height: 5, borderRadius: 3, background: 'rgba(148,163,184,0.15)', overflow: 'hidden' }}>
                      <div style={{ width: `${score}%`, height: '100%', borderRadius: 3, background: cc }} />
                    </div>
                  </div>
                  <Link
                    href={`/employee/${emp.id}`}
                    style={{
                      padding: '6px 12px', borderRadius: 8,
                      background: '#4f46e5', color: '#ffffff',
                      fontSize: 12, fontWeight: 800,
                      textDecoration: 'none',
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                    }}
                  >
                    <span>فتح الملف</span>
                    <ChevronLeft style={{ width: 13, height: 13 }} />
                  </Link>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ── Pagination ── */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 24 }}>
          <button
            onClick={() => setOffset(Math.max(0, offset - LIMIT))}
            disabled={currentPage === 1}
            style={{
              padding: '8px 16px', borderRadius: 10,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: currentPage === 1 ? '#475569' : '#cbd5e1',
              cursor: currentPage === 1 ? 'default' : 'pointer',
              fontSize: 12, fontWeight: 800,
              display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            <ChevronRight style={{ width: 14, height: 14 }} />
            السابق
          </button>
          <span style={{ fontSize: 12, color: '#64748b', fontFamily: 'monospace' }}>
            صفحة {currentPage} من {totalPages}
          </span>
          <button
            onClick={() => setOffset(offset + LIMIT)}
            disabled={currentPage === totalPages}
            style={{
              padding: '8px 16px', borderRadius: 10,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: currentPage === totalPages ? '#475569' : '#cbd5e1',
              cursor: currentPage === totalPages ? 'default' : 'pointer',
              fontSize: 12, fontWeight: 800,
              display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            التالي
            <ChevronLeft style={{ width: 14, height: 14 }} />
          </button>
        </div>
      )}

      {/* ── COMPLETENESS EXPLANATION MODAL ── */}
      {showCompletenessModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            background: 'rgba(0,0,0,0.85)',
            backdropFilter: 'blur(8px)',
          }}
          onClick={() => setShowCompletenessModal(false)}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 640,
              borderRadius: 16,
              background: '#0f172a',
              border: '1px solid rgba(148,163,184,0.2)',
              padding: 24,
              boxShadow: '0 20px 50px rgba(0,0,0,0.8)',
              position: 'relative',
              color: '#e2e8f0',
              maxHeight: '90vh',
              overflowY: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
            dir="rtl"
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', borderBottom: '1px solid rgba(148,163,184,0.12)', paddingBottom: 12, marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <HelpCircle style={{ width: 20, height: 20, color: '#818cf8' }} />
                <h3 style={{ fontSize: 16, fontWeight: 900, color: '#f1f5f9', margin: 0 }}>
                  منطق ومعادلة حساب نسبة الاكتمال (Completeness Score)
                </h3>
              </div>
              <button
                onClick={() => setShowCompletenessModal(false)}
                style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: 4 }}
              >
                <X style={{ width: 18, height: 18 }} />
              </button>
            </div>

            <div style={{ fontSize: 12, color: '#cbd5e1', lineHeight: '1.7', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <p style={{ margin: 0 }}>
                تُحسب نسبة الاكتمال برمجياً في قاعدة البيانات (دالة <code style={{ color: '#818cf8', fontFamily: 'monospace' }}>calculate_employee_completeness</code>) بناءً على <strong style={{ color: '#fbbf24' }}>14 حقلاً تشغيلياً وتأمينياً أساسياً</strong> مطلوبة لمعاملات التأمينات الاجتماعية (استمارة 1 و 6) وشؤون العاملين:
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
                {/* Category 1 */}
                <div style={{ padding: 12, borderRadius: 12, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(148,163,184,0.1)' }}>
                  <div style={{ fontWeight: 800, color: '#818cf8', marginBottom: 6, fontSize: 12 }}>1. الهوية الأساسية (3 حقول = 21.4%)</div>
                  <ul style={{ margin: 0, paddingRight: 16, fontSize: 11, color: '#94a3b8', lineHeight: 1.6 }}>
                    <li>كود الموظف (<code style={{ color: '#e2e8f0', fontFamily: 'monospace' }}>employee_code</code>)</li>
                    <li>الرقم القومي 14 رقم (<code style={{ color: '#e2e8f0', fontFamily: 'monospace' }}>national_id</code>)</li>
                    <li>اسم الموظف الرباعي (<code style={{ color: '#e2e8f0', fontFamily: 'monospace' }}>employee_name</code>)</li>
                  </ul>
                </div>

                {/* Category 2 */}
                <div style={{ padding: 12, borderRadius: 12, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(148,163,184,0.1)' }}>
                  <div style={{ fontWeight: 800, color: '#38bdf8', marginBottom: 6, fontSize: 12 }}>2. البيانات الوظيفية (5 حقول = 35.7%)</div>
                  <ul style={{ margin: 0, paddingRight: 16, fontSize: 11, color: '#94a3b8', lineHeight: 1.6 }}>
                    <li>الحالة الوظيفية (<code style={{ color: '#e2e8f0', fontFamily: 'monospace' }}>current_status</code>)</li>
                    <li>المسمى الوظيفي (<code style={{ color: '#e2e8f0', fontFamily: 'monospace' }}>current_job_title</code>)</li>
                    <li>منطقة العمل (<code style={{ color: '#e2e8f0', fontFamily: 'monospace' }}>current_region</code>)</li>
                    <li>الإدارة أو المشروع (<code style={{ color: '#e2e8f0', fontFamily: 'monospace' }}>current_department</code>)</li>
                    <li>تاريخ التعيين / الاستلام (<code style={{ color: '#e2e8f0', fontFamily: 'monospace' }}>hire_date</code>)</li>
                  </ul>
                </div>

                {/* Category 3 */}
                <div style={{ padding: 12, borderRadius: 12, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(148,163,184,0.1)' }}>
                  <div style={{ fontWeight: 800, color: '#34d399', marginBottom: 6, fontSize: 12 }}>3. البيانات التأمينية للاستمارات (4 حقول = 28.6%)</div>
                  <ul style={{ margin: 0, paddingRight: 16, fontSize: 11, color: '#94a3b8', lineHeight: 1.6 }}>
                    <li>الرقم التأميني (<code style={{ color: '#e2e8f0', fontFamily: 'monospace' }}>insurance_number</code>)</li>
                    <li>الموقف التأميني (<code style={{ color: '#e2e8f0', fontFamily: 'monospace' }}>insurance_status</code>)</li>
                    <li>الأجر التأميني (<code style={{ color: '#e2e8f0', fontFamily: 'monospace' }}>insurance_salary</code>)</li>
                    <li>تاريخ بداية الاشتراك (<code style={{ color: '#e2e8f0', fontFamily: 'monospace' }}>insurance_start_date</code>)</li>
                  </ul>
                </div>

                {/* Category 4 */}
                <div style={{ padding: 12, borderRadius: 12, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(148,163,184,0.1)' }}>
                  <div style={{ fontWeight: 800, color: '#f59e0b', marginBottom: 6, fontSize: 12 }}>4. التواصل والعنوان (2 حقل = 14.3%)</div>
                  <ul style={{ margin: 0, paddingRight: 16, fontSize: 11, color: '#94a3b8', lineHeight: 1.6 }}>
                    <li>رقم الهاتف المحمول (<code style={{ color: '#e2e8f0', fontFamily: 'monospace' }}>phone_number</code>)</li>
                    <li>العنوان المسجل (<code style={{ color: '#e2e8f0', fontFamily: 'monospace' }}>address</code>)</li>
                  </ul>
                </div>
              </div>

              {/* Mathematical Equation */}
              <div style={{ padding: 12, borderRadius: 12, background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)', textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: '#818cf8', fontWeight: 700, marginBottom: 4 }}>المعادلة الرياضية الدقيقة:</div>
                <div style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 900, color: '#e0e7ff', marginBottom: 4 }}>
                  النسبة = (عدد الحقول الممتلئة ÷ 14) × 100
                </div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>
                  كل حقل مكتمل يرفع النسبة بمقدار <strong style={{ color: '#ffffff' }}>7.14%</strong> تماماً (مثال: 8 حقول = 57.14%).
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
              <button
                onClick={() => setShowCompletenessModal(false)}
                style={{ padding: '8px 18px', borderRadius: 10, background: '#4f46e5', color: '#ffffff', fontSize: 12, fontWeight: 800, border: 'none', cursor: 'pointer' }}
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
