import AuthGuard from '@/components/auth/AuthGuard';
import AppShell from '@/components/layout/AppShell';

export default function TeacherLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard requiredRole="teacher">
      <AppShell role="teacher">{children}</AppShell>
    </AuthGuard>
  );
}
