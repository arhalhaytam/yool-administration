import AuthGuard from '@/components/auth/AuthGuard';
import AppShell from '@/components/layout/AppShell';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard requiredRole="admin">
      <AppShell role="admin">{children}</AppShell>
    </AuthGuard>
  );
}
