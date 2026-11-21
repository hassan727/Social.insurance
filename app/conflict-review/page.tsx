'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  AlertTriangle, CheckCircle2, XCircle, RefreshCw,
  Search, ChevronDown, ExternalLink, Layers,
  CheckSquare, Square, ArrowRightLeft, Merge,
  ShieldCheck, Trash2
} from 'lucide-react';
import { toast } from 'sonner';

// ─── Types ───────────────────────────────────────────────────────────────────

interface FieldConflict {
  id: string;
  employee_id: string;
  field_name: string;
  current_value: string | null;
  current_source: string | null;
  proposed_value: string;
  proposed_source: string;
  status: string;
  review_notes: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  employee: {
    id: string;
    employee_name: string;
    employee_code: string | null;
    national_id: string | null;
    company_account: string;
    current_job_title: string | null;
    current_status: string | null;
  } | null;
}

interface Stats {
  pending: number;
  approved: number;
  rejected: number;
}

// ─── Field label map ──────────────────────────────────────────────────────────

const FIELD_LABELS: Record<string, string> = {
  insurance_number: 'الرقم التأميني',
  hire_date: 'تاريخ التعيين',
  current_job_title: 'المسمى الوظيفي',
  current_region: 'المنطقة',
  current_department: 'الإدارة',
  phone_number: 'رقم الهاتف',
  address: 'العنوان',
  insurance_start_date: 'تاريخ بداية الاشتراك',
  insurance_status: 'الحالة التأمينية',
  insurance_job_title: 'الوظيفة في التأمينات',
  current_status: 'الحالة الوظيفية',
};

const FIELD_COLORS: Record<string, string> = {
  insurance_number: '#f59e0b',
  hire_date: '#3b82f6',
  current_job_title: '#8b5cf6',
  current_region: '#10b981',
  phone_number: '#06b6d4',
  insurance_start_date: '#f97316',
  default: '#6366f1',
};

