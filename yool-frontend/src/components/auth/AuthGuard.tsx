'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getAccessToken, getRole } from '@/lib/auth';

import styles from './AuthGuard.module.css';

interface AuthGuardProps {
  children: React.ReactNode;
  requiredRole?: 'admin' | 'teacher' | 'super_admin';
}

export default function AuthGuard({ children, requiredRole }: AuthGuardProps) {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    function check() {
      const token = getAccessToken();
      if (!token) { router.replace('/login'); return; }

      if (requiredRole) {
        const role = getRole();
        const adminRoles = ['admin', 'super_admin'];
        if (requiredRole === 'admin' && !adminRoles.includes(role ?? '')) {
          router.replace('/login'); return;
        }
        if (requiredRole === 'teacher' && role !== 'teacher') {
          router.replace('/login'); return;
        }
      }
      setAuthorized(true);
    }

    check();

    // Listen for session expiry dispatched by api.ts
    const onExpired = () => router.replace('/login');
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, [router, requiredRole]);

  if (!authorized) {
    return (
      <div className={styles.wrap}>
        <div className={styles.spinner} aria-hidden />
      </div>
    );
  }

  return <>{children}</>;
}
