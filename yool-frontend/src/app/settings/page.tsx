'use client';
import { useState, useEffect, FormEvent, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Monitor, Smartphone, Globe, Trash2, AlertTriangle, Check, Mail, Calendar,
  Lock, User as UserIcon, Languages, ShieldCheck, ChevronDown,
} from 'lucide-react';
import { api } from '@/lib/api';
import { clearAccessToken } from '@/lib/auth';
import type { User } from '@/lib/types';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Badge from '@/components/ui/Badge';
import PageHeader from '@/components/ui/PageHeader';
import FormAlert from '@/components/ui/FormAlert';
import { getErrorMessage } from '@/lib/errors';
import { validatePassword, validatePasswordMatch, validateRequired } from '@/lib/validation';
import { useT, useLocale, locales, type Locale } from '@/lib/i18n/LanguageContext';
import styles from './page.module.css';

const PREVIEW_SESSION_LIMIT = 4;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function roleLabel(role: string, t: (key: string) => string): string {
  if (role === 'super_admin') return t('admin.role.super_admin');
  if (role === 'admin')       return t('admin.role.admin');
  return t('admin.role.teacher');
}

/**
 * Use neutral/purple variants for role display — never `danger`, even for
 * super_admin. Role badges are informational, not destructive actions.
 */
function roleBadgeVariant(role: string): 'purple' | 'accent' | 'default' {
  if (role === 'super_admin') return 'purple';
  if (role === 'admin')       return 'accent';
  return 'default';
}

type DeviceSession = Awaited<ReturnType<typeof api.auth.listSessions>>[number];

function deviceIcon(ua: string | null) {
  if (!ua) return <Globe size={15} strokeWidth={1.7} />;
  if (/mobile|android|iphone/i.test(ua)) return <Smartphone size={15} strokeWidth={1.7} />;
  return <Monitor size={15} strokeWidth={1.7} />;
}

function parseUA(ua: string | null): string {
  if (!ua) return '';
  const browser = ua.match(/(Chrome|Firefox|Safari|Edge|Opera)\/[\d.]+/)?.[1] ?? 'Browser';
  const os      = ua.match(/\(([^)]+)\)/)?.[1]?.split(';')[0] ?? 'Unknown OS';
  return `${browser} · ${os}`;
}

// Locale display names — no emoji flags, just native script names.
const LOCALE_META: Record<Locale, { native: string; latin: string }> = {
  fr: { native: 'Français', latin: 'French'  },
  en: { native: 'English',  latin: 'English' },
  ar: { native: 'العربية',  latin: 'Arabic'  },
};

