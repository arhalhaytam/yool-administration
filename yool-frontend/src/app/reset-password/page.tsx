'use client';
import { useState, FormEvent, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { CheckCircle2 } from 'lucide-react';
import { api } from '@/lib/api';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import FormAlert from '@/components/ui/FormAlert';
import YoolMark from '@/components/brand/YoolMark';
import { getErrorMessage } from '@/lib/errors';
import { validatePassword, validatePasswordMatch } from '@/lib/validation';
import styles from '../login/page.module.css';
import fpStyles from '../forgot-password/page.module.css';

function ResetPasswordContent() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const strength = password.length >= 8 && /[A-Z]/.test(password) && /\d/.test(password);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) {
      setError('Invalid or missing reset link. Request a new one from the login page.');
      return;
    }
    const pwErr = validatePassword(password) ?? validatePasswordMatch(password, confirm);
    if (pwErr) {
      setError(pwErr);
      return;
    }
    setError('');
    setLoading(true);
    try {
      await api.auth.resetPassword(token, password);
      setDone(true);
      setTimeout(() => router.push('/login'), 2000);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Reset failed'));
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <div className={fpStyles.success}>
            <div className={`${fpStyles.statusIcon} ${fpStyles.statusIconSuccess}`} aria-hidden="true">
              <CheckCircle2 size={26} strokeWidth={2} />
            </div>
            <h1 className={styles.title}>Password updated</h1>
            <p className={styles.subtitle}>Redirecting you to login…</p>
          </div>
        </div>
      </div>
    );
  }

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
        <h1 className={styles.title}>Set new password</h1>
        <p className={styles.subtitle}>Choose a strong password for your account.</p>
        <form className={styles.form} onSubmit={handleSubmit}>
          <Input label="New password" type="password" value={password}
            onChange={e => setPassword(e.target.value)} required
            hint="Min 8 chars, one uppercase letter, one number" />
          <Input label="Confirm password" type="password" value={confirm}
            onChange={e => setConfirm(e.target.value)} required />
          <FormAlert message={error} />
          <Button type="submit" fullWidth loading={loading} size="lg">
            Reset password
          </Button>
        </form>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordContent />
    </Suspense>
  );
}