function getFieldColor(field: string) {
  return FIELD_COLORS[field] || FIELD_COLORS.default;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ConflictReviewPage() {
  const [conflicts, setConflicts] = useState<FieldConflict[]>([]);
  const [stats, setStats] = useState<Stats>({ pending: 0, approved: 0, rejected: 0 });
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('pending');
  const [fieldFilter, setFieldFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [bulkProcessing, setBulkProcessing] = useState(false);
  const [runningDetect, setRunningDetect] = useState(false);
  const [runningDedup, setRunningDedup] = useState(false);
  const [mergeState, setMergeState] = useState<Record<string, string>>({});

  // ─── Fetch ────────────────────────────────────────────────────────────────

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [conflictsRes, statsRes] = await Promise.all([
        fetch(`/api/conflict-review?status=${statusFilter}&limit=200`),
        fetch('/api/conflict-review?action=stats'),
      ]);
      const conflictsJson = await conflictsRes.json();
      const statsJson = await statsRes.json();

      if (!conflictsRes.ok) throw new Error(conflictsJson.error || 'فشل جلب التعارضات');
      setConflicts(conflictsJson.conflicts || []);
      setStats(statsJson);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'خطأ في الاتصال');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ─── Filtering ────────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    return conflicts.filter(c => {
      if (fieldFilter && c.field_name !== fieldFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const empName = (c.employee?.employee_name || '').toLowerCase();
        const empCode = (c.employee?.employee_code || '').toLowerCase();
        const natId = (c.employee?.national_id || '').toLowerCase();
        if (!empName.includes(q) && !empCode.includes(q) && !natId.includes(q)) return false;
      }
      return true;
    });
  }, [conflicts, fieldFilter, searchQuery]);

  const availableFields = useMemo(() => {
    const s = new Set(conflicts.map(c => c.field_name));
    return Array.from(s).sort();
  }, [conflicts]);

  // ─── Actions ─────────────────────────────────────────────────────────────

  const decide = async (id: string, decision: 'approved' | 'rejected' | 'merged', mergedValue?: string) => {
    setProcessingId(id);
    try {
      const res = await fetch('/api/conflict-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'decide', conflict_id: id, decision, merged_value: mergedValue }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      toast.success(
        decision === 'approved' ? '✅ تم قبول القيمة الجديدة وتحديث ملف الموظف'
        : decision === 'rejected' ? '🔒 تم الإبقاء على القيمة الحالية'
        : '✏️ تم حفظ القيمة المدمجة'
      );
      await fetchAll();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'فشلت العملية');
    } finally {
      setProcessingId(null);
    }
  };

  const decideBulk = async (decision: 'approved' | 'rejected') => {
    if (selectedIds.size === 0) { toast.error('اختر تعارضات أولاً'); return; }
    setBulkProcessing(true);
    try {
      const res = await fetch('/api/conflict-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'decide_bulk', conflict_ids: Array.from(selectedIds), decision }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      toast.success(`${decision === 'approved' ? 'قُبل' : 'رُفض'} ${json.succeeded} تعارض من ${json.total}`);
      setSelectedIds(new Set());
      await fetchAll();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'فشل الإجراء الجماعي');
    } finally {
      setBulkProcessing(false);
    }
  };

  const runDetection = async () => {
    setRunningDetect(true);
    try {
      const res = await fetch('/api/conflict-review?action=detect');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      const r = json.result;
      toast.success(`تم فحص ${r?.employees_scanned || 0} موظف — اكتُشف ${r?.total_conflicts_found || 0} تعارض جديد`);
      await fetchAll();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'فشل الفحص');
    } finally {
      setRunningDetect(false);
    }
  };

  const runDedup = async () => {
    setRunningDedup(true);
    try {
      const res = await fetch('/api/conflict-review?action=deduplicate');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      const totalDups = (json.results || []).reduce((s: number, r: { duplicates_marked: number }) => s + (r.duplicates_marked || 0), 0);
      toast.success(`تم تنظيف ${totalDups} صف مكرر من sheet_data`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'فشل التنظيف');
    } finally {
      setRunningDedup(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(c => c.id)));
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div style={{ paddingBottom: 80 }}>
      <main style={{ maxWidth: 1400, margin: '0 auto', padding: '32px 24px' }}>

        {/* ── Header ── */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28, flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <div style={{ width: 42, height: 42, borderRadius: 12, background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <ArrowRightLeft style={{ width: 22, height: 22, color: '#f59e0b' }} />
              </div>
              <div>
                <h1 style={{ fontSize: 24, fontWeight: 900, margin: 0, color: '#ffffff' }}>مركز حل تعارضات البيانات</h1>
                <p style={{ fontSize: 13, color: '#94a3b8', margin: '3px 0 0' }}>
                  مقارنة حقل بحقل بين الشيتات — اقبل أو ارفض أو ادمج كل تغيير يدوياً
                </p>
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              onClick={runDedup}
              disabled={runningDedup}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 10, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5', cursor: runningDedup ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 700 }}
            >
              <Trash2 style={{ width: 14, height: 14 }} className={runningDedup ? 'spin' : ''} />
              تنظيف مكررات sheet_data
            </button>
            <button
              onClick={runDetection}
              disabled={runningDetect}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 10, background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.3)', color: '#a5b4fc', cursor: runningDetect ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 700 }}
            >
              <Search style={{ width: 14, height: 14 }} className={runningDetect ? 'spin' : ''} />
              {runningDetect ? 'جاري الفحص...' : 'فحص كل التعارضات'}
            </button>
            <button
              onClick={fetchAll}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#e2e8f0', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
            >
              <RefreshCw style={{ width: 14, height: 14 }} className={loading ? 'spin' : ''} />
              تحديث
            </button>
          </div>
        </div>

        {/* ── Stats Bar ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 24 }}>
          {[
            { label: 'بانتظار المراجعة', value: stats.pending, color: '#f59e0b', key: 'pending' },
            { label: 'تمت الموافقة', value: stats.approved, color: '#10b981', key: 'approved' },
            { label: 'تم الرفض', value: stats.rejected, color: '#6b7280', key: 'rejected' },
          ].map(s => (
            <button
              key={s.key}
              onClick={() => setStatusFilter(s.key)}
              style={{ background: statusFilter === s.key ? `rgba(${s.color === '#f59e0b' ? '245,158,11' : s.color === '#10b981' ? '16,185,129' : '107,114,128'},0.15)` : 'rgba(255,255,255,0.03)', border: `1px solid ${statusFilter === s.key ? s.color + '55' : 'rgba(255,255,255,0.08)'}`, borderRadius: 14, padding: '16px 20px', textAlign: 'right', cursor: 'pointer', transition: 'all 0.2s' }}
            >
              <div style={{ fontSize: 28, fontWeight: 900, color: s.color, marginBottom: 4 }}>{s.value}</div>
              <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 700 }}>{s.label}</div>
            </button>
          ))}
        </div>

        {/* ── Filters ── */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
            <Search style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', width: 15, height: 15, color: '#64748b' }} />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="ابحث باسم أو كود أو رقم قومي..."
              style={{ width: '100%', padding: '9px 36px 9px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#e2e8f0', fontSize: 13, boxSizing: 'border-box', outline: 'none' }}
            />
          </div>
          <div style={{ position: 'relative' }}>
            <ChevronDown style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', width: 14, height: 14, color: '#64748b', pointerEvents: 'none' }} />
            <select
              value={fieldFilter}
              onChange={e => setFieldFilter(e.target.value)}
              style={{ padding: '9px 32px 9px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#e2e8f0', fontSize: 13, appearance: 'none', cursor: 'pointer', outline: 'none' }}
            >
              <option value="">كل الحقول</option>
              {availableFields.map(f => (
                <option key={f} value={f}>{FIELD_LABELS[f] || f}</option>
              ))}
            </select>
          </div>

          {/* Bulk Actions */}
          {statusFilter === 'pending' && filtered.length > 0 && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginRight: 'auto' }}>
              <button onClick={selectAll} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#cbd5e1', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
                {selectedIds.size === filtered.length ? <CheckSquare style={{ width: 14, height: 14, color: '#6366f1' }} /> : <Square style={{ width: 14, height: 14 }} />}
                {selectedIds.size === 0 ? 'تحديد الكل' : `${selectedIds.size} محدد`}
              </button>
              {selectedIds.size > 0 && (
                <>
                  <button onClick={() => decideBulk('approved')} disabled={bulkProcessing} style={{ padding: '7px 14px', borderRadius: 8, background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)', color: '#34d399', cursor: 'pointer', fontSize: 12, fontWeight: 800 }}>
                    قبول الكل ({selectedIds.size})
                  </button>
                  <button onClick={() => decideBulk('rejected')} disabled={bulkProcessing} style={{ padding: '7px 14px', borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#fca5a5', cursor: 'pointer', fontSize: 12, fontWeight: 800 }}>
                    رفض الكل ({selectedIds.size})
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* ── Conflicts List ── */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: '#94a3b8' }}>
            <RefreshCw style={{ width: 32, height: 32, margin: '0 auto 16px', color: '#f59e0b' }} className="spin" />
            <p style={{ fontSize: 15 }}>جاري تحميل التعارضات...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '80px 20px', background: 'rgba(255,255,255,0.02)', borderRadius: 20, border: '1px dashed rgba(255,255,255,0.1)' }}>
            <ShieldCheck style={{ width: 48, height: 48, margin: '0 auto 16px', color: '#34d399' }} />
            <h3 style={{ fontSize: 18, fontWeight: 800, color: '#f1f5f9', margin: '0 0 6px' }}>
              {statusFilter === 'pending' ? 'لا توجد تعارضات معلقة' : 'لا توجد نتائج'}
            </h3>
            <p style={{ fontSize: 13, color: '#94a3b8', margin: 0 }}>
              {statusFilter === 'pending' ? 'اضغط "فحص كل التعارضات" لاكتشاف تعارضات جديدة' : 'جرّب فلتراً مختلفاً'}
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {filtered.map(c => {
              const emp = c.employee;
              const isProcessing = processingId === c.id;
              const isSelected = selectedIds.has(c.id);
              const fieldColor = getFieldColor(c.field_name);
              const fieldLabel = FIELD_LABELS[c.field_name] || c.field_name;
              const isMerging = mergeState[c.id] !== undefined;

              return (
                <div
                  key={c.id}
                  style={{
                    background: isSelected ? 'rgba(99,102,241,0.08)' : 'rgba(255,255,255,0.025)',
                    border: `1px solid ${isSelected ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.08)'}`,
                    borderRadius: 18,
                    padding: '18px 22px',
                    transition: 'all 0.2s',
                  }}
                >
                  {/* Row header */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {statusFilter === 'pending' && (
                        <button onClick={() => toggleSelect(c.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: isSelected ? '#6366f1' : '#475569' }}>
                          {isSelected ? <CheckSquare style={{ width: 18, height: 18 }} /> : <Square style={{ width: 18, height: 18 }} />}
                        </button>
                      )}
                      {/* Field badge */}
                      <span style={{ fontSize: 11, fontWeight: 800, background: `${fieldColor}22`, color: fieldColor, padding: '3px 10px', borderRadius: 6, border: `1px solid ${fieldColor}44` }}>
                        {fieldLabel}
                      </span>
                      {emp && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 13, fontWeight: 800, color: '#f1f5f9' }}>{emp.employee_name}</span>
                          <span style={{ fontSize: 11, color: '#64748b', fontFamily: 'monospace' }}>[{emp.company_account}] {emp.employee_code || '—'}</span>
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 11, color: '#475569' }}>
                        {new Date(c.created_at).toLocaleDateString('ar-EG')}
                      </span>
                      {emp && (
                        <Link href={`/employee/${emp.id}`} target="_blank" style={{ color: '#6366f1', fontSize: 11, display: 'flex', alignItems: 'center', gap: 3, textDecoration: 'none' }}>
                          ملف <ExternalLink style={{ width: 11, height: 11 }} />
                        </Link>
                      )}
                    </div>
                  </div>

                  {/* Comparison — Current vs Proposed */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 32px 1fr', gap: 10, alignItems: 'stretch', marginBottom: 14 }}>
                    {/* Current (old) */}
                    <div style={{ background: 'rgba(15,23,42,0.6)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '12px 14px' }}>
                      <div style={{ fontSize: 10, fontWeight: 800, color: '#64748b', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                        القيمة الحالية · {c.current_source || '—'}
                      </div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: c.current_value ? '#e2e8f0' : '#475569', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                        {c.current_value || '(فارغ)'}
                      </div>
                    </div>

                    {/* Arrow */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569' }}>
                      <ArrowRightLeft style={{ width: 16, height: 16 }} />
                    </div>

                    {/* Proposed (new) */}
                    <div style={{ background: 'rgba(15,23,42,0.6)', border: `1px solid ${fieldColor}44`, borderRadius: 12, padding: '12px 14px' }}>
                      <div style={{ fontSize: 10, fontWeight: 800, color: fieldColor, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                        القيمة المقترحة · {c.proposed_source}
                      </div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: '#ffffff', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                        {c.proposed_value}
                      </div>
                    </div>
                  </div>

                  {/* Merge input */}
                  {isMerging && (
                    <div style={{ marginBottom: 12 }}>
                      <input
                        value={mergeState[c.id]}
                        onChange={e => setMergeState(prev => ({ ...prev, [c.id]: e.target.value }))}
                        placeholder="اكتب القيمة المدمجة النهائية..."
                        style={{ width: '100%', padding: '9px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', color: '#e2e8f0', fontSize: 13, boxSizing: 'border-box', outline: 'none', fontFamily: 'monospace' }}
                      />
                    </div>
                  )}

                  {/* Actions */}
                  {c.status === 'pending' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      {/* Approve */}
                      <button
                        disabled={isProcessing}
                        onClick={() => decide(c.id, 'approved')}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 9, background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.4)', color: '#34d399', cursor: isProcessing ? 'not-allowed' : 'pointer', fontWeight: 800, fontSize: 13, opacity: isProcessing ? 0.6 : 1 }}
                      >
                        <CheckCircle2 style={{ width: 15, height: 15 }} />
                        قبول الجديد
                      </button>

                      {/* Reject */}
                      <button
                        disabled={isProcessing}
                        onClick={() => decide(c.id, 'rejected')}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 9, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', color: '#94a3b8', cursor: isProcessing ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: 13, opacity: isProcessing ? 0.6 : 1 }}
                      >
                        <XCircle style={{ width: 15, height: 15 }} />
                        إبقاء القديم
                      </button>

                      {/* Merge toggle */}
                      {!isMerging ? (
                        <button
                          disabled={isProcessing}
                          onClick={() => setMergeState(prev => ({ ...prev, [c.id]: '' }))}
                          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 9, background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.3)', color: '#a78bfa', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}
                        >
                          <Merge style={{ width: 14, height: 14 }} />
                          دمج يدوي
                        </button>
                      ) : (
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button
                            disabled={isProcessing || !mergeState[c.id]?.trim()}
                            onClick={() => decide(c.id, 'merged', mergeState[c.id])}
                            style={{ padding: '8px 14px', borderRadius: 9, background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.4)', color: '#a78bfa', cursor: 'pointer', fontWeight: 800, fontSize: 13 }}
                          >
                            حفظ الدمج
                          </button>
                          <button
                            onClick={() => setMergeState(prev => { const n = { ...prev }; delete n[c.id]; return n; })}
                            style={{ padding: '8px 14px', borderRadius: 9, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#64748b', cursor: 'pointer', fontSize: 13 }}
                          >
                            إلغاء
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Done status */}
                  {c.status !== 'pending' && (
                    <div style={{ fontSize: 12, fontWeight: 700, color: c.status === 'approved' ? '#34d399' : c.status === 'merged' ? '#a78bfa' : '#6b7280', display: 'flex', alignItems: 'center', gap: 6 }}>
                      {c.status === 'approved' ? <CheckCircle2 style={{ width: 14, height: 14 }} /> : c.status === 'merged' ? <Merge style={{ width: 14, height: 14 }} /> : <XCircle style={{ width: 14, height: 14 }} />}
                      {c.status === 'approved' ? `✅ تم قبول القيمة الجديدة — بواسطة ${c.reviewed_by || '—'}`
                        : c.status === 'merged' ? `✏️ قيمة مدمجة — ${c.reviewed_by || '—'}`
                        : `🔒 تم الإبقاء على القيمة القديمة — ${c.reviewed_by || '—'}`}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