export default function SettingsPage() {
  const router = useRouter();
  const t = useT();
  const { locale, setLocale } = useLocale();

  const [me, setMe]                           = useState<User | null>(null);
  const [fullName, setFullName]               = useState('');
  const [profileLoading, setProfileLoading]   = useState(false);
  const [profileMsg, setProfileMsg]           = useState({ error: '', success: '' });

  const [pwForm, setPwForm]     = useState({ current: '', next: '', confirm: '' });
  const [pwLoading, setPwLoading] = useState(false);
  const [pwMsg, setPwMsg]       = useState({ error: '', success: '' });

  const [sessions, setSessions]               = useState<DeviceSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [showAllSessions, setShowAllSessions] = useState(false);

  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting]           = useState(false);
  const [loadError, setLoadError]         = useState('');
  const [sessionsError, setSessionsError] = useState('');
  const [deleteError, setDeleteError]     = useState('');

  const loadMe = useCallback(async () => {
    try {
      const user = await api.auth.me();
      setMe(user);
      setFullName(user.full_name);
      setLoadError('');
    } catch (err: unknown) {
      setLoadError(getErrorMessage(err, t('common.error')));
    }
  }, [t]);

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      setSessions(await api.auth.listSessions());
      setSessionsError('');
    } catch (err) {
      setSessions([]);
      setSessionsError(getErrorMessage(err, t('common.error')));
    } finally {
      setSessionsLoading(false);
    }
  }, [t]);

  useEffect(() => { loadMe(); loadSessions(); }, [loadMe, loadSessions]);

  async function handleProfileSave(e: FormEvent) {
    e.preventDefault();
    const nameErr = validateRequired(fullName, t('settings.fullName'));
    if (nameErr) { setProfileMsg({ error: nameErr, success: '' }); return; }
    setProfileMsg({ error: '', success: '' });
    setProfileLoading(true);
    try {
      const updated = await api.auth.updateProfile({ full_name: fullName });
      setMe(updated);
      setProfileMsg({ error: '', success: t('settings.saved') });
    } catch (err: unknown) {
      setProfileMsg({ error: getErrorMessage(err, t('common.error')), success: '' });
    } finally {
      setProfileLoading(false);
    }
  }

  async function handlePasswordChange(e: FormEvent) {
    e.preventDefault();
    const pwErr =
      validateRequired(pwForm.current, t('auth.currentPassword'))
      ?? validatePassword(pwForm.next)
      ?? validatePasswordMatch(pwForm.next, pwForm.confirm);
    if (pwErr) { setPwMsg({ error: pwErr, success: '' }); return; }
    setPwMsg({ error: '', success: '' });
    setPwLoading(true);
    try {
      await api.auth.changePassword(pwForm.current, pwForm.next);
      setPwMsg({ error: '', success: t('settings.saved') });
      setPwForm({ current: '', next: '', confirm: '' });
    } catch (err: unknown) {
      setPwMsg({ error: getErrorMessage(err, t('common.error')), success: '' });
    } finally {
      setPwLoading(false);
    }
  }

  async function revokeSession(id: string) {
    setSessionsError('');
    try {
      await api.auth.revokeSession(id);
      setSessions(prev => prev.filter(s => s.id !== id));
    } catch (err) {
      setSessionsError(getErrorMessage(err, t('common.error')));
    }
  }

  async function handleDeleteAccount() {
    setDeleting(true);
    try {
      await api.auth.deleteAccount();
      clearAccessToken();
      router.replace('/login');
    } catch (err: unknown) {
      setDeleteError(getErrorMessage(err, t('common.error')));
    } finally {
      setDeleting(false);
    }
  }

  const canDelete    = me?.role === 'admin' || me?.role === 'super_admin';

  const visibleSessions = showAllSessions ? sessions : sessions.slice(0, PREVIEW_SESSION_LIMIT);

  return (
    <div className={styles.page}>
      <PageHeader
        title={t('settings.title')}
        subtitle={t('settings.subtitle')}
        border
      />

      {loadError && <FormAlert message={loadError} className={styles.pageAlert} />}

      {/* ── Identity card ─────────────────────────────────────── */}
      {me && (
        <section className={styles.identityCard}>
          <div className={styles.identityAvatar} aria-hidden="true">
            {initials(me.full_name || me.email)}
          </div>
          <div className={styles.identityBody}>
            <h2 className={styles.identityName}>{me.full_name || '—'}</h2>
            <div className={styles.identityMeta}>
              <span className={styles.identityMetaItem}>
                <Mail size={13} strokeWidth={1.7} aria-hidden="true" />
                {me.email}
              </span>
              {me.created_at && (
                <span className={styles.identityMetaItem}>
                  <Calendar size={13} strokeWidth={1.7} aria-hidden="true" />
                  {t('settings.joined')}{' '}
                  {new Date(me.created_at).toLocaleDateString(
                    locale === 'fr' ? 'fr-FR' : locale === 'ar' ? 'ar-DZ' : 'en-US',
                    { year: 'numeric', month: 'short', day: 'numeric' },
                  )}
                </span>
              )}
            </div>
          </div>
          <Badge variant={roleBadgeVariant(me.role)}>
            <ShieldCheck size={11} strokeWidth={2} className={styles.roleBadgeIcon} />
            {roleLabel(me.role, t)}
          </Badge>
        </section>
      )}

      {/* ── Profile section ───────────────────────────────────── */}
      <section className={styles.section} aria-labelledby="profile-heading">
        <header className={styles.sectionHead}>
          <div className={styles.sectionHeadIcon}>
            <UserIcon size={15} strokeWidth={1.7} />
          </div>
          <div>
            <h3 id="profile-heading" className={styles.sectionTitle}>{t('settings.profile')}</h3>
            <p className={styles.sectionSubtitle}>{t('settings.profileDesc')}</p>
          </div>
        </header>

        <form className={styles.form} onSubmit={handleProfileSave}>
          <Input
            label={t('settings.fullName')}
            type="text"
            value={fullName}
            onChange={e => setFullName(e.target.value)}
            required
          />
          <FormAlert message={profileMsg.error} />
          {profileMsg.success && <FormAlert variant="success" message={profileMsg.success} />}
          <div className={styles.formActions}>
            <Button type="submit" loading={profileLoading} size="sm">
              {t('settings.saveChanges')}
            </Button>
          </div>
        </form>
      </section>

      {/* ── Password section ──────────────────────────────────── */}
      <section className={styles.section} aria-labelledby="security-heading">
        <header className={styles.sectionHead}>
          <div className={styles.sectionHeadIcon}>
            <Lock size={15} strokeWidth={1.7} />
          </div>
          <div>
            <h3 id="security-heading" className={styles.sectionTitle}>{t('settings.changePassword')}</h3>
            <p className={styles.sectionSubtitle}>{t('settings.passwordDesc')}</p>
          </div>
        </header>

        <form className={styles.form} onSubmit={handlePasswordChange}>
          <Input
            label={t('auth.currentPassword')}
            type="password"
            value={pwForm.current}
            onChange={e => setPwForm(f => ({ ...f, current: e.target.value }))}
            required
          />
          <Input
            label={t('auth.newPassword')}
            type="password"
            value={pwForm.next}
            onChange={e => setPwForm(f => ({ ...f, next: e.target.value }))}
            required
            hint={t('settings.passwordHint')}
          />
          <Input
            label={t('auth.confirmPassword')}
            type="password"
            value={pwForm.confirm}
            onChange={e => setPwForm(f => ({ ...f, confirm: e.target.value }))}
            required
          />
          <FormAlert message={pwMsg.error} />
          {pwMsg.success && <FormAlert variant="success" message={pwMsg.success} />}
          <div className={styles.formActions}>
            <Button type="submit" loading={pwLoading} size="sm">
              {t('settings.saveChanges')}
            </Button>
          </div>
        </form>
      </section>

      {/* ── Interface language ────────────────────────────────── */}
      <section className={styles.section} aria-labelledby="lang-heading">
        <header className={styles.sectionHead}>
          <div className={styles.sectionHeadIcon}>
            <Languages size={15} strokeWidth={1.7} />
          </div>
          <div>
            <h3 id="lang-heading" className={styles.sectionTitle}>{t('settings.language')}</h3>
            <p className={styles.sectionSubtitle}>{t('settings.languageDesc')}</p>
          </div>
        </header>

        <div className={styles.langList} role="radiogroup" aria-labelledby="lang-heading">
          {locales.map(l => {
            const active = locale === l;
            return (
              <button
                key={l}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setLocale(l)}
                className={[styles.langItem, active ? styles.langItemActive : ''].join(' ')}
              >
                <div className={styles.langItemBody}>
                  <span className={styles.langNative}>{LOCALE_META[l].native}</span>
                  <span className={styles.langLatin}>{LOCALE_META[l].latin}</span>
                </div>
                <span className={styles.langCheck} aria-hidden="true">
                  {active && <Check size={15} strokeWidth={2.3} />}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* ── Active sessions ───────────────────────────────────── */}
      <section className={styles.section} aria-labelledby="sessions-heading">
        <header className={styles.sectionHead}>
          <div className={styles.sectionHeadIcon}>
            <Monitor size={15} strokeWidth={1.7} />
          </div>
          <div>
            <h3 id="sessions-heading" className={styles.sectionTitle}>{t('settings.activeSessions')}</h3>
            <p className={styles.sectionSubtitle}>{t('settings.activeSessionsDesc')}</p>
          </div>
        </header>

        <FormAlert message={sessionsError} />

        <div className={styles.deviceList}>
          {sessionsLoading ? (
            // skeleton rows
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className={styles.deviceRow}>
                <span className={`skeleton-line ${styles.deviceSkeletonIcon}`} />
                <div className={styles.deviceInfo}>
                  <span className={`skeleton-line ${styles.deviceSkeletonName}`}  style={{ animationDelay: `${i * 80}ms` }} />
                  <span className={`skeleton-line ${styles.deviceSkeletonMeta}`}  style={{ animationDelay: `${i * 80 + 40}ms` }} />
                </div>
              </div>
            ))
          ) : sessions.length === 0 ? (
            <p className={styles.sessionsNote}>{t('common.noData')}</p>
          ) : (
            <>
              {visibleSessions.map(s => (
                <div key={s.id} className={styles.deviceRow}>
                  <div className={styles.deviceIcon}>{deviceIcon(s.user_agent)}</div>
                  <div className={styles.deviceInfo}>
                    <p className={styles.deviceName}>{parseUA(s.user_agent) || t('settings.unknownDevice')}</p>
                    <p className={styles.deviceMeta}>
                      {s.ip_address ?? t('settings.unknownIp')}
                      <span className={styles.deviceMetaDot}>·</span>
                      {s.last_used_at
                        ? new Date(s.last_used_at).toLocaleString(
                            locale === 'fr' ? 'fr-FR' : locale === 'ar' ? 'ar-DZ' : 'en-US',
                            { dateStyle: 'short', timeStyle: 'short' },
                          )
                        : t('settings.never')}
                    </p>
                  </div>
                  <button
                    type="button"
                    className={styles.revokeBtn}
                    onClick={() => revokeSession(s.id)}
                    aria-label={t('settings.revokeSession')}
                    title={t('settings.revoke')}
                  >
                    <Trash2 size={14} strokeWidth={1.7} />
                  </button>
                </div>
              ))}

              {sessions.length > PREVIEW_SESSION_LIMIT && (
                <button
                  type="button"
                  className={styles.showAllBtn}
                  onClick={() => setShowAllSessions(v => !v)}
                  aria-expanded={showAllSessions}
                >
                  <ChevronDown
                    size={14}
                    strokeWidth={2}
                    className={[styles.showAllChevron, showAllSessions ? styles.showAllChevronOpen : ''].join(' ')}
                  />
                  {showAllSessions
                    ? t('settings.showFewer')
                    : t('settings.showAll').replace('{count}', String(sessions.length))}
                </button>
              )}
            </>
          )}
        </div>
      </section>

      {/* ── Danger zone ───────────────────────────────────────── */}
      {canDelete && (
        <section className={[styles.section, styles.sectionDanger].join(' ')} aria-labelledby="danger-heading">
          <header className={styles.sectionHead}>
            <div className={[styles.sectionHeadIcon, styles.sectionHeadIconDanger].join(' ')}>
              <AlertTriangle size={15} strokeWidth={1.7} />
            </div>
            <div>
              <h3 id="danger-heading" className={[styles.sectionTitle, styles.sectionTitleDanger].join(' ')}>
                {t('settings.dangerZone')}
              </h3>
              <p className={styles.sectionSubtitle}>{t('settings.dangerZoneDesc')}</p>
            </div>
          </header>

          <FormAlert message={deleteError} />
          {!deleteConfirm ? (
            <Button variant="danger" size="sm" onClick={() => setDeleteConfirm(true)}>
              {t('settings.deleteMyAccount')}
            </Button>
          ) : (
            <div className={styles.confirmRow}>
              <span className={styles.confirmLabel}>{t('settings.sure')}</span>
              <Button variant="danger" size="sm" loading={deleting} onClick={handleDeleteAccount}>
                {t('confirm.yes')}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setDeleteConfirm(false)}>
                {t('common.cancel')}
              </Button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
