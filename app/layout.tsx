import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Toaster } from 'sonner';

export const metadata: Metadata = {
  title: 'Employee Insurance & Payroll Lookup | استدعاء وفحص بيانات الموظفين',
  description: 'منظومة احترافية متقدمة لاستدعاء وتدقيق بيانات الموظفين، التأمينات، المرتبات، وسجلات الاستقالات من ملفات Excel.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className="h-full">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body
        className="min-h-full antialiased selection:bg-indigo-500 selection:text-white"
        style={{ fontFamily: "'Cairo', 'Inter', system-ui, sans-serif" }}
      >
        <Toaster
          position="top-center"
          richColors
          dir="rtl"
          closeButton
          expand
          toastOptions={{
            style: {
              background: '#111827',
              border: '1px solid rgba(99,102,241,0.25)',
              color: '#f1f5f9',
              fontFamily: "'Cairo', sans-serif",
              fontSize: '13px',
              fontWeight: '600',
            },
          }}
        />
        {children}
      </body>
    </html>
  );
}
