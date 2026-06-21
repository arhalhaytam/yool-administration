'use client';
import { useState, FormEvent } from 'react';
import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';
import { api } from '@/lib/api';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import FormAlert from '@/components/ui/FormAlert';
import YoolMark from '@/components/brand/YoolMark';
import { getErrorMessage } from '@/lib/errors';
import { validateEmail, type FieldErrors } from '@/lib/validation';
import { useT } from '@/lib/i18n/LanguageContext';
import styles from '../login/page.module.css';
import pageStyles from './page.module.css';

export default function ForgotPasswordPage() {
  const t = useT();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const emailErr = validateEmail(email);
    if (emailErr) {
      setFieldErrors({ email: emailErr });
      setError(emailErr);
      return;
    }
    setFieldErrors({});
    setError('');
    setLoading(true);
    try {
      await api.auth.forgotPassword(email.trim());
      setSent(true);
    } catch (err: unknown) {
      setError(getErrorMessage(err));
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

        {sent ? (
          <div className={pageStyles.success}>
            <div className={`${pageStyles.statusIcon} ${pageStyles.statusIconSuccess}`} aria-hidden="true">
              <CheckCircle2 size={26} strokeWidth={2} />
            </div>
            <h1 className={styles.title}>{t('auth.verifyEmail')}</h1>
            <p className={styles.subtitle}>
              {t('auth.resetSent')} <strong>{email}</strong>
            </p>
            <Link href="/login" className={pageStyles.backLink}>← {t('common.back')}</Link>
          </div>
        ) : (
          <>
            <h1 className={styles.title}>{t('auth.resetPassword')}</h1>
            <p className={styles.subtitle}>{t('auth.signInDesc')}</p>
            <form className={styles.form} onSubmit={handleSubmit}>
              <Input
                label={t('auth.email')}
                type="email"
                placeholder="vous@institution.dz"
                value={email}
                onChange={e => {
                  setEmail(e.target.value);
                  if (fieldErrors.email) setFieldErrors({});
                }}
                error={fieldErrors.email}
                required
                autoFocus
              />
              <FormAlert message={error} />
              <Button type="submit" fullWidth loading={loading} size="lg">
                {t('auth.sendResetLink')}
              </Button>
              <Link href="/login" className={pageStyles.backLink}>← {t('common.back')}</Link>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
