'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  GitMerge, CheckCircle2, UserPlus, AlertCircle, RefreshCw,
  ExternalLink, Search, Filter, ShieldCheck, ArrowRight, UserCheck
} from 'lucide-react';
import { toast } from 'sonner';

interface Candidate {
  id: string;
  import_id: string | null;
  sheet_name: string;
  row_data: Record<string, unknown>;
  row_number: number | null;
  raw_code: string | null;
  raw_national_id: string | null;
  raw_name: string | null;
  candidate_employee_id: string | null;
  match_type: string | null;
  confidence_score: number | null;
  status: string;
  notes: string | null;
  created_at: string;
  candidate_employee?: {
    id: string;
    employee_code: string | null;
    national_id: string | null;
    employee_name: string;
    company_account: string;
    current_status: string | null;
    current_job_title: string | null;
  } | null;
}

export default function MatchingReviewPage() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('pending');
  const [processingId, setProcessingId] = useState<string | null>(null);

  const fetchCandidates = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/matching-review?status=${statusFilter}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'فشل جلب الحالات');
      setCandidates(json.candidates || []);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'حدث خطأ في الاتصال');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchCandidates();
  }, [fetchCandidates]);

  const handleAction = async (candidateId: string, action: 'confirm' | 'reject', targetEmployeeId?: string) => {
    setProcessingId(candidateId);
    try {
      const res = await fetch('/api/matching-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidate_id: candidateId,
          action,
          target_employee_id: targetEmployeeId,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'فشلت العملية');

      toast.success(action === 'confirm' ? 'تم تأكيد الربط بنجاح' : 'تم اعتماد الموظف كشخص جديد');
      fetchCandidates();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'حدث خطأ');
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div style={{ paddingBottom: 60 }}>
      <main style={{ maxWidth: 1400, margin: '0 auto', padding: '32px 24px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28, flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <div style={{ width: 42, height: 42, borderRadius: 12, background: 'rgba(99,102,241,0.2)', border: '1px solid rgba(99,102,241,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <GitMerge style={{ width: 22, height: 22, color: '#818cf8' }} />
              </div>
              <div>
                <h1 style={{ fontSize: 24, fontWeight: 900, margin: 0, color: '#ffffff' }}>
                  مركز مراجعة المطابقة والربط
                </h1>
                <p style={{ fontSize: 13, color: '#94a3b8', margin: '4px 0 0' }}>
                  ماتشينج هرمي بالبيانات الحقيقية: رقم قومي → كود+حساب → تأمين → اسم — بدون أي ذكاء اصطناعي
                </p>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ display: 'flex', background: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: 3, border: '1px solid rgba(255,255,255,0.08)' }}>
              <button
                onClick={() => setStatusFilter('pending')}
                style={{
                  padding: '6px 16px',
                  borderRadius: 8,
                  border: 'none',
                  background: statusFilter === 'pending' ? '#6366f1' : 'transparent',
                  color: statusFilter === 'pending' ? '#fff' : '#94a3b8',
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                قيد المراجعة
              </button>
              <button
                onClick={() => setStatusFilter('confirmed_match')}
                style={{
                  padding: '6px 16px',
                  borderRadius: 8,
                  border: 'none',
                  background: statusFilter === 'confirmed_match' ? '#10b981' : 'transparent',
                  color: statusFilter === 'confirmed_match' ? '#fff' : '#94a3b8',
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                تم الربط
              </button>
              <button
                onClick={() => setStatusFilter('rejected_new_employee')}
                style={{
                  padding: '6px 16px',
                  borderRadius: 8,
                  border: 'none',
                  background: statusFilter === 'rejected_new_employee' ? '#f59e0b' : 'transparent',
                  color: statusFilter === 'rejected_new_employee' ? '#fff' : '#94a3b8',
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                موظفون جدد
              </button>
            </div>

            <button
              onClick={fetchCandidates}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 14px',
                borderRadius: 10,
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                color: '#e2e8f0',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              <RefreshCw style={{ width: 14, height: 14 }} className={loading ? 'spin' : ''} />
              تحديث
            </button>
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: '#94a3b8' }}>
            <RefreshCw style={{ width: 32, height: 32, margin: '0 auto 16px', color: '#818cf8' }} className="spin" />
            <p style={{ fontSize: 15, fontWeight: 600 }}>جارٍ تحميل الحالات المعلقة...</p>
          </div>
        ) : candidates.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '80px 20px', background: 'rgba(255,255,255,0.02)', borderRadius: 20, border: '1px dashed rgba(255,255,255,0.1)' }}>
            <UserCheck style={{ width: 48, height: 48, margin: '0 auto 16px', color: '#34d399' }} />
            <h3 style={{ fontSize: 18, fontWeight: 800, color: '#f1f5f9', margin: '0 0 6px' }}>
              لا توجد حالات بانتظار المراجعة
            </h3>
            <p style={{ fontSize: 13, color: '#94a3b8', margin: 0 }}>
              كل البيانات المستوردة إما تم مطابقتها تلقائياً بنجاح أو تمت معالجتها بالفعل.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {candidates.map((c) => {
              const emp = c.candidate_employee;
              const isProcessing = processingId === c.id;
              const confidencePercent = Math.round((c.confidence_score || 0.5) * 100);

              return (
                <div
                  key={c.id}
                  style={{
                    background: 'rgba(255,255,255,0.025)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 18,
                    padding: '20px 24px',
                    transition: 'border 0.2s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 11, fontWeight: 800, background: 'rgba(99,102,241,0.2)', color: '#a5b4fc', padding: '3px 10px', borderRadius: 6 }}>
                        ورقة: {c.sheet_name}
                      </span>
                      {c.row_number && (
                        <span style={{ fontSize: 11, color: '#64748b' }}>
                          صف رقم: #{c.row_number}
                        </span>
                      )}
                      {c.match_type && (
                        <span style={{ fontSize: 10, fontWeight: 700, background: 'rgba(245,158,11,0.15)', color: '#fbbf24', padding: '2px 8px', borderRadius: 5, border: '1px solid rgba(245,158,11,0.3)' }}>
                          {c.match_type === 'candidate_name_plus_data' ? '🔗 اسم + بيانات داعمة'
                           : c.match_type === 'candidate_name' ? '🔤 تشابه اسم'
                           : c.match_type}
                        </span>
                      )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 800, color: confidencePercent >= 75 ? '#34d399' : '#f59e0b' }}>
                        نسبة الثقة: {confidencePercent}%
                      </span>
                      <div style={{ width: 80, height: 6, background: 'rgba(255,255,255,0.1)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ width: `${confidencePercent}%`, height: '100%', background: confidencePercent >= 75 ? '#34d399' : '#f59e0b' }} />
                      </div>
                    </div>
                  </div>

                  {/* Comparison Grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 16, alignItems: 'center', marginBottom: 20 }}>
                    {/* Incoming Row Data */}
                    <div style={{ background: 'rgba(15,23,42,0.6)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 14, padding: 16 }}>
                      <div style={{ fontSize: 12, fontWeight: 800, color: '#38bdf8', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#38bdf8' }} />
                        البيانات الواردة في الشيت
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
                        <div>
                          <span style={{ color: '#94a3b8' }}>الاسم: </span>
                          <span style={{ fontWeight: 800, color: '#ffffff' }}>{c.raw_name || '—'}</span>
                        </div>
                        <div>
                          <span style={{ color: '#94a3b8' }}>الكود: </span>
                          <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#e2e8f0' }}>{c.raw_code || '—'}</span>
                        </div>
                        <div>
                          <span style={{ color: '#94a3b8' }}>الرقم القومي: </span>
                          <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#e2e8f0' }}>{c.raw_national_id || '—'}</span>
                        </div>
                      </div>
                    </div>

                    {/* Middle Icon */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, color: '#64748b' }}>
                      <GitMerge style={{ width: 24, height: 24, color: '#818cf8' }} />
                      <span style={{ fontSize: 10, fontWeight: 700 }}>مرشح</span>
                    </div>

                    {/* Candidate Master Employee */}
                    <div style={{ background: 'rgba(15,23,42,0.6)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 14, padding: 16 }}>
                      <div style={{ fontSize: 12, fontWeight: 800, color: '#a5b4fc', marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#818cf8' }} />
                          الموظف المرشح بقاعدة البيانات
                        </div>
                        {emp && (
                          <Link
                            href={`/employee/${emp.id}`}
                            target="_blank"
                            style={{ fontSize: 11, color: '#818cf8', display: 'flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}
                          >
                            عرض الملف <ExternalLink style={{ width: 12, height: 12 }} />
                          </Link>
                        )}
                      </div>
                      {emp ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
                          <div>
                            <span style={{ color: '#94a3b8' }}>الاسم: </span>
                            <span style={{ fontWeight: 800, color: '#ffffff' }}>{emp.employee_name}</span>
                          </div>
                          <div>
                            <span style={{ color: '#94a3b8' }}>الكود والحساب: </span>
                            <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#34d399' }}>
                              [{emp.company_account}] {emp.employee_code || '—'}
                            </span>
                          </div>
                          <div>
                            <span style={{ color: '#94a3b8' }}>الرقم القومي: </span>
                            <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#e2e8f0' }}>{emp.national_id || '—'}</span>
                          </div>
                          <div>
                            <span style={{ color: '#94a3b8' }}>الوظيفة / الحالة: </span>
                            <span style={{ color: '#cbd5e1' }}>{emp.current_job_title || '—'} ({emp.current_status || 'Active'})</span>
                          </div>
                        </div>
                      ) : (
                        <div style={{ color: '#64748b', fontSize: 13 }}>لا يوجد موظف مرشح مناسب</div>
                      )}
                    </div>
                  </div>

                  {/* Actions Bar */}
                  {c.notes && (
                    <div style={{ fontSize: 11, color: '#64748b', marginBottom: 10, padding: '6px 10px', background: 'rgba(255,255,255,0.03)', borderRadius: 7, border: '1px solid rgba(255,255,255,0.06)' }}>
                      🔎 سبب الترشيح: {c.notes}
                    </div>
                  )}
                  {c.status === 'pending' && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12 }}>
                      {emp && (
                        <button
                          type="button"
                          disabled={isProcessing}
                          onClick={() => handleAction(c.id, 'confirm', emp.id)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '10px 18px',
                            borderRadius: 10,
                            background: '#10b981',
                            border: 'none',
                            color: '#ffffff',
                            fontWeight: 800,
                            fontSize: 13,
                            cursor: isProcessing ? 'not-allowed' : 'pointer',
                            opacity: isProcessing ? 0.7 : 1,
                          }}
                        >
                          <CheckCircle2 style={{ width: 16, height: 16 }} />
                          تأكيد الربط بالموظف
                        </button>
                      )}

                      <button
                        type="button"
                        disabled={isProcessing}
                        onClick={() => handleAction(c.id, 'reject')}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '10px 18px',
                          borderRadius: 10,
                          background: 'rgba(255,255,255,0.08)',
                          border: '1px solid rgba(255,255,255,0.15)',
                          color: '#f8fafc',
                          fontWeight: 700,
                          fontSize: 13,
                          cursor: isProcessing ? 'not-allowed' : 'pointer',
                          opacity: isProcessing ? 0.7 : 1,
                        }}
                      >
                        <UserPlus style={{ width: 16, height: 16, color: '#38bdf8' }} />
                        اعتماد كشخص جديد منفصل
                      </button>
                    </div>
                  )}

                  {c.status !== 'pending' && (
                    <div style={{ fontSize: 12, color: c.status === 'confirmed_match' ? '#34d399' : '#f59e0b', fontWeight: 700, textAlign: 'left' }}>
                      {c.status === 'confirmed_match' ? '✅ تم تأكيد الربط بنجاح' : '➕ تم إنشاء موظف جديد'}
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
