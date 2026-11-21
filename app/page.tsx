'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import {
  Users, ShieldCheck, AlertTriangle, GitMerge, FileSpreadsheet,
  UploadCloud, Search, ArrowUpRight, CheckCircle2, TrendingUp,
  Building2, Activity, Sparkles, Sliders, ChevronLeft, Database
} from 'lucide-react';

interface DashboardStats {
  totalEmployees: number;
  egCount: number;
  mgCount: number;
  activeCount: number;
  insuredCount: number;
  openDiscrepancies: number;
  criticalDiscrepancies: number;
  pendingMatches: number;
}

export default function HomePage() {
  const [stats, setStats] = useState<DashboardStats>({
    totalEmployees: 0,
    egCount: 0,
    mgCount: 0,
    activeCount: 0,
    insuredCount: 0,
    openDiscrepancies: 0,
    criticalDiscrepancies: 0,
    pendingMatches: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadStats() {
      try {
        const [empRes, dqRes, matchRes] = await Promise.allSettled([
          fetch('/api/employee?limit=1'),
          fetch('/api/data-quality'),
          fetch('/api/matching-review?status=pending&limit=1'),
        ]);

        let empData: any = {};
        if (empRes.status === 'fulfilled' && empRes.value.ok) {
          empData = await empRes.value.json();
        }

        let dqData: any = {};
        if (dqRes.status === 'fulfilled' && dqRes.value.ok) {
          dqData = await dqRes.value.json();
        }

        let matchData: any = {};
        if (matchRes.status === 'fulfilled' && matchRes.value.ok) {
          matchData = await matchRes.value.json();
        }

        const countsByAccount = empData.stats?.by_account || {};
        const countsByStatus = empData.stats?.by_status || {};
        const countsByInsurance = empData.stats?.by_insurance || {};

        setStats({
          totalEmployees: empData.total || 0,
          egCount: countsByAccount['E.G'] || 0,
          mgCount: countsByAccount['m.g'] || 0,
          activeCount: countsByStatus['Active'] || countsByStatus['نشط'] || 0,
          insuredCount: countsByInsurance['مؤمن عليه'] || countsByInsurance['ساري'] || 0,
          openDiscrepancies: dqData.stats?.total_open || 0,
          criticalDiscrepancies: dqData.stats?.by_severity?.critical || 0,
          pendingMatches: matchData.count || 0,
        });
      } catch (e) {
        console.error('Failed to load dashboard stats:', e);
      } finally {
        setLoading(false);
      }
    }
    loadStats();
  }, []);

  return (
    <div style={{ minHeight: '100vh', background: '#080d1a', color: '#f8fafc', paddingBottom: 60 }} dir="rtl">
      <Navbar />

      <main style={{ maxWidth: 1400, margin: '0 auto', padding: '36px 24px' }}>
        {/* Hero Section */}
        <div style={{ marginBottom: 36, position: 'relative' }}>
          <div style={{
            position: 'absolute', top: -50, right: 100, width: 400, height: 250,
            background: 'radial-gradient(circle, rgba(99,102,241,0.18) 0%, rgba(99,102,241,0) 70%)',
            pointerEvents: 'none', filter: 'blur(40px)',
          }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)',
              color: '#a5b4fc', padding: '4px 12px', borderRadius: 9999, fontSize: 12, fontWeight: 800,
            }}>
              <Sparkles style={{ width: 13, height: 13 }} />
              منظومة إيجيبت جاس المتكاملة لإدارة وتدقيق الموارد البشرية والتأمينات
            </span>
          </div>

          <h1 style={{ fontSize: 32, fontWeight: 900, margin: '0 0 10px', color: '#ffffff', letterSpacing: '-0.5px' }}>
            لوحة القيادة الذكية والمؤشرات التنفيذية
          </h1>
          <p style={{ fontSize: 15, color: '#94a3b8', margin: 0, maxWidth: 800, lineHeight: 1.6 }}>
            قاعدة بيانات موحدة تربط كافة ملفات الإكسيل (Database, Social Insurance, Medical, Payroll, Archives) في سجل متكامل لكل موظف مع كشف التعارضات آنياً ومطابقة آلية ذكية.
          </p>
        </div>

        {/* Executive KPI Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 32 }}>
          {/* Card 1: Total Employees */}
          <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 18, padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#94a3b8' }}>إجمالي الموظفين</span>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(99,102,241,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Users style={{ width: 18, height: 18, color: '#818cf8' }} />
              </div>
            </div>
            <div style={{ fontSize: 30, fontWeight: 900, color: '#ffffff', fontFamily: 'monospace' }}>
              {loading ? '—' : stats.totalEmployees.toLocaleString()}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 12, color: '#34d399' }}>
              <TrendingUp style={{ width: 14, height: 14 }} /> قاعدة بيانات موحدة
            </div>
          </div>

          {/* Card 2: E.G Account */}
          <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 18, padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#94a3b8' }}>حساب شركة E.G</span>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(56,189,248,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Building2 style={{ width: 18, height: 18, color: '#38bdf8' }} />
              </div>
            </div>
            <div style={{ fontSize: 30, fontWeight: 900, color: '#38bdf8', fontFamily: 'monospace' }}>
              {loading ? '—' : stats.egCount.toLocaleString()}
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: '#64748b' }}>
              عقود وحسابات منفصلة
            </div>
          </div>

          {/* Card 3: m.g Account */}
          <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 18, padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#94a3b8' }}>حساب شركة m.g</span>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(168,85,247,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Building2 style={{ width: 18, height: 18, color: '#c084fc' }} />
              </div>
            </div>
            <div style={{ fontSize: 30, fontWeight: 900, color: '#c084fc', fontFamily: 'monospace' }}>
              {loading ? '—' : stats.mgCount.toLocaleString()}
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: '#64748b' }}>
              عقود وحسابات منفصلة
            </div>
          </div>

          {/* Card 4: Insured Employees */}
          <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 18, padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#94a3b8' }}>الموقف التأميني الساري</span>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(16,185,129,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <ShieldCheck style={{ width: 18, height: 18, color: '#34d399' }} />
              </div>
            </div>
            <div style={{ fontSize: 30, fontWeight: 900, color: '#34d399', fontFamily: 'monospace' }}>
              {loading ? '—' : stats.insuredCount.toLocaleString()}
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: '#64748b' }}>
              تأمينات اجتماعية نشطة
            </div>
          </div>
        </div>

        {/* Quality & Conflicts Alert Bar */}
        {(stats.openDiscrepancies > 0 || stats.pendingMatches > 0) && (
          <div style={{
            background: stats.criticalDiscrepancies > 0 ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.08)',
            border: `1px solid ${stats.criticalDiscrepancies > 0 ? 'rgba(239,68,68,0.25)' : 'rgba(245,158,11,0.25)'}`,
            borderRadius: 16,
            padding: '16px 20px',
            marginBottom: 32,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 16,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 38, height: 38, borderRadius: 10,
                background: stats.criticalDiscrepancies > 0 ? 'rgba(239,68,68,0.2)' : 'rgba(245,158,11,0.2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <AlertTriangle style={{ width: 20, height: 20, color: stats.criticalDiscrepancies > 0 ? '#ef4444' : '#f59e0b' }} />
              </div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 800, color: '#ffffff' }}>
                  تنبيه جودة البيانات: تم اكتشاف {stats.openDiscrepancies} تعارض {stats.criticalDiscrepancies > 0 ? `(منها ${stats.criticalDiscrepancies} حرج)` : ''}
                  {stats.pendingMatches > 0 ? ` و ${stats.pendingMatches} حالة مطابقة معلقة` : ''}
                </div>
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                  يوجد تباين بين شيتات التأمينات أو الأرشيف وقاعدة البيانات يحتاج مراجعة فورية
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Link
                href="/data-quality"
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '8px 16px', borderRadius: 8,
                  background: '#ef4444', color: '#fff', fontSize: 13, fontWeight: 700,
                  textDecoration: 'none',
                }}
              >
                فحص التعارضات <ChevronLeft style={{ width: 14, height: 14 }} />
              </Link>
              {stats.pendingMatches > 0 && (
                <Link
                  href="/matching-review"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '8px 16px', borderRadius: 8,
                    background: 'rgba(255,255,255,0.1)', color: '#fff', fontSize: 13, fontWeight: 700,
                    textDecoration: 'none',
                  }}
                >
                  مراجعة المطابقة
                </Link>
              )}
            </div>
          </div>
        )}

        {/* Feature Navigation Cards */}
        <div style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: '#ffffff', margin: '0 0 16px' }}>
            بوابات النظام والعمليات الرئيسية
          </h2>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
            {/* Module 1: Employees Directory */}
            <Link
              href="/employees"
              style={{ textDecoration: 'none' }}
              className="glass-card-hover"
            >
              <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 18, padding: 24, height: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(99,102,241,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Users style={{ width: 22, height: 22, color: '#818cf8' }} />
                  </div>
                  <ArrowUpRight style={{ width: 18, height: 18, color: '#64748b' }} />
                </div>
                <h3 style={{ fontSize: 17, fontWeight: 800, color: '#ffffff', margin: '0 0 6px' }}>
                  دليل وسجل الموظفين الموحد
                </h3>
                <p style={{ fontSize: 13, color: '#94a3b8', margin: 0, lineHeight: 1.5 }}>
                  استعراض جميع الموظفين مع فلاتر الحساب والوظيفة والحالة، والاطلاع على الملف الموحد 360° لكل موظف.
                </p>
              </div>
            </Link>

            {/* Module 2: 360 Lookup */}
            <Link
              href="/lookup"
              style={{ textDecoration: 'none' }}
              className="glass-card-hover"
            >
              <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 18, padding: 24, height: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(168,85,247,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Search style={{ width: 22, height: 22, color: '#c084fc' }} />
                  </div>
                  <ArrowUpRight style={{ width: 18, height: 18, color: '#64748b' }} />
                </div>
                <h3 style={{ fontSize: 17, fontWeight: 800, color: '#ffffff', margin: '0 0 6px' }}>
                  استدعاء وتدقيق موظف (360° Lookup)
                </h3>
                <p style={{ fontSize: 13, color: '#94a3b8', margin: 0, lineHeight: 1.5 }}>
                  بحث فوري بالرقم القومي أو الكود أو الاسم، وسحب بيانات الموظف من كافة الشيتات التاريخية والمالية.
                </p>
              </div>
            </Link>

            {/* Module 3: Dynamic Report Builder */}
            <Link
              href="/report-builder"
              style={{ textDecoration: 'none' }}
              className="glass-card-hover"
            >
              <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 18, padding: 24, height: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(6,182,212,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Sliders style={{ width: 22, height: 22, color: '#06b6d4' }} />
                  </div>
                  <ArrowUpRight style={{ width: 18, height: 18, color: '#64748b' }} />
                </div>
                <h3 style={{ fontSize: 17, fontWeight: 800, color: '#ffffff', margin: '0 0 6px' }}>
                  مصنع التقارير الديناميكي (Report Builder)
                </h3>
                <p style={{ fontSize: 13, color: '#94a3b8', margin: 0, lineHeight: 1.5 }}>
                  تصميم استعلامات مخصصة، اختيار الأعمدة، إضافة شروط الفلترة المتقدمة، وتصدير إكسيل بنقرة واحدة.
                </p>
              </div>
            </Link>

            {/* Module 4: Data Quality */}
            <Link
              href="/data-quality"
              style={{ textDecoration: 'none' }}
              className="glass-card-hover"
            >
              <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 18, padding: 24, height: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(245,158,11,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <AlertTriangle style={{ width: 22, height: 22, color: '#f59e0b' }} />
                  </div>
                  <ArrowUpRight style={{ width: 18, height: 18, color: '#64748b' }} />
                </div>
                <h3 style={{ fontSize: 17, fontWeight: 800, color: '#ffffff', margin: '0 0 6px' }}>
                  مركز جودة البيانات والتعارضات
                </h3>
                <p style={{ fontSize: 13, color: '#94a3b8', margin: 0, lineHeight: 1.5 }}>
                  فحص تلقائي يكشف تناقضات الحالة، الأرقام القومية المكررة، غياب الأرقام التأمينية، وفجوات الاشتراك.
                </p>
              </div>
            </Link>

            {/* Module 5: Matching Review */}
            <Link
              href="/matching-review"
              style={{ textDecoration: 'none' }}
              className="glass-card-hover"
            >
              <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 18, padding: 24, height: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(236,72,153,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <GitMerge style={{ width: 22, height: 22, color: '#ec4899' }} />
                  </div>
                  <ArrowUpRight style={{ width: 18, height: 18, color: '#64748b' }} />
                </div>
                <h3 style={{ fontSize: 17, fontWeight: 800, color: '#ffffff', margin: '0 0 6px' }}>
                  مراجعة المطابقة والربط الذكي
                </h3>
                <p style={{ fontSize: 13, color: '#94a3b8', margin: 0, lineHeight: 1.5 }}>
                  مراجعة بشرية سريعة لدمج الحالات غير المؤكدة بدقة، أو اعتماد السجلات الجديدة كأشخاص منفصلين.
                </p>
              </div>
            </Link>

            {/* Module 6: Smart Import */}
            <Link
              href="/smart-import"
              style={{ textDecoration: 'none' }}
              className="glass-card-hover"
            >
              <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 18, padding: 24, height: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(16,185,129,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <UploadCloud style={{ width: 22, height: 22, color: '#34d399' }} />
                  </div>
                  <ArrowUpRight style={{ width: 18, height: 18, color: '#64748b' }} />
                </div>
                <h3 style={{ fontSize: 17, fontWeight: 800, color: '#ffffff', margin: '0 0 6px' }}>
                  مركز الاستيراد الذكي (Smart Import)
                </h3>
                <p style={{ fontSize: 13, color: '#94a3b8', margin: 0, lineHeight: 1.5 }}>
                  رفع شيتات إكسيل متعددة الأوراق مع التعرف التلقائي على الأعمدة وحماية البيانات من الكتابة العشوائية.
                </p>
              </div>
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
