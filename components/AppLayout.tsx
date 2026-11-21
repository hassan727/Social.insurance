'use client';

import { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import Navbar from './Navbar';

interface AppLayoutProps {
  children: ReactNode;
}

/**
 * AppLayout - مكون التخطيط الموحد للتطبيق
 * 
 * يوفر:
 * - Navbar ثابت في الأعلى (يختفي تلقائيًا في صفحة تسجيل الدخول)
 * - حاوية محتوى موحدة
 * - دعم كامل لـ RTL و Responsive
 */
export default function AppLayout({ children }: AppLayoutProps) {
  const pathname = usePathname();
  
  // إخفاء Navbar في صفحة تسجيل الدخول
  const hideNavbar = pathname === '/login';

  return (
    <div 
      className="app-layout"
      style={{
        minHeight: '100vh',
        background: '#080d1a',
        color: '#f1f5f9'
      }}
    >
      {/* ── Header ── */}
      {!hideNavbar && (
        <header className="app-header">
          <Navbar />
        </header>
      )}

      {/* ── Main Content ── */}
      <main 
        className="app-main"
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        {children}
      </main>
    </div>
  );
}
