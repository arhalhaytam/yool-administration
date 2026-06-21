'use client';

import Sidebar from '@/components/layout/Sidebar';
import AuthGuard from '@/components/auth/AuthGuard';
import { getRole } from '@/lib/auth';
import shell from '../admin/layout.module.css';

function sidebarRole(): 'admin' | 'teacher' {
  return getRole() === 'teacher' ? 'teacher' : 'admin';
}

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const role = sidebarRole();

  return (
    <AuthGuard>
      <div className={shell.layout}>
        <Sidebar role={role} />
        <main className={shell.main}>
          <div className={shell.contentAlign}>
            <div className={`${shell.content} ui-page`}>{children}</div>
          </div>
        </main>
      </div>
    </AuthGuard>
  );
}
