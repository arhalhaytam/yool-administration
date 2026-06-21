'use client';
import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle2, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import YoolMark from '@/components/brand/YoolMark';
import styles from '../login/page.module.css';
import fpStyles from '../forgot-password/page.module.css';

function VerifyEmailContent() {
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) { setStatus('error'); setMessage('Invalid link.'); return; }
    api.auth.verifyEmail(token)
      .then(() => setStatus('success'))
      .catch((err) => {
        setStatus('error');
        setMessage(getErrorMessage(err, 'Verification failed'));
      });
  }, [token]);

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true">
            <YoolMark size={32} strokeWidth={2.2} accentNode />
          </span>
          <div>
            <div className={styles.brandWord}>
              Yool<span className={styles.brandPeriod}>.</span>
            </div>
            <div className={styles.brandSub}>AI</div>
          </div>
        </div>

        {status === 'loading' && (
          <div className={fpStyles.success}>
            <div className={`${fpStyles.statusIcon} ${fpStyles.statusIconLoading}`} aria-hidden="true">
              <span className={fpStyles.spinner} />
            </div>
            <p className={styles.subtitle}>Verifying your email…</p>
          </div>
        )}

        {status === 'success' && (
          <div className={fpStyles.success}>
            <div className={`${fpStyles.statusIcon} ${fpStyles.statusIconSuccess}`} aria-hidden="true">
              <CheckCircle2 size={26} strokeWidth={2} />
            </div>
            <h1 className={styles.title}>Email verified</h1>
            <p className={styles.subtitle}>Your account is now active. You can sign in.</p>
            <Link href="/login" className={`${fpStyles.backLink} ${fpStyles.backLinkAccent}`}>
              Go to login →
            </Link>
          </div>
        )}

        {status === 'error' && (
          <div className={fpStyles.success}>
            <div className={`${fpStyles.statusIcon} ${fpStyles.statusIconError}`} aria-hidden="true">
              <XCircle size={26} strokeWidth={2} />
            </div>
            <h1 className={styles.title}>Verification failed</h1>
            <p className={styles.subtitle}>{message || 'This link has expired or is invalid.'}</p>
            <Link href="/login" className={fpStyles.backLink}>← Back to login</Link>
          </div>
        )}
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailContent />
    </Suspense>
  );
}
