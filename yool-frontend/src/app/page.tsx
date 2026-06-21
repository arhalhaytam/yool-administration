'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getAccessToken, getRole } from '@/lib/auth';

// Root page: redirect based on auth state.
// Cannot use server-side redirect() here because auth is stored in sessionStorage.
export default function Home() {
  const router = useRouter();

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      router.replace('/login');
      return;
    }
    const role = getRole();
    if (role === 'teacher') router.replace('/teacher');
    else router.replace('/admin');
  }, [router]);

  return null;
}
