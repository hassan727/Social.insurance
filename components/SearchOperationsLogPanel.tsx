'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Download, Trash2, Edit3, CheckCircle2, Search, RefreshCw,
  Plus, Eye, Filter, Calendar, AlertTriangle, ShieldCheck, FileSpreadsheet,
  Copy, Check, X, ChevronDown, CheckSquare, Layers
} from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';

export interface HistoryItem {
  id: string;
  search_query: string;
  national_id: string | null;
  employee_code: string | null;
  employee_name: string | null;
  search_timestamp: string;
  company_account: string | null;
  insurance_status: string | null;
  status: string | null;
  has_resignation: boolean | null;
  first_both_month: string | null;
  attendance_days: string | null;
  search_purpose: string;
  purpose_label: string;
  discrepancy_note: string;
  s1_readiness: string;
  s6_readiness: string;
  archives_status: string;
  archives_supply_date: string;
  insurance_number: string;
  job_title: string;
  phone_number: string;
  checklist_note: string;
  raw_result?: Record<string, unknown>;
}

interface Stats {
  total: number;
  today: number;
  s1_ready: number;
  s6_ready: number;
  discrepancies: number;
  supplied: number;
}

interface Props {
  onSelectEmployee?: (emp: { national_id?: string; employee_code?: string; employee_name?: string }) => void;
  onRefreshCount?: (todayCount: number) => void;
}

const INSURANCE_STATUS_OPTIONS = [
  { value: 'تم التجهيز', label: '✅ تم التجهيز', color: '#34d399', bg: 'rgba(52,211,153,0.15)', border: 'rgba(52,211,153,0.4)' },
  { value: 'جاري التأمين', label: '🔄 جاري التأمين', color: '#38bdf8', bg: 'rgba(56,189,248,0.15)', border: 'rgba(56,189,248,0.4)' },
  { value: 'مؤمن عليه', label: '🛡️ مؤمن عليه', color: '#a78bfa', bg: 'rgba(167,139,250,0.15)', border: 'rgba(167,139,250,0.4)' },
  { value: 'مناقضة', label: '⚠️ مناقضة', color: '#fbbf24', bg: 'rgba(251,191,36,0.15)', border: 'rgba(251,191,36,0.4)' },
  { value: 'تم التوريد', label: '📤 تم التوريد', color: '#818cf8', bg: 'rgba(129,140,248,0.15)', border: 'rgba(129,140,248,0.4)' },
];

/* ─── Copyable Number Helper Component ─── */
function CopyableNumber({ value, label }: { value?: string | null; label?: string }) {
  const [copied, setCopied] = useState(false);
  const str = value && value !== '—' ? String(value).trim() : '';

  if (!str) return <span style={{ color: '#ffffff', opacity: 0.5 }}>—</span>;

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span className="font-mono-pro" style={{ color: '#ffffff', fontWeight: 800, fontSize: 13, letterSpacing: '0.02em' }}>
        {str}
      </span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          navigator.clipboard.writeText(str);
          setCopied(true);
          toast.success(`تم نسخ ${label || 'الرقم'}: ${str}`);
          setTimeout(() => setCopied(false), 1500);
        }}
        style={{
          background: copied ? 'rgba(52,211,153,0.25)' : 'rgba(255,255,255,0.08)',
          border: `1px solid ${copied ? '#34d399' : 'rgba(255,255,255,0.2)'}`,
          borderRadius: 6,
          padding: '2px 5px',
          cursor: 'pointer',
          color: copied ? '#34d399' : '#ffffff',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.15s ease',
        }}
        title={`نسخ ${label || 'الرقم'}`}
      >
        {copied ? (
          <Check style={{ width: 11, height: 11, color: '#34d399' }} />
        ) : (
          <Copy style={{ width: 11, height: 11, color: '#cbd5e1' }} />
        )}
      </button>
    </div>
  );
}

