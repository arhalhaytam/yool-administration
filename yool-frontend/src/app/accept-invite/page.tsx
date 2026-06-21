'use client';
import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function Redirect() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token');

  useEffect(() => {
    router.replace(token ? `/setup-account?token=${token}` : '/setup-account');
  }, [router, token]);

  return null;
}

export default function AcceptInviteRedirect() {
  return (
    <Suspense fallback={null}>
      <Redirect />
    </Suspense>
  );
}
