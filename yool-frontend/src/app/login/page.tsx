'use client';
import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { setAccessToken, decodeToken } from '@/lib/auth';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import FormAlert from '@/components/ui/FormAlert';
import YoolMark from '@/components/brand/YoolMark';
import { getErrorMessage } from '@/lib/errors';
import { validateEmail, validateRequired, type FieldErrors } from '@/lib/validation';
import { useT } from '@/lib/i18n/LanguageContext';
import styles from './page.module.css';

export default function LoginPage() {
  const router = useRouter();
  const t = useT();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const emailErr = validateEmail(email);
    const pwErr    = validateRequired(password, t('auth.password'));
    const errors: FieldErrors = {};
    if (emailErr) errors.email    = emailErr;
    if (pwErr)    errors.password = pwErr;
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setError(t('common.error'));
      return;
    }
    setError('');
    setFieldErrors({});
    setLoading(true);
    try {
      const data    = await api.auth.login(email.trim(), password);
      setAccessToken(data.access_token);
      const payload = decodeToken(data.access_token);
      const role    = payload?.role as string;
      if (role === 'teacher') router.push('/teacher');
      else router.push('/admin');
    } catch (err: unknown) {
      setError(getErrorMessage(err, t('auth.invalidCredentials')));
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
          </div>
        </div>

        <h1 className={styles.title}>{t('auth.signIn')}</h1>
        <p className={styles.subtitle}>{t('auth.signInDesc')}</p>

        <form className={styles.form} onSubmit={handleSubmit}>
          <Input
            label={t('auth.email')}
            className={styles.loginInput}
            type="email"
            placeholder="vous@institution.dz"
            value={email}
            onChange={e => {
              setEmail(e.target.value);
              if (fieldErrors.email) setFieldErrors(({ email: _, ...rest }) => rest);
            }}
            error={fieldErrors.email}
            required
            autoComplete="email"
            autoFocus
          />
          <Input
            label={t('auth.password')}
            className={styles.loginInput}
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={e => {
              setPassword(e.target.value);
              if (fieldErrors.password) setFieldErrors(({ password: _, ...rest }) => rest);
            }}
            error={fieldErrors.password}
            required
            autoComplete="current-password"
          />
          <FormAlert message={error} className={styles.formAlert} />
          <div className={styles.forgot}>
            <Link href="/forgot-password">{t('auth.forgotPassword')}</Link>
          </div>
          <Button type="submit" fullWidth loading={loading} className={styles.loginButton}>
            {t('auth.signIn')}
          </Button>
        </form>
      </div>
    </div>
  );
}
