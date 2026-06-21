import type { Metadata } from 'next';
import { ToastProvider } from '@/components/ui/Toast';
import { ConfirmProvider } from '@/components/ui/Confirm';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Yool AI', template: '%s — Yool AI' },
  description: 'Enterprise lecture tracking and audit platform.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" dir="ltr" suppressHydrationWarning>
      <body>
        <LanguageProvider>
          <ToastProvider>
            <ConfirmProvider>{children}</ConfirmProvider>
          </ToastProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}

