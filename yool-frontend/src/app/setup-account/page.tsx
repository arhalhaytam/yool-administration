'use client';
import { useState, useEffect, FormEvent, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import FormAlert from '@/components/ui/FormAlert';
import YoolMark from '@/components/brand/YoolMark';
import { getErrorMessage } from '@/lib/errors';
import {
  validatePassword,
  validatePasswordMatch,
  validateRequired,
} from '@/lib/validation';
import styles from '../login/page.module.css';

function SetupAccountContent() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get('token') ?? '';

  const [email, setEmail] = useState('');
  const [role, setRole] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [previewing, setPreviewing] = useState(true);

  useEffect(() => {
    if (!token) { setError('Invalid invitation link.'); setPreviewing(false); return; }
    api.auth.previewInvite(token)
      .then(data => { setEmail(data.email); setRole(data.role); setPreviewing(false); })
      .catch((err) => {
        setError(getErrorMessage(err, 'Failed to load invitation'));
        setPreviewing(false);
      });
  }, [token]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const nameErr = validateRequired(fullName, 'Full name');
    const pwErr =
      validatePassword(password)
      ?? validatePasswordMatch(password, confirm);
    if (nameErr || pwErr) {
      setError(nameErr ?? pwErr ?? '');
      return;
    }
    setError('');
    setLoading(true);
    try {
      // acceptInvite returns UserOut (not a token) — redirect to login
      await api.auth.acceptInvite(token, fullName, password);
      router.push('/login?activated=1');
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to activate account'));
    } finally {
      setLoading(false);
    }
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

        <h1 className={styles.title}>Set up your account</h1>
        <p className={styles.subtitle}>
          {role ? `You've been invited as ${role}.` : 'Complete your account setup.'}
        </p>

        {previewing ? (
          <p className={styles.subtitle}>Loading invitation…</p>
        ) : error && !email ? (
          <FormAlert message={error} />
        ) : (
          <form className={styles.form} onSubmit={handleSubmit}>
            <Input label="Email address" type="email" value={email} disabled readOnly />
            <Input label="Full name" type="text" placeholder="Your full name"
              value={fullName} onChange={e => setFullName(e.target.value)} required />
            <Input label="Password" type="password" placeholder="Min 8 chars, 1 uppercase, 1 number"
              value={password} onChange={e => setPassword(e.target.value)} required
              hint="Minimum 8 characters, one uppercase, one number" />
            <Input label="Confirm password" type="password" placeholder="••••••••"
              value={confirm} onChange={e => setConfirm(e.target.value)} required />
            <FormAlert message={error} />
            <Button type="submit" fullWidth loading={loading}>
              Activate account
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function SetupAccountPage() {
  return (
    <Suspense fallback={null}>
      <SetupAccountContent />
    </Suspense>
  );
}