export default function SearchOperationsLogPanel({ onSelectEmployee, onRefreshCount }: Props) {
  const [records, setRecords] = useState<HistoryItem[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, today: 0, s1_ready: 0, s6_ready: 0, discrepancies: 0, supplied: 0 });
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  // Filters
  const [activeTab, setActiveTab] = useState<'all' | 's1' | 's6' | 'discrepancy' | 'supplied' | 'archives' | 'general' | 'details'>('all');
  const [dateFilter, setDateFilter] = useState<'today' | 'all' | 'week'>('today');
  const [uniqueOnly, setUniqueOnly] = useState(true);
  const [tableSearch, setTableSearch] = useState('');

  // Selection Check Marks
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Edit Modal
  const [editingItem, setEditingItem] = useState<HistoryItem | null>(null);
  const [editForm, setEditForm] = useState({
    // بيانات هوية الموظف
    employee_name: '',
    employee_code: '',
    national_id: '',
    // بيانات التأمين
    insurance_number: '',
    insurance_job_title: '',
    subscription_start_date: '',
    insurance_status: 'تم التجهيز',
    discrepancy_note: '',
    // بيانات العمل
    job_title: '',
    company_account: 'EGYPT GAS',
    phone_number: '',
    attendance_days: '',
    first_both_month: '',
    status: 'Active',
    has_resignation: false,
    // تشغيلي
    search_purpose: 'general',
    checklist_note: '',
    syncWithMaster: true,
  });
  const [savingEdit, setSavingEdit] = useState(false);

  // Add Manual Record Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState({
    employee_name: '',
    employee_code: '',
    national_id: '',
    insurance_number: '',
    job_title: '',
    company_account: 'EGYPT GAS',
    insurance_status: 'تم التجهيز',
    discrepancy_note: '',
    search_purpose: 'general',
    checklist_note: '',
  });
  const [savingAdd, setSavingAdd] = useState(false);

  // Bulk Status Update Dropdown
  const [showBulkStatusMenu, setShowBulkStatusMenu] = useState(false);

  // ─── Fetch Data ─────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      p.set('purpose', activeTab);
      p.set('date', dateFilter);
      p.set('unique', String(uniqueOnly));
      if (tableSearch.trim()) p.set('search', tableSearch.trim());

      const res = await fetch(`/api/lookup/search-history?${p.toString()}`);
      const data = await res.json();

      if (data.success) {
        setRecords(data.records || []);
        if (data.stats) {
          setStats(data.stats);
          if (onRefreshCount) onRefreshCount(data.stats.today);
        }
      }
    } catch {
      toast.error('خطأ أثناء جلب سجل العمليات');
    } finally {
      setLoading(false);
    }
  }, [activeTab, dateFilter, uniqueOnly, tableSearch, onRefreshCount]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Clear selections when tab or filter changes
  useEffect(() => {
    setSelectedIds(new Set());
  }, [activeTab, dateFilter, uniqueOnly]);

  // ─── Selection Helpers ──────────────────────────────────────
  const allVisibleSelected = records.length > 0 && records.every((r) => selectedIds.has(r.id));
  const someVisibleSelected = records.some((r) => selectedIds.has(r.id));

  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelectedIds(new Set());
    } else {
      const next = new Set<string>();
      records.forEach((r) => next.add(r.id));
      setSelectedIds(next);
    }
  };

  const toggleSelectRow = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ─── Excel Export (Customized to Purpose & Checkmarks) ──────
  const handleExportExcel = async (exportCheckedOnly = false) => {
    setExporting(true);
    const checkedCount = selectedIds.size;
    const isTargetingChecked = exportCheckedOnly && checkedCount > 0;

    const labelMap: Record<string, string> = {
      all: 'سجل العمليات الشامل',
      s1: 'استمارات سن 1 - تسجيل جديد',
      s6: 'استمارات سن 6 - إنهاء اشتراك',
      discrepancy: 'شيت المناقضات',
      supplied: 'أرقام وارد التأمين - تم التوريد',
      archives: 'سجل الأرشيف والمستندات',
      general: 'سجل البحث العام',
      details: 'تفاصيل الموظف الشاملة',
    };

    const targetLabel = isTargetingChecked
      ? `المحدد (${checkedCount} موظف)`
      : labelMap[activeTab] || 'سجل العمليات';

    toast.info(`جارٍ إعداد وتصدير ملف Excel لـ ${targetLabel}...`);

    try {
      const payload: Record<string, unknown> = {
        purpose: activeTab,
        date: dateFilter,
        unique: uniqueOnly,
      };

      if (isTargetingChecked) {
        payload.ids = Array.from(selectedIds);
      }

      const res = await fetch('/api/lookup/export-search-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'فشل التصدير');
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;

      const disp = res.headers.get('Content-Disposition') || '';
      let filename = `سجل_${activeTab}_${new Date().toISOString().split('T')[0]}.xlsx`;
      if (disp.includes('filename=')) {
        const match = disp.match(/filename="?([^";]+)"?/);
        if (match && match[1]) filename = decodeURIComponent(match[1]);
      }

      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast.success(`تم تصدير ملف Excel بنجاح: ${filename}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'خطأ أثناء التصدير';
      toast.error(msg);
    } finally {
      setExporting(false);
    }
  };

  // ─── Delete Single Record (CRUD: Delete) ────────────────────
  const handleDeleteRow = async (id: string, name?: string | null) => {
    if (!confirm(`هل أنت متأكد من حذف سجل "${name || 'الموظف'}" وكافة عملياته من جدول سجل البحث؟`)) return;

    setRecords((prev) => prev.filter((r) => r.id !== id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

    try {
      const res = await fetch(`/api/lookup/search-history?id=${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message || 'تم حذف السجل بنجاح');
        fetchData();
      } else {
        toast.error(data.error || 'فشل الحذف');
        fetchData();
      }
    } catch {
      toast.error('خطأ أثناء الحذف');
      fetchData();
    }
  };

  // ─── Bulk Delete (CRUD: Delete Selected) ────────────────────
  const handleBulkDelete = async () => {
    const count = selectedIds.size;
    if (count === 0) return;
    if (!confirm(`تحذير: هل أنت متأكد من حذف (${count}) موظف محدد وتطهير كافة سجلاتهم نهائياً من سجل البحث؟`)) return;

    const idsToDelete = Array.from(selectedIds);
    setRecords((prev) => prev.filter((r) => !selectedIds.has(r.id)));
    setSelectedIds(new Set());

    const tid = toast.loading(`جارٍ حذف (${count}) موظف من السجل...`);

    try {
      const res = await fetch('/api/lookup/search-history', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: idsToDelete }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message || `تم حذف ${count} موظف بنجاح`, { id: tid });
        fetchData();
      } else {
        toast.error(data.error || 'فشل الحذف الجماعي', { id: tid });
        fetchData();
      }
    } catch {
      toast.error('خطأ أثناء الحذف الجماعي');
      fetchData();
    }
  };

  // ─── Clear Today's Records ─────────────────────────────────
  const handleClearToday = async () => {
    if (!confirm('تحذير: هل أنت متأكد من مسح جميع عمليات وبحوث اليوم بالكامل؟')) return;

    const tid = toast.loading('جارٍ مسح سجلات اليوم...');
    try {
      const res = await fetch('/api/lookup/search-history', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'clear_today' }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message || 'تم مسح سجلات اليوم بنجاح', { id: tid });
        setSelectedIds(new Set());
        fetchData();
      } else {
        toast.error(data.error || 'فشل مسح سجلات اليوم', { id: tid });
      }
    } catch {
      toast.error('خطأ أثناء مسح سجلات اليوم');
    }
  };

  // ─── Bulk Update Status (CRUD: Update Selected) ─────────────
  const handleBulkUpdateStatus = async (newStatus: string) => {
    const count = selectedIds.size;
    if (count === 0) return;
    setShowBulkStatusMenu(false);

    setRecords((prev) =>
      prev.map((r) => (selectedIds.has(r.id) ? { ...r, insurance_status: newStatus } : r))
    );

    const tid = toast.loading(`جارٍ تحديث حالة (${count}) موظف إلى "${newStatus}"...`);

    try {
      const res = await fetch('/api/lookup/search-history', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids: Array.from(selectedIds),
          insurance_status: newStatus,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message || 'تم التحديث بنجاح', { id: tid });
        fetchData();
      } else {
        toast.error(data.error || 'فشل التحديث', { id: tid });
      }
    } catch {
      toast.error('خطأ أثناء التحديث', { id: tid });
    }
  };

  // ─── Open Edit Modal (CRUD: Read for Edit) ──────────────────
  const openEditModal = (item: HistoryItem) => {
    setEditingItem(item);
    const raw = (item.raw_result || {}) as Record<string, unknown>;
    setEditForm({
      // هوية الموظف — من الحقول المباشرة أولاً ثم من JSONB كاحتياط
      employee_name: item.employee_name || (raw.employee_name as string) || '',
      employee_code: item.employee_code || (raw.employee_code as string) || '',
      national_id:   item.national_id  || (raw.national_id  as string) || '',
      // تأمين
      insurance_number:      item.insurance_number || (raw.insurance_number as string) || '',
      insurance_job_title:   (raw.insurance_job_title as string) || '',
      subscription_start_date: item.first_both_month || (raw.subscription_start_date as string) || (raw.first_both_month as string) || '',
      insurance_status:      item.insurance_status || 'تم التجهيز',
      discrepancy_note:      item.discrepancy_note || '',
      // عمل
      job_title:       item.job_title       || (raw.job_title       as string) || '',
      company_account: item.company_account || (raw.company_account as string) || 'EGYPT GAS',
      phone_number:    item.phone_number    || (raw.phone_number    as string) || '',
      attendance_days: item.attendance_days || (raw.attendance_days as string) || '',
      first_both_month: item.first_both_month || (raw.first_both_month as string) || '',
      status:          item.status   || (raw.status as string) || 'Active',
      has_resignation: item.has_resignation ?? Boolean(raw.has_resignation),
      // تشغيلي
      search_purpose: item.search_purpose || 'general',
      checklist_note: item.checklist_note || '',
      syncWithMaster: true,
    });
  };

  // ─── Save Edit (CRUD: Update) ───────────────────────────────
  const handleSaveEdit = async () => {
    if (!editingItem) return;
    setSavingEdit(true);

    try {
      const res = await fetch('/api/lookup/search-history', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingItem.id,
          // هوية الموظف
          employee_name:    editForm.employee_name    || undefined,
          employee_code:    editForm.employee_code    || undefined,
          national_id:      editForm.national_id      || undefined,
          // بيانات التأمين
          insurance_number:       editForm.insurance_number       || undefined,
          insurance_job_title:    editForm.insurance_job_title    || undefined,
          subscription_start_date: editForm.subscription_start_date || editForm.first_both_month || undefined,
          insurance_status:       editForm.insurance_status,
          discrepancy_note:       editForm.discrepancy_note,
          // بيانات العمل
          job_title:        editForm.job_title        || undefined,
          company_account:  editForm.company_account  || undefined,
          phone_number:     editForm.phone_number     || undefined,
          attendance_days:  editForm.attendance_days  || undefined,
          first_both_month: editForm.first_both_month || undefined,
          status:           editForm.status           || undefined,
          has_resignation:  editForm.has_resignation,
          // تشغيلي
          search_purpose:   editForm.search_purpose,
          checklist_note:   editForm.checklist_note,
          syncWithMaster:   editForm.syncWithMaster,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('✅ تم تحديث بيانات الموظف في جميع الجداول بنجاح');
        setEditingItem(null);
        fetchData();
      } else {
        toast.error(data.error || 'فشل التحديث');
      }
    } catch {
      toast.error('خطأ أثناء تحديث السجل');
    } finally {
      setSavingEdit(false);
    }
  };

  // ─── Save Manual Add (CRUD: Create) ─────────────────────────
  const handleSaveAdd = async () => {
    if (!addForm.employee_name && !addForm.national_id && !addForm.employee_code) {
      toast.info('يرجى إدخال اسم الموظف أو الرقم القومي أو الكود');
      return;
    }
    setSavingAdd(true);

    try {
      const res = await fetch('/api/lookup/search-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(addForm),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message || 'تمت إضافة العملية بنجاح');
        setShowAddModal(false);
        setAddForm({
          employee_name: '', employee_code: '', national_id: '',
          insurance_number: '', job_title: '', company_account: 'EGYPT GAS',
          insurance_status: 'تم التجهيز', discrepancy_note: '',
          search_purpose: 'general', checklist_note: '',
        });
        fetchData();
      } else {
        toast.error(data.error || 'فشلت الإضافة');
      }
    } catch {
      toast.error('خطأ أثناء إضافة العملية');
    } finally {
      setSavingAdd(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

      {/* ══════════════════════════════════════════════════════════
          1. STATS OVERVIEW CARDS
      ══════════════════════════════════════════════════════════ */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        {[
          { label: 'إجمالي سجل البحث', val: stats.total, color: '#818cf8', bg: 'rgba(99,102,241,0.1)', border: 'rgba(99,102,241,0.25)', icon: Search },
          { label: 'عمليات اليوم', val: stats.today, color: '#38bdf8', bg: 'rgba(56,189,248,0.1)', border: 'rgba(56,189,248,0.25)', icon: Calendar, badge: 'اليوم' },
          { label: 'جاهز س1 (تسجيل جديد)', val: stats.s1_ready, color: '#34d399', bg: 'rgba(52,211,153,0.1)', border: 'rgba(52,211,153,0.25)', icon: FileSpreadsheet },
          { label: 'جاهز س6 / مستقيل', val: stats.s6_ready, color: '#fda4af', bg: 'rgba(253,164,175,0.1)', border: 'rgba(253,164,175,0.25)', icon: AlertTriangle },
          { label: 'مناقضات تحتاج استيفاء', val: stats.discrepancies, color: '#fbbf24', bg: 'rgba(251,191,36,0.1)', border: 'rgba(251,191,36,0.25)', icon: AlertTriangle },
          { label: 'تم التوريد فعلياً', val: stats.supplied, color: '#a78bfa', bg: 'rgba(167,139,250,0.1)', border: 'rgba(167,139,250,0.25)', icon: ShieldCheck },
        ].map((c, i) => (
          <div
            key={i}
            style={{
              padding: '14px 16px', borderRadius: 16,
              background: c.bg, border: `1.5px solid ${c.border}`,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}
          >
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#ffffff', marginBottom: 4, opacity: 0.9 }}>{c.label}</div>
              <div style={{ fontSize: 22, fontWeight: 900, color: c.color }} className="font-mono-pro">{c.val}</div>
            </div>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: 'rgba(0,0,0,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <c.icon style={{ width: 18, height: 18, color: c.color }} />
            </div>
          </div>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════
          2. PURPOSE TABS (غرض العملية المحدد للتصدير والعرض)
      ══════════════════════════════════════════════════════════ */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '10px 14px', borderRadius: 16, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 800, color: '#ffffff', marginLeft: 8 }}>
          <Filter style={{ width: 14, height: 14, color: '#818cf8' }} />
          <span>تصفية الغرض:</span>
        </div>

        {[
          { key: 'all', label: 'الكل (All)', emoji: '🌐', color: '#ffffff' },
          { key: 's1', label: 'س1 — تسجيل جديد', emoji: '📋', color: '#34d399' },
          { key: 's6', label: 'س6 — إنهاء اشتراك', emoji: '🔴', color: '#fda4af' },
          { key: 'discrepancy', label: 'شيت المناقضات', emoji: '⚠️', color: '#fbbf24' },
          { key: 'supplied', label: 'تم التوريد', emoji: '📤', color: '#818cf8' },
          { key: 'archives', label: 'الأرشيف والمستندات', emoji: '📁', color: '#38bdf8' },
          { key: 'general', label: 'بحث عام', emoji: '🔍', color: '#cbd5e1' },
          { key: 'details', label: 'تفاصيل موظف', emoji: '👤', color: '#a78bfa' },
        ].map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key as typeof activeTab)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '6px 14px', borderRadius: 10, fontSize: 12,
                fontWeight: isActive ? 800 : 600,
                background: isActive ? `${tab.color}25` : 'rgba(255,255,255,0.03)',
                border: `1.5px solid ${isActive ? tab.color : 'rgba(255,255,255,0.08)'}`,
                color: '#ffffff',
                cursor: 'pointer', transition: 'all 0.15s ease',
              }}
            >
              <span>{tab.emoji}</span>
              <span>{tab.label}</span>
              {isActive && <Check style={{ width: 12, height: 12, color: tab.color }} />}
            </button>
          );
        })}
      </div>

      {/* ══════════════════════════════════════════════════════════
          3. TOOLBAR: Search, Dates, Actions & Selection Banner
      ══════════════════════════════════════════════════════════ */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 16px', borderRadius: 16, background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)' }}>

        {/* Left Side: Filter inputs */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, flex: 1, minWidth: 280 }}>
          {/* Quick search input */}
          <div style={{ position: 'relative', minWidth: 240, flex: 1 }}>
            <Search style={{ width: 14, height: 14, color: '#818cf8', position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)' }} />
            <input
              type="text"
              value={tableSearch}
              onChange={(e) => setTableSearch(e.target.value)}
              placeholder="فلترة بالاسم أو الكود أو الرقم القومي أو الهاتف..."
              style={{
                width: '100%', padding: '8px 36px 8px 12px', borderRadius: 10,
                background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                color: '#ffffff', fontSize: 12, outline: 'none', boxSizing: 'border-box',
              }}
            />
            {tableSearch && (
              <button
                type="button"
                onClick={() => setTableSearch('')}
                style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer' }}
              >
                <X style={{ width: 12, height: 12 }} />
              </button>
            )}
          </div>

          {/* Date Range Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(255,255,255,0.03)', padding: 3, borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)' }}>
            {[
              { key: 'today', label: 'اليوم' },
              { key: 'week', label: 'آخر 7 أيام' },
              { key: 'all', label: 'كل التواريخ' },
            ].map((d) => (
              <button
                key={d.key}
                type="button"
                onClick={() => setDateFilter(d.key as typeof dateFilter)}
                style={{
                  padding: '5px 10px', borderRadius: 8, fontSize: 11,
                  fontWeight: dateFilter === d.key ? 800 : 600,
                  background: dateFilter === d.key ? '#818cf8' : 'transparent',
                  color: dateFilter === d.key ? '#0f172a' : '#ffffff',
                  border: 'none', cursor: 'pointer',
                }}
              >
                {d.label}
              </button>
            ))}
          </div>

          {/* Unique only toggle */}
          <button
            type="button"
            onClick={() => setUniqueOnly(!uniqueOnly)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '6px 12px', borderRadius: 10, fontSize: 11,
              fontWeight: uniqueOnly ? 800 : 600,
              background: uniqueOnly ? 'rgba(52,211,153,0.15)' : 'rgba(255,255,255,0.03)',
              border: `1px solid ${uniqueOnly ? '#34d399' : 'rgba(255,255,255,0.08)'}`,
              color: '#ffffff',
              cursor: 'pointer',
            }}
          >
            <CheckCircle2 style={{ width: 13, height: 13, color: uniqueOnly ? '#34d399' : '#ffffff' }} />
            <span>أحدث عملية فقط (منع التكرار)</span>
          </button>

          {/* Refresh */}
          <button
            type="button"
            onClick={fetchData}
            disabled={loading}
            style={{
              padding: 8, borderRadius: 10, background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)', color: '#ffffff', cursor: 'pointer',
            }}
            title="تحديث البيانات"
          >
            <RefreshCw style={{ width: 14, height: 14, animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          </button>
        </div>

        {/* Right Side: Export & Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Clear Today Button */}
          <button
            type="button"
            onClick={handleClearToday}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '8px 12px', borderRadius: 10, fontSize: 12, fontWeight: 700,
              background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)',
              color: '#fca5a5', cursor: 'pointer',
            }}
            title="مسح جميع عمليات وبحوث اليوم دفعة واحدة وتطهير السجل"
          >
            <Trash2 style={{ width: 13, height: 13 }} />
            <span>مسح سجلات اليوم</span>
          </button>

          {/* Add Manual Record */}
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '8px 14px', borderRadius: 10, fontSize: 12, fontWeight: 700,
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
              color: '#ffffff', cursor: 'pointer',
            }}
          >
            <Plus style={{ width: 14, height: 14, color: '#38bdf8' }} />
            <span>إضافة عملية يدوياً</span>
          </button>

          {/* Export Button (Dynamic: Checked Only vs Whole Tab) */}
          <button
            type="button"
            onClick={() => handleExportExcel(selectedIds.size > 0)}
            disabled={exporting || records.length === 0}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '8px 16px', borderRadius: 10, fontSize: 12, fontWeight: 800,
              background: selectedIds.size > 0 ? '#10b981' : '#6366f1',
              border: 'none', color: '#ffffff',
              cursor: exporting || records.length === 0 ? 'not-allowed' : 'pointer',
              opacity: exporting || records.length === 0 ? 0.6 : 1,
              boxShadow: selectedIds.size > 0 ? '0 0 14px rgba(16,185,129,0.4)' : 'none',
              transition: 'all 0.15s ease',
            }}
          >
            <Download style={{ width: 15, height: 15 }} />
            <span>
              {exporting
                ? 'جارٍ التصدير...'
                : selectedIds.size > 0
                ? `تصدير المحدد فقط (${selectedIds.size}) إلى Excel`
                : `تصدير [${activeTab === 'all' ? 'الكل' : activeTab.toUpperCase()}] إلى Excel`}
            </span>
          </button>
        </div>
      </div>

      {/* ── Selection Action Banner (When rows are checked) ── */}
      <AnimatePresence>
        {selectedIds.size > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            style={{
              padding: '10px 16px', borderRadius: 12,
              background: 'rgba(16,185,129,0.12)', border: '1.5px solid rgba(16,185,129,0.4)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <CheckSquare style={{ width: 18, height: 18, color: '#34d399' }} />
              <span style={{ fontSize: 13, fontWeight: 800, color: '#ffffff' }}>
                تم تحديد <strong style={{ color: '#34d399' }}>{selectedIds.size}</strong> موظف من أصل {records.length}
              </span>
              {!allVisibleSelected && (
                <button
                  type="button"
                  onClick={toggleSelectAll}
                  style={{
                    padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 800,
                    background: 'rgba(52,211,153,0.2)', border: '1px solid rgba(52,211,153,0.4)',
                    color: '#86efac', cursor: 'pointer',
                  }}
                  title="تحديد كافة الموظفين الظاهرين في الجدول حالياً"
                >
                  ✓ تحديد جميع الـ ({records.length}) الظاهرين
                </button>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, position: 'relative' }}>
              {/* Bulk Status Update Menu */}
              <div style={{ position: 'relative' }}>
                <button
                  type="button"
                  onClick={() => setShowBulkStatusMenu(!showBulkStatusMenu)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 800,
                    background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)',
                    color: '#ffffff', cursor: 'pointer',
                  }}
                >
                  <Edit3 style={{ width: 12, height: 12 }} />
                  <span>تعديل الحالة للمحدد</span>
                  <ChevronDown style={{ width: 12, height: 12 }} />
                </button>

                {showBulkStatusMenu && (
                  <div
                    style={{
                      position: 'absolute', top: 'calc(100% + 4px)', left: 0,
                      background: '#0f172a', border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: 10, padding: 6, zIndex: 50, minWidth: 160,
                      boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
                      display: 'flex', flexDirection: 'column', gap: 4,
                    }}
                  >
                    {INSURANCE_STATUS_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => handleBulkUpdateStatus(opt.value)}
                        style={{
                          padding: '6px 10px', borderRadius: 6, textAlign: 'right',
                          background: 'transparent', border: 'none', color: opt.color,
                          fontSize: 12, fontWeight: 700, cursor: 'pointer',
                        }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Bulk Delete */}
              <button
                type="button"
                onClick={handleBulkDelete}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 800,
                  background: 'rgba(239,68,68,0.25)', border: '1px solid rgba(239,68,68,0.4)',
                  color: '#fca5a5', cursor: 'pointer',
                }}
              >
                <Trash2 style={{ width: 12, height: 12 }} />
                <span>حذف المحدد ({selectedIds.size})</span>
              </button>

              {/* Clear selection */}
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                style={{
                  padding: '6px 10px', borderRadius: 8, fontSize: 11,
                  background: 'transparent', border: 'none', color: '#ffffff', cursor: 'pointer',
                  opacity: 0.8,
                }}
              >
                إلغاء التحديد
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ══════════════════════════════════════════════════════════
          4. DYNAMIC TABLE (ALL VALUES WHITE + COPYABLE NUMBERS)
      ══════════════════════════════════════════════════════════ */}
      <div style={{ borderRadius: 18, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(15,23,42,0.85)' }}>
        <div style={{ overflowX: 'auto', maxHeight: 580 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                {/* Header Checkbox */}
                <th
                  style={{
                    padding: '12px 14px', width: 44, textAlign: 'center', cursor: 'pointer',
                    userSelect: 'none',
                  }}
                  onClick={toggleSelectAll}
                  title={allVisibleSelected ? 'إلغاء تحديد الكل' : 'تحديد كل الظاهرين في الجدول'}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someVisibleSelected && !allVisibleSelected;
                      }}
                      onChange={toggleSelectAll}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        width: 18, height: 18, cursor: 'pointer',
                        accentColor: '#10b981',
                      }}
                    />
                  </div>
                </th>
                <th style={{ padding: '12px 10px', width: 40, color: '#ffffff', fontWeight: 800 }}>#</th>
                <th style={{ padding: '12px 14px', color: '#ffffff', fontWeight: 800 }}>اسم الموظف</th>
                <th style={{ padding: '12px 12px', color: '#ffffff', fontWeight: 800 }}>الكود</th>
                <th style={{ padding: '12px 12px', color: '#ffffff', fontWeight: 800 }}>الرقم القومي</th>
                <th style={{ padding: '12px 12px', color: '#ffffff', fontWeight: 800 }}>الرقم التأميني</th>

                {/* ── Dynamic Columns based on activeTab ── */}
                {activeTab === 's1' ? (
                  <>
                    <th style={{ padding: '12px 12px', color: '#ffffff', fontWeight: 800 }}>مهنة التأمينات</th>
                    <th style={{ padding: '12px 12px', color: '#38bdf8', fontWeight: 800 }}>بداية الاشتراك (س1)</th>
                    <th style={{ padding: '12px 14px', color: '#34d399', fontWeight: 800 }}>جاهزية س1</th>
                    <th style={{ padding: '12px 14px', color: '#ffffff', fontWeight: 800 }}>الحالة التأمينية</th>
                    <th style={{ padding: '12px 12px', color: '#ffffff', fontWeight: 800 }}>الشركة</th>
                    <th style={{ padding: '12px 12px', color: '#ffffff', fontWeight: 800 }}>أيام الحضور</th>
                  </>
                ) : activeTab === 's6' ? (
                  <>
                    <th style={{ padding: '12px 14px', color: '#fda4af', fontWeight: 800 }}>حالة استمارة س6</th>
                    <th style={{ padding: '12px 12px', color: '#ffffff', fontWeight: 800 }}>تاريخ الاستقالة</th>
                    <th style={{ padding: '12px 12px', color: '#ffffff', fontWeight: 800 }}>آخر يوم عمل</th>
                    <th style={{ padding: '12px 12px', color: '#fda4af', fontWeight: 800 }}>نهاية الاشتراك</th>
                    <th style={{ padding: '12px 12px', color: '#ffffff', fontWeight: 800 }}>نوع التوريد</th>
                    <th style={{ padding: '12px 12px', color: '#ffffff', fontWeight: 800 }}>الشركة</th>
                  </>
                ) : activeTab === 'discrepancy' ? (
                  <>
                    <th style={{ padding: '12px 14px', color: '#fbbf24', fontWeight: 800 }}>نوع / سبب المناقضة (المستند الناقص)</th>
                    <th style={{ padding: '12px 14px', color: '#ffffff', fontWeight: 800 }}>الحالة التأمينية</th>
                    <th style={{ padding: '12px 12px', color: '#ffffff', fontWeight: 800 }}>الشركة</th>
                    <th style={{ padding: '12px 12px', color: '#ffffff', fontWeight: 800 }}>رقم الهاتف</th>
                    <th style={{ padding: '12px 12px', color: '#ffffff', fontWeight: 800 }}>تاريخ الرصد</th>
                  </>
                ) : activeTab === 'supplied' ? (
                  <>
                    <th style={{ padding: '12px 14px', color: '#818cf8', fontWeight: 800 }}>حالة التوريد</th>
                    <th style={{ padding: '12px 12px', color: '#ffffff', fontWeight: 800 }}>تاريخ التوريد</th>
                    <th style={{ padding: '12px 12px', color: '#ffffff', fontWeight: 800 }}>نوع التوريد</th>
                    <th style={{ padding: '12px 12px', color: '#ffffff', fontWeight: 800 }}>الشركة</th>
                    <th style={{ padding: '12px 12px', color: '#ffffff', fontWeight: 800 }}>الوظيفة</th>
                  </>
                ) : activeTab === 'archives' ? (
                  <>
                    <th style={{ padding: '12px 14px', color: '#38bdf8', fontWeight: 800 }}>حالة التوريد</th>
                    <th style={{ padding: '12px 12px', color: '#ffffff', fontWeight: 800 }}>تاريخ التوريد</th>
                    <th style={{ padding: '12px 14px', color: '#ffffff', fontWeight: 800 }}>نسبة الاستيفاء</th>
                    <th style={{ padding: '12px 12px', color: '#ffffff', fontWeight: 800 }}>الملاحظات</th>
                  </>
                ) : activeTab === 'general' ? (
                  <>
                    <th style={{ padding: '12px 12px', color: '#ffffff', fontWeight: 800 }}>الوظيفة</th>
                    <th style={{ padding: '12px 12px', color: '#ffffff', fontWeight: 800 }}>الشركة</th>
                    <th style={{ padding: '12px 14px', color: '#ffffff', fontWeight: 800 }}>الحالة التأمينية</th>
                    <th style={{ padding: '12px 12px', color: '#ffffff', fontWeight: 800 }}>أيام الحضور</th>
                    <th style={{ padding: '12px 12px', color: '#ffffff', fontWeight: 800 }}>مستقيل؟</th>
                    <th style={{ padding: '12px 12px', color: '#ffffff', fontWeight: 800 }}>تاريخ البحث</th>
                  </>
                ) : (
                  <>
                    <th style={{ padding: '12px 12px', color: '#ffffff', fontWeight: 800 }}>الشركة</th>
                    <th style={{ padding: '12px 12px', color: '#ffffff', fontWeight: 800 }}>غرض العملية</th>
                    <th style={{ padding: '12px 14px', color: '#ffffff', fontWeight: 800 }}>الحالة التأمينية</th>
                    <th style={{ padding: '12px 14px', color: '#ffffff', fontWeight: 800 }}>التفاصيل والملاحظات</th>
                    <th style={{ padding: '12px 12px', color: '#ffffff', fontWeight: 800 }}>وقت وتاريخ الإجراء</th>
                  </>
                )}

                <th style={{ padding: '12px 14px', color: '#ffffff', fontWeight: 800, textAlign: 'center', width: 120 }}>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {loading && records.length === 0 && (
                <tr>
                  <td colSpan={13} style={{ padding: '40px 20px', textAlign: 'center', color: '#ffffff' }}>
                    <RefreshCw style={{ width: 24, height: 24, animation: 'spin 1s linear infinite', margin: '0 auto 10px', color: '#818cf8' }} />
                    <div style={{ color: '#ffffff', fontWeight: 700 }}>جارٍ تحميل سجل العمليات والبحث...</div>
                  </td>
                </tr>
              )}

              {!loading && records.length === 0 && (
                <tr>
                  <td colSpan={13} style={{ padding: '50px 20px', textAlign: 'center' }}>
                    <Search style={{ width: 28, height: 28, margin: '0 auto 10px', color: '#818cf8' }} />
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#ffffff' }}>لا توجد سجلات مطابقة للفلتر المحدد</div>
                    <div style={{ fontSize: 11, marginTop: 4, color: '#ffffff', opacity: 0.7 }}>جرب تغيير غرض العملية أو نطاق التاريخ</div>
                  </td>
                </tr>
              )}

              {records.map((r, idx) => {
                const isSelected = selectedIds.has(r.id);
                const statusOpt = INSURANCE_STATUS_OPTIONS.find((o) => o.value === r.insurance_status) || {
                  label: r.insurance_status || 'تم التجهيز',
                  color: '#ffffff',
                  bg: 'rgba(255,255,255,0.1)',
                  border: 'rgba(255,255,255,0.2)',
                };

                const dateObj = new Date(r.search_timestamp);
                const formattedTime = dateObj.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
                const formattedDate = dateObj.toLocaleDateString('ar-EG', { month: '2-digit', day: '2-digit' });

                return (
                  <tr
                    key={r.id}
                    style={{
                      borderBottom: '1px solid rgba(255,255,255,0.05)',
                      background: isSelected ? 'rgba(99,102,241,0.12)' : 'transparent',
                      transition: 'background 0.1s ease',
                    }}
                  >
                    {/* Row Checkbox */}
                    <td
                      style={{ padding: '10px 14px', textAlign: 'center', cursor: 'pointer' }}
                      onClick={() => toggleSelectRow(r.id)}
                      title={isSelected ? 'إلغاء تحديد هذا الموظف' : 'تحديد هذا الموظف'}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectRow(r.id)}
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            width: 18, height: 18, cursor: 'pointer',
                            accentColor: '#10b981',
                          }}
                        />
                      </div>
                    </td>

                    {/* # Index */}
                    <td style={{ padding: '10px 10px', color: '#ffffff', fontWeight: 800, fontSize: 12 }}>{idx + 1}</td>

                    {/* Name */}
                    <td style={{ padding: '10px 14px', fontWeight: 800, color: '#ffffff' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ color: '#ffffff', fontSize: 13 }}>{r.employee_name || 'بدون اسم'}</span>
                        {r.has_resignation && (
                          <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 4, background: 'rgba(244,63,94,0.25)', color: '#ffffff', border: '1px solid #f43f5e', fontWeight: 800 }}>
                            مستقيل
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Code (Copyable) */}
                    <td style={{ padding: '10px 12px' }}>
                      <CopyableNumber value={r.employee_code} label="كود الموظف" />
                    </td>

                    {/* National ID (Copyable) */}
                    <td style={{ padding: '10px 12px' }}>
                      <CopyableNumber value={r.national_id} label="الرقم القومي" />
                    </td>

                    {/* Insurance Number (Copyable) */}
                    <td style={{ padding: '10px 12px' }}>
                      <CopyableNumber value={r.insurance_number} label="الرقم التأميني" />
                    </td>

                    {/* ── Dynamic Cells Based on activeTab ── */}
                    {activeTab === 's1' ? (
                      <>
                        <td style={{ padding: '10px 12px', color: '#ffffff', fontWeight: 700 }}>
                          {r.job_title || '—'}
                        </td>
                        <td style={{ padding: '10px 12px', color: '#ffffff', fontWeight: 700 }} className="font-mono-pro">
                          {r.s1_readiness.includes('(') ? r.s1_readiness.split('(')[1].replace(')', '') : '—'}
                        </td>
                        <td style={{ padding: '10px 14px', color: '#34d399', fontWeight: 800 }}>
                          {r.s1_readiness}
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          <span style={{ display: 'inline-block', fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 8, background: statusOpt.bg, color: '#ffffff', border: `1px solid ${statusOpt.color}` }}>
                            {statusOpt.label}
                          </span>
                        </td>
                        <td style={{ padding: '10px 12px', color: '#ffffff', fontWeight: 700 }}>{r.company_account || '—'}</td>
                        <td style={{ padding: '10px 12px', color: '#ffffff', fontWeight: 800 }} className="font-mono-pro">{r.attendance_days ? `${r.attendance_days} يوم` : '—'}</td>
                      </>
                    ) : activeTab === 's6' ? (
                      <>
                        <td style={{ padding: '10px 14px', color: '#fda4af', fontWeight: 800 }}>
                          {r.s6_readiness}
                        </td>
                        <td style={{ padding: '10px 12px', color: '#ffffff', fontWeight: 700 }} className="font-mono-pro">
                          {r.has_resignation ? 'مسجل' : '—'}
                        </td>
                        <td style={{ padding: '10px 12px', color: '#ffffff', fontWeight: 700 }} className="font-mono-pro">—</td>
                        <td style={{ padding: '10px 12px', color: '#ffffff', fontWeight: 700 }} className="font-mono-pro">—</td>
                        <td style={{ padding: '10px 12px', color: '#ffffff', fontWeight: 700 }}>يدوي</td>
                        <td style={{ padding: '10px 12px', color: '#ffffff', fontWeight: 700 }}>{r.company_account || '—'}</td>
                      </>
                    ) : activeTab === 'discrepancy' ? (
                      <>
                        <td style={{ padding: '10px 14px', color: '#fbbf24', fontWeight: 800, maxWidth: 280 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <AlertTriangle style={{ width: 13, height: 13, flexShrink: 0 }} />
                            <span>{r.discrepancy_note || 'نقص استيفاء أوراق'}</span>
                          </div>
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          <span style={{ display: 'inline-block', fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 8, background: 'rgba(251,191,36,0.2)', color: '#ffffff', border: '1px solid #fbbf24' }}>
                            ⚠️ مناقضة
                          </span>
                        </td>
                        <td style={{ padding: '10px 12px', color: '#ffffff', fontWeight: 700 }}>{r.company_account || '—'}</td>
                        <td style={{ padding: '10px 12px' }}>
                          <CopyableNumber value={r.phone_number} label="رقم الهاتف" />
                        </td>
                        <td style={{ padding: '10px 12px', color: '#ffffff', fontWeight: 700 }}>{formattedDate}</td>
                      </>
                    ) : activeTab === 'supplied' ? (
                      <>
                        <td style={{ padding: '10px 14px', color: '#818cf8', fontWeight: 800 }}>
                          تم التوريد فعلياً
                        </td>
                        <td style={{ padding: '10px 12px', color: '#ffffff', fontWeight: 700 }} className="font-mono-pro">
                          {r.archives_supply_date || formattedDate}
                        </td>
                        <td style={{ padding: '10px 12px', color: '#ffffff', fontWeight: 700 }}>يدوي / وارد التأمينات</td>
                        <td style={{ padding: '10px 12px', color: '#ffffff', fontWeight: 700 }}>{r.company_account || '—'}</td>
                        <td style={{ padding: '10px 12px', color: '#ffffff', fontWeight: 700 }}>{r.job_title || '—'}</td>
                      </>
                    ) : activeTab === 'archives' ? (
                      <>
                        <td style={{ padding: '10px 14px', color: '#38bdf8', fontWeight: 800 }}>
                          {r.archives_status || '—'}
                        </td>
                        <td style={{ padding: '10px 12px', color: '#ffffff', fontWeight: 700 }} className="font-mono-pro">
                          {r.archives_supply_date || formattedDate}
                        </td>
                        <td style={{ padding: '10px 14px', color: '#34d399', fontWeight: 800 }}>
                          مستوفى
                        </td>
                        <td style={{ padding: '10px 12px', color: '#ffffff', fontWeight: 700 }}>
                          {r.checklist_note || '—'}
                        </td>
                      </>
                    ) : activeTab === 'general' ? (
                      <>
                        <td style={{ padding: '10px 12px', color: '#ffffff', fontWeight: 700 }}>{r.job_title || '—'}</td>
                        <td style={{ padding: '10px 12px', color: '#ffffff', fontWeight: 700 }}>{r.company_account || '—'}</td>
                        <td style={{ padding: '10px 14px' }}>
                          <span style={{ display: 'inline-block', fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 8, background: statusOpt.bg, color: '#ffffff', border: `1px solid ${statusOpt.color}` }}>
                            {statusOpt.label}
                          </span>
                        </td>
                        <td style={{ padding: '10px 12px', color: '#ffffff', fontWeight: 800 }} className="font-mono-pro">{r.attendance_days ? `${r.attendance_days} يوم` : '—'}</td>
                        <td style={{ padding: '10px 12px', color: '#ffffff', fontWeight: 800 }}>{r.has_resignation ? 'نعم ⚠' : 'لا ✓'}</td>
                        <td style={{ padding: '10px 12px', color: '#ffffff', fontWeight: 700 }}>{formattedDate}</td>
                      </>
                    ) : (
                      <>
                        <td style={{ padding: '10px 12px', color: '#ffffff', fontWeight: 700 }}>
                          {r.company_account || '—'}
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 8px', borderRadius: 6, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.2)', color: '#ffffff' }}>
                            {r.purpose_label}
                          </span>
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          <span style={{ display: 'inline-block', fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 8, background: statusOpt.bg, color: '#ffffff', border: `1px solid ${statusOpt.color}` }}>
                            {statusOpt.label}
                          </span>
                        </td>
                        <td style={{ padding: '10px 14px', maxWidth: 260, color: '#ffffff' }}>
                          {r.discrepancy_note ? (
                            <div style={{ color: '#fbbf24', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, fontWeight: 800 }}>
                              <AlertTriangle style={{ width: 12, height: 12, flexShrink: 0 }} />
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {r.discrepancy_note}
                              </span>
                            </div>
                          ) : r.s1_readiness !== '—' && r.search_purpose === 's1' ? (
                            <span style={{ color: '#ffffff', fontSize: 12, fontWeight: 700 }}>{r.s1_readiness}</span>
                          ) : r.s6_readiness !== '—' && r.search_purpose === 's6' ? (
                            <span style={{ color: '#ffffff', fontSize: 12, fontWeight: 700 }}>{r.s6_readiness}</span>
                          ) : r.checklist_note ? (
                            <span style={{ color: '#ffffff', fontSize: 12, fontWeight: 700 }}>{r.checklist_note}</span>
                          ) : (
                            <span style={{ color: '#ffffff', opacity: 0.5 }}>—</span>
                          )}
                        </td>
                        <td style={{ padding: '10px 12px', color: '#ffffff', fontSize: 11, whiteSpace: 'nowrap', fontWeight: 700 }}>
                          {formattedDate} <span>({formattedTime})</span>
                        </td>
                      </>
                    )}

                    {/* Actions */}
                    <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                        {onSelectEmployee && (
                          <button
                            type="button"
                            onClick={() => onSelectEmployee({ national_id: r.national_id || undefined, employee_code: r.employee_code || undefined, employee_name: r.employee_name || undefined })}
                            style={{
                              padding: 6, borderRadius: 6, background: 'rgba(99,102,241,0.2)',
                              border: '1px solid rgba(99,102,241,0.4)', color: '#ffffff', cursor: 'pointer',
                            }}
                            title="استدعاء وفتح ملف الموظف فوراً"
                          >
                            <Eye style={{ width: 13, height: 13 }} />
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => openEditModal(r)}
                          style={{
                            padding: 6, borderRadius: 6, background: 'rgba(56,189,248,0.2)',
                            border: '1px solid rgba(56,189,248,0.4)', color: '#ffffff', cursor: 'pointer',
                          }}
                          title="تعديل بيانات وسجل العملية"
                        >
                          <Edit3 style={{ width: 13, height: 13 }} />
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDeleteRow(r.id, r.employee_name)}
                          style={{
                            padding: 6, borderRadius: 6, background: 'rgba(239,68,68,0.2)',
                            border: '1px solid rgba(239,68,68,0.4)', color: '#ffffff', cursor: 'pointer',
                          }}
                          title="حذف من سجل البحث"
                        >
                          <Trash2 style={{ width: 13, height: 13 }} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════
          5. EDIT MODAL (CRUD: UPDATE)
      ══════════════════════════════════════════════════════════ */}
      <AnimatePresence>
        {editingItem && (
          <div
            style={{
              position: 'fixed', inset: 0, zIndex: 1000,
              background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(10px)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
            }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              style={{
                width: '100%', maxWidth: 680, borderRadius: 20,
                background: '#0f172a', border: '1.5px solid rgba(99,102,241,0.4)',
                boxShadow: '0 25px 60px rgba(0,0,0,0.85)',
                padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: 16,
                maxHeight: '92vh', overflowY: 'auto',
              }}
            >
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Edit3 style={{ width: 18, height: 18, color: '#38bdf8' }} />
                  <div>
                    <h3 style={{ fontSize: 16, fontWeight: 900, color: '#ffffff', margin: 0 }}>
                      تعديل بيانات الموظف — تحديث شامل لجميع الجداول
                    </h3>
                    <p style={{ fontSize: 11, color: '#94a3b8', margin: '3px 0 0' }}>
                      {editingItem.employee_name} — {editingItem.employee_code || editingItem.national_id}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingItem(null)}
                  style={{ background: 'transparent', border: 'none', color: '#ffffff', cursor: 'pointer' }}
                >
                  <X style={{ width: 18, height: 18 }} />
                </button>
              </div>

              {/* ── قسم 1: هوية الموظف ── */}
              <div style={{ background: 'rgba(99,102,241,0.07)', borderRadius: 12, padding: '14px 16px', border: '1px solid rgba(99,102,241,0.2)' }}>
                <p style={{ fontSize: 11, fontWeight: 800, color: '#a5b4fc', margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  🪪 بيانات هوية الموظف
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: '#e2e8f0', display: 'block', marginBottom: 4 }}>الاسم الرباعي:</label>
                    <input
                      type="text"
                      value={editForm.employee_name}
                      onChange={(e) => setEditForm((p) => ({ ...p, employee_name: e.target.value }))}
                      placeholder="الاسم الكامل..."
                      style={{ width: '100%', padding: '8px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', color: '#ffffff', fontSize: 12, outline: 'none', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: '#e2e8f0', display: 'block', marginBottom: 4 }}>كود الموظف:</label>
                    <input
                      type="text"
                      value={editForm.employee_code}
                      onChange={(e) => setEditForm((p) => ({ ...p, employee_code: e.target.value }))}
                      placeholder="مثال: 31003"
                      className="font-mono-pro"
                      style={{ width: '100%', padding: '8px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff', fontSize: 12, outline: 'none', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: '#e2e8f0', display: 'block', marginBottom: 4 }}>الرقم القومي (14 رقم):</label>
                    <input
                      type="text"
                      value={editForm.national_id}
                      onChange={(e) => setEditForm((p) => ({ ...p, national_id: e.target.value }))}
                      placeholder="29XXXXXXXXXXXX"
                      maxLength={14}
                      className="font-mono-pro"
                      style={{ width: '100%', padding: '8px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', color: '#facc15', fontSize: 12, outline: 'none', boxSizing: 'border-box' }}
                    />
                  </div>
                </div>
              </div>

              {/* ── قسم 2: بيانات التأمين ── */}
              <div style={{ background: 'rgba(56,189,248,0.06)', borderRadius: 12, padding: '14px 16px', border: '1px solid rgba(56,189,248,0.2)' }}>
                <p style={{ fontSize: 11, fontWeight: 800, color: '#7dd3fc', margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  🛡️ بيانات التأمين
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: '#e2e8f0', display: 'block', marginBottom: 4 }}>الرقم التأميني:</label>
                    <input
                      type="text"
                      value={editForm.insurance_number}
                      onChange={(e) => setEditForm((p) => ({ ...p, insurance_number: e.target.value }))}
                      placeholder="الرقم التأميني..."
                      className="font-mono-pro"
                      style={{ width: '100%', padding: '8px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', color: '#38bdf8', fontSize: 12, outline: 'none', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: '#e2e8f0', display: 'block', marginBottom: 4 }}>المسمى الوظيفي التأميني:</label>
                    <input
                      type="text"
                      value={editForm.insurance_job_title}
                      onChange={(e) => setEditForm((p) => ({ ...p, insurance_job_title: e.target.value }))}
                      placeholder="المسمى في سجلات التأمين..."
                      style={{ width: '100%', padding: '8px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff', fontSize: 12, outline: 'none', boxSizing: 'border-box' }}
                    />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: '#e2e8f0', display: 'block', marginBottom: 4 }}>تاريخ بداية الاشتراك:</label>
                    <input
                      type="text"
                      value={editForm.subscription_start_date}
                      onChange={(e) => setEditForm((p) => ({ ...p, subscription_start_date: e.target.value }))}
                      placeholder="مثال: 2024-01 أو يناير 2024"
                      style={{ width: '100%', padding: '8px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff', fontSize: 12, outline: 'none', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: '#e2e8f0', display: 'block', marginBottom: 4 }}>أيام الحضور:</label>
                    <input
                      type="text"
                      value={editForm.attendance_days}
                      onChange={(e) => setEditForm((p) => ({ ...p, attendance_days: e.target.value }))}
                      placeholder="مثال: 26"
                      style={{ width: '100%', padding: '8px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff', fontSize: 12, outline: 'none', boxSizing: 'border-box' }}
                    />
                  </div>
                </div>
              </div>

              {/* ── قسم 3: بيانات العمل ── */}
              <div style={{ background: 'rgba(16,185,129,0.06)', borderRadius: 12, padding: '14px 16px', border: '1px solid rgba(16,185,129,0.2)' }}>
                <p style={{ fontSize: 11, fontWeight: 800, color: '#6ee7b7', margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  💼 بيانات العمل
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: '#e2e8f0', display: 'block', marginBottom: 4 }}>المسمى الوظيفي:</label>
                    <input
                      type="text"
                      value={editForm.job_title}
                      onChange={(e) => setEditForm((p) => ({ ...p, job_title: e.target.value }))}
                      placeholder="المسمى الوظيفي الفعلي..."
                      style={{ width: '100%', padding: '8px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff', fontSize: 12, outline: 'none', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: '#e2e8f0', display: 'block', marginBottom: 4 }}>رقم الهاتف:</label>
                    <input
                      type="text"
                      value={editForm.phone_number}
                      onChange={(e) => setEditForm((p) => ({ ...p, phone_number: e.target.value }))}
                      placeholder="01XXXXXXXXX"
                      className="font-mono-pro"
                      style={{ width: '100%', padding: '8px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff', fontSize: 12, outline: 'none', boxSizing: 'border-box' }}
                    />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: '#e2e8f0', display: 'block', marginBottom: 4 }}>الحساب / الشركة:</label>
                    <select
                      value={editForm.company_account}
                      onChange={(e) => setEditForm((p) => ({ ...p, company_account: e.target.value }))}
                      style={{ width: '100%', padding: '8px 10px', borderRadius: 8, background: '#1e293b', border: '1px solid rgba(255,255,255,0.12)', color: '#fff', fontSize: 12, outline: 'none' }}
                    >
                      <option value="EGYPT GAS" style={{ background: '#0f172a' }}>EGYPT GAS</option>
                      <option value="NATIONAL GAS" style={{ background: '#0f172a' }}>NATIONAL GAS</option>
                      <option value="PETRO GAS" style={{ background: '#0f172a' }}>PETRO GAS</option>
                      <option value="أخرى" style={{ background: '#0f172a' }}>أخرى</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: '#e2e8f0', display: 'block', marginBottom: 4 }}>حالة الموظف:</label>
                    <select
                      value={editForm.status}
                      onChange={(e) => setEditForm((p) => ({ ...p, status: e.target.value }))}
                      style={{ width: '100%', padding: '8px 10px', borderRadius: 8, background: '#1e293b', border: '1px solid rgba(255,255,255,0.12)', color: '#fff', fontSize: 12, outline: 'none' }}
                    >
                      <option value="Active" style={{ background: '#0f172a' }}>✅ نشط (Active)</option>
                      <option value="Inactive" style={{ background: '#0f172a' }}>⛔ غير نشط</option>
                      <option value="منتهي" style={{ background: '#0f172a' }}>🔴 منتهية الخدمة</option>
                      <option value="إجازة" style={{ background: '#0f172a' }}>🟡 إجازة</option>
                    </select>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', paddingTop: 20 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, color: '#fbbf24', fontWeight: 700 }}>
                      <input
                        type="checkbox"
                        checked={editForm.has_resignation}
                        onChange={(e) => setEditForm((p) => ({ ...p, has_resignation: e.target.checked }))}
                        style={{ width: 16, height: 16, accentColor: '#fbbf24' }}
                      />
                      لديه استقالة
                    </label>
                  </div>
                </div>
              </div>

              {/* ── قسم 4: الحالة التأمينية ── */}
              <div>
                <label style={{ fontSize: 12, fontWeight: 700, color: '#ffffff', display: 'block', marginBottom: 8 }}>
                  الحالة التأمينية:
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                  {INSURANCE_STATUS_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setEditForm((p) => ({ ...p, insurance_status: opt.value }))}
                      style={{
                        padding: '9px 10px', borderRadius: 10, textAlign: 'center',
                        background: editForm.insurance_status === opt.value ? opt.bg : 'rgba(255,255,255,0.03)',
                        border: `1.5px solid ${editForm.insurance_status === opt.value ? opt.color : 'rgba(255,255,255,0.08)'}`,
                        color: '#ffffff', fontSize: 12, fontWeight: 800, cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* سبب المناقضة (يظهر فقط إذا كانت الحالة مناقضة) */}
              {editForm.insurance_status === 'مناقضة' && (
                <div>
                  <label style={{ fontSize: 12, fontWeight: 700, color: '#fbbf24', display: 'block', marginBottom: 6 }}>
                    ⚠️ نوع / سبب المناقضة:
                  </label>
                  <textarea
                    value={editForm.discrepancy_note}
                    onChange={(e) => setEditForm((p) => ({ ...p, discrepancy_note: e.target.value }))}
                    placeholder="مثال: بطاقة الرقم القومي منتهية — أو استيفاء الأوراق ناقص..."
                    rows={2}
                    style={{
                      width: '100%', padding: '10px 12px', borderRadius: 10,
                      background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(251,191,36,0.3)',
                      color: '#fef08a', fontSize: 12, outline: 'none', boxSizing: 'border-box', resize: 'none',
                    }}
                  />
                </div>
              )}

              {/* ── قسم 5: تشغيلي ── */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 700, color: '#ffffff', display: 'block', marginBottom: 6 }}>
                    غرض العملية:
                  </label>
                  <select
                    value={editForm.search_purpose}
                    onChange={(e) => setEditForm((p) => ({ ...p, search_purpose: e.target.value }))}
                    style={{
                      width: '100%', padding: '9px 12px', borderRadius: 10,
                      background: '#1e293b', border: '1px solid rgba(255,255,255,0.12)',
                      color: '#ffffff', fontSize: 12, outline: 'none',
                    }}
                  >
                    <option value="general" style={{ background: '#0f172a' }}>بحث عام 🔍</option>
                    <option value="s1" style={{ background: '#0f172a' }}>س1 — تسجيل جديد 📋</option>
                    <option value="s6" style={{ background: '#0f172a' }}>س6 — إنهاء اشتراك 🔴</option>
                    <option value="discrepancy" style={{ background: '#0f172a' }}>شيت المناقضات ⚠️</option>
                    <option value="supplied" style={{ background: '#0f172a' }}>تم التوريد 📤</option>
                    <option value="archives" style={{ background: '#0f172a' }}>الأرشيف والمستندات 📁</option>
                    <option value="details" style={{ background: '#0f172a' }}>تفاصيل كاملة 👤</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 700, color: '#ffffff', display: 'block', marginBottom: 6 }}>
                    ملاحظات توثيقية:
                  </label>
                  <input
                    type="text"
                    value={editForm.checklist_note}
                    onChange={(e) => setEditForm((p) => ({ ...p, checklist_note: e.target.value }))}
                    placeholder="ملاحظات تظهر في التقرير..."
                    style={{
                      width: '100%', padding: '9px 12px', borderRadius: 10,
                      background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
                      color: '#ffffff', fontSize: 12, outline: 'none', boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>

              {/* Sync checkbox */}
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 12, color: '#a5b4fc', background: 'rgba(99,102,241,0.08)', padding: '10px 14px', borderRadius: 10, border: '1px solid rgba(99,102,241,0.2)' }}>
                <input
                  type="checkbox"
                  checked={editForm.syncWithMaster}
                  onChange={(e) => setEditForm((p) => ({ ...p, syncWithMaster: e.target.checked }))}
                  style={{ width: 16, height: 16, accentColor: '#6366f1' }}
                />
                <span>🔄 مزامنة تلقائية مع <strong>employees_master</strong> + <strong>incoming_insurance_records</strong> + <strong>sheet_data</strong></span>
              </label>

              {/* Buttons */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 14 }}>
                <button
                  type="button"
                  onClick={() => setEditingItem(null)}
                  style={{
                    padding: '9px 20px', borderRadius: 10, background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.1)', color: '#ffffff', cursor: 'pointer', fontSize: 13,
                  }}
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  onClick={handleSaveEdit}
                  disabled={savingEdit}
                  style={{
                    padding: '9px 24px', borderRadius: 10, background: savingEdit ? '#334155' : '#38bdf8',
                    border: 'none', color: savingEdit ? '#94a3b8' : '#0f172a', fontWeight: 900,
                    cursor: savingEdit ? 'not-allowed' : 'pointer', fontSize: 13,
                    display: 'flex', alignItems: 'center', gap: 8,
                  }}
                >
                  {savingEdit ? '⏳ جارٍ الحفظ...' : '💾 حفظ وتحديث جميع الجداول'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ══════════════════════════════════════════════════════════
          6. ADD MANUAL RECORD MODAL (CRUD: CREATE)
      ══════════════════════════════════════════════════════════ */}
      <AnimatePresence>
        {showAddModal && (
          <div
            style={{
              position: 'fixed', inset: 0, zIndex: 1000,
              background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
            }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              style={{
                width: '100%', maxWidth: 560, borderRadius: 20,
                background: '#0f172a', border: '1.5px solid rgba(56,189,248,0.35)',
                boxShadow: '0 25px 60px rgba(0,0,0,0.8)',
                padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: 14,
                maxHeight: '90vh', overflowY: 'auto',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Plus style={{ width: 18, height: 18, color: '#38bdf8' }} />
                  <h3 style={{ fontSize: 16, fontWeight: 900, color: '#ffffff', margin: 0 }}>
                    إضافة عملية يدوياً إلى سجل البحث
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  style={{ background: 'transparent', border: 'none', color: '#ffffff', cursor: 'pointer' }}
                >
                  <X style={{ width: 18, height: 18 }} />
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#ffffff', display: 'block', marginBottom: 4 }}>
                    اسم الموظف:
                  </label>
                  <input
                    type="text"
                    value={addForm.employee_name}
                    onChange={(e) => setAddForm((p) => ({ ...p, employee_name: e.target.value }))}
                    placeholder="الاسم الرباعي..."
                    style={{
                      width: '100%', padding: '8px 10px', borderRadius: 8,
                      background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
                      color: '#ffffff', fontSize: 12, outline: 'none', boxSizing: 'border-box',
                    }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#ffffff', display: 'block', marginBottom: 4 }}>
                    كود الموظف:
                  </label>
                  <input
                    type="text"
                    value={addForm.employee_code}
                    onChange={(e) => setAddForm((p) => ({ ...p, employee_code: e.target.value }))}
                    placeholder="مثال: 31003"
                    style={{
                      width: '100%', padding: '8px 10px', borderRadius: 8,
                      background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
                      color: '#ffffff', fontSize: 12, outline: 'none', boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#ffffff', display: 'block', marginBottom: 4 }}>
                    الرقم القومي (14 رقم):
                  </label>
                  <input
                    type="text"
                    value={addForm.national_id}
                    onChange={(e) => setAddForm((p) => ({ ...p, national_id: e.target.value }))}
                    placeholder="29XXXXXXXXXXXX"
                    style={{
                      width: '100%', padding: '8px 10px', borderRadius: 8,
                      background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
                      color: '#ffffff', fontSize: 12, outline: 'none', boxSizing: 'border-box',
                    }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#ffffff', display: 'block', marginBottom: 4 }}>
                    الرقم التأميني:
                  </label>
                  <input
                    type="text"
                    value={addForm.insurance_number}
                    onChange={(e) => setAddForm((p) => ({ ...p, insurance_number: e.target.value }))}
                    placeholder="الرقم التأميني..."
                    style={{
                      width: '100%', padding: '8px 10px', borderRadius: 8,
                      background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
                      color: '#ffffff', fontSize: 12, outline: 'none', boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#ffffff', display: 'block', marginBottom: 4 }}>
                    غرض العملية:
                  </label>
                  <select
                    value={addForm.search_purpose}
                    onChange={(e) => setAddForm((p) => ({ ...p, search_purpose: e.target.value }))}
                    style={{
                      width: '100%', padding: '8px 10px', borderRadius: 8,
                      background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
                      color: '#ffffff', fontSize: 12, outline: 'none',
                    }}
                  >
                    <option value="general" style={{ background: '#0f172a' }}>بحث عام 🔍</option>
                    <option value="s1" style={{ background: '#0f172a' }}>س1 — تسجيل جديد 📋</option>
                    <option value="s6" style={{ background: '#0f172a' }}>س6 — إنهاء اشتراك 🔴</option>
                    <option value="discrepancy" style={{ background: '#0f172a' }}>شيت المناقضات ⚠️</option>
                    <option value="supplied" style={{ background: '#0f172a' }}>تم التوريد 📤</option>
                    <option value="archives" style={{ background: '#0f172a' }}>الأرشيف والمستندات 📁</option>
                    <option value="details" style={{ background: '#0f172a' }}>تفاصيل كاملة 👤</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#ffffff', display: 'block', marginBottom: 4 }}>
                    الحالة التأمينية:
                  </label>
                  <select
                    value={addForm.insurance_status}
                    onChange={(e) => setAddForm((p) => ({ ...p, insurance_status: e.target.value }))}
                    style={{
                      width: '100%', padding: '8px 10px', borderRadius: 8,
                      background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
                      color: '#ffffff', fontSize: 12, outline: 'none',
                    }}
                  >
                    {INSURANCE_STATUS_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value} style={{ background: '#0f172a' }}>{o.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {addForm.insurance_status === 'مناقضة' && (
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#fbbf24', display: 'block', marginBottom: 4 }}>
                    ⚠️ سبب أو نوع المناقضة:
                  </label>
                  <input
                    type="text"
                    value={addForm.discrepancy_note}
                    onChange={(e) => setAddForm((p) => ({ ...p, discrepancy_note: e.target.value }))}
                    placeholder="المستند الناقص أو سبب المناقضة..."
                    style={{
                      width: '100%', padding: '8px 10px', borderRadius: 8,
                      background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(251,191,36,0.3)',
                      color: '#fef08a', fontSize: 12, outline: 'none', boxSizing: 'border-box',
                    }}
                  />
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 12 }}>
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  style={{
                    padding: '8px 16px', borderRadius: 8, background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.1)', color: '#ffffff', cursor: 'pointer', fontSize: 12,
                  }}
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  onClick={handleSaveAdd}
                  disabled={savingAdd}
                  style={{
                    padding: '8px 20px', borderRadius: 8, background: '#10b981',
                    border: 'none', color: '#ffffff', fontWeight: 800, cursor: savingAdd ? 'not-allowed' : 'pointer',
                    fontSize: 12,
                  }}
                >
                  {savingAdd ? 'جارٍ الإضافة...' : 'إضافة إلى السجل'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
