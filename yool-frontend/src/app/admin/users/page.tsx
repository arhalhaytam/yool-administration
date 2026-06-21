'use client';
import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import Link from 'next/link';
import { Search, RefreshCw, Shield, Mail, Users as UsersIcon } from 'lucide-react';
import { api } from '@/lib/api';
import type { User, TeacherInvite, UserRoleSummary } from '@/lib/types';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Badge from '@/components/ui/Badge';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import Pagination from '@/components/ui/Pagination';
import ResponsiveTable, { type TableColumn } from '@/components/ui/ResponsiveTable';
import { LIST_PAGE_SIZE } from '@/lib/pagination';
import FormAlert from '@/components/ui/FormAlert';
import { getErrorMessage } from '@/lib/errors';
import { useLocale, useT } from '@/lib/i18n/LanguageContext';
import { useApiErrors } from '@/lib/i18n/useApiErrors';
import { validateEmail, validatePassword, type FieldErrors } from '@/lib/validation';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/Confirm';
import Modal from '@/components/ui/Modal';
import styles from './page.module.css';


type Tab = 'all' | 'teacher' | 'admin' | 'invites';
type Modal = null | 'invite' | 'reset';

export default function AdminUsersPage() {
  const t = useT();
  const { locale, isRTL } = useLocale();
  const apiErrors = useApiErrors();
  const { success, error: toastError } = useToast();
  const { confirm } = useConfirm();
  const [users, setUsers] = useState<User[]>([]);
  const [invites, setInvites] = useState<TeacherInvite[]>([]);
  const [summary, setSummary] = useState<UserRoleSummary | null>(null);
  const [tab, setTab] = useState<Tab>('all');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [modal, setModal] = useState<Modal>(null);
  const [resetTarget, setResetTarget] = useState<User | null>(null);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'teacher' | 'admin'>('teacher');
  const [inviting, setInviting] = useState(false);

  const [resetPw, setResetPw] = useState('');
  const [resetting, setResetting] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [summaryError, setSummaryError] = useState('');
  const [inviteFieldErrors, setInviteFieldErrors] = useState<FieldErrors>({});
  const [resetFieldErrors, setResetFieldErrors] = useState<FieldErrors>({});

  const [indicatorStyle, setIndicatorStyle] = useState({ insetInlineStart: 0, width: 0 });
  const tabsRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<{ [key: string]: HTMLButtonElement | null }>({});
  const l = {
    en: {
      tabs: { all: 'All', teacher: 'Teachers', admin: 'Admins', invites: 'Invites' },
      pending: 'pending',
      inviteSent: 'Invitation successfully sent to {email}',
      resetDone: 'Password reset successfully for {email}',
      deactivateTitle: 'Deactivate user',
      deactivateDesc: 'Are you sure you want to deactivate {name}? They will immediately lose access to the system.',
      deactivateCta: 'Deactivate',
      revokeTitle: 'Revoke invitation',
      revokeDesc: 'Are you sure you want to revoke this invitation? The invite link will become invalid and cannot be used.',
      revokeCta: 'Revoke invite',
      inviteRevoked: 'Invitation revoked successfully',
      userState: 'User {email} is now {state}',
      active: 'active',
      inactive: 'inactive',
      table: { name: 'Name', email: 'Email', role: 'Role', status: 'Status', joined: 'Joined', expires: 'Expires', revoke: 'Revoke' },
      status: { deleted: 'DELETED', active: 'Active', inactive: 'Inactive', accepted: 'Accepted', pending: 'Pending', expired: 'Expired' },
      inviteDesc: 'Email',
      inviteEmailLabel: 'Email',
      inviteEmailPlaceholder: 'teacher@institution.com',
      inviteRoleLabel: 'Role',
      newPassword: 'New password',
      newPasswordHint: 'Min 8 chars, one uppercase, one number',
    },
    fr: {
      tabs: { all: 'Tous', teacher: 'Enseignants', admin: 'Administrateurs', invites: 'Invitations' },
      pending: 'en attente',
      inviteSent: 'Invitation envoyée avec succès à {email}',
      resetDone: 'Mot de passe réinitialisé pour {email}',
      deactivateTitle: 'Désactiver l’utilisateur',
      deactivateDesc: 'Voulez-vous vraiment désactiver {name} ? Il perdra immédiatement l’accès au système.',
      deactivateCta: 'Désactiver',
      revokeTitle: 'Révoquer l’invitation',
      revokeDesc: 'Voulez-vous vraiment révoquer cette invitation ? Le lien deviendra invalide.',
      revokeCta: 'Révoquer l’invitation',
      inviteRevoked: 'Invitation révoquée avec succès',
      userState: 'L’utilisateur {email} est maintenant {state}',
      active: 'actif',
      inactive: 'inactif',
      table: { name: 'Nom', email: 'E-mail', role: 'Rôle', status: 'Statut', joined: 'Inscrit', expires: 'Expire', revoke: 'Révoquer' },
      status: { deleted: 'SUPPRIMÉ', active: 'Actif', inactive: 'Inactif', accepted: 'Acceptée', pending: 'En attente', expired: 'Expirée' },
      inviteDesc: 'E-mail',
      inviteEmailLabel: 'E-mail',
      inviteEmailPlaceholder: 'enseignant@institution.com',
      inviteRoleLabel: 'Rôle',
      newPassword: 'Nouveau mot de passe',
      newPasswordHint: 'Min 8 caractères, une majuscule, un chiffre',
    },
    ar: {
      tabs: { all: 'الكل', teacher: 'الأساتذة', admin: 'المديرون', invites: 'الدعوات' },
      pending: 'قيد الانتظار',
      inviteSent: 'تم إرسال الدعوة بنجاح إلى {email}',
      resetDone: 'تمت إعادة تعيين كلمة المرور لـ {email}',
      deactivateTitle: 'تعطيل المستخدم',
      deactivateDesc: 'هل تريد تعطيل {name}؟ سيفقد الوصول إلى النظام فوراً.',
      deactivateCta: 'تعطيل',
      revokeTitle: 'إلغاء الدعوة',
      revokeDesc: 'هل تريد إلغاء هذه الدعوة؟ سيصبح رابط الدعوة غير صالح.',
      revokeCta: 'إلغاء الدعوة',
      inviteRevoked: 'تم إلغاء الدعوة بنجاح',
      userState: 'المستخدم {email} أصبح الآن {state}',
      active: 'نشط',
      inactive: 'غير نشط',
      table: { name: 'الاسم', email: 'البريد', role: 'الدور', status: 'الحالة', joined: 'تاريخ الانضمام', expires: 'ينتهي', revoke: 'إلغاء' },
      status: { deleted: 'محذوف', active: 'نشط', inactive: 'غير نشط', accepted: 'مقبولة', pending: 'قيد الانتظار', expired: 'منتهية' },
      inviteDesc: 'البريد الإلكتروني',
      inviteEmailLabel: 'البريد الإلكتروني',
      inviteEmailPlaceholder: 'teacher@institution.com',
      inviteRoleLabel: 'الدور',
      newPassword: 'كلمة المرور الجديدة',
      newPasswordHint: '8 أحرف على الأقل، حرف كبير واحد، رقم واحد',
    },
  }[locale];
  const tabs: { id: Tab; label: string }[] = [
    { id: 'all', label: l.tabs.all },
    { id: 'teacher', label: l.tabs.teacher },
    { id: 'admin', label: l.tabs.admin },
    { id: 'invites', label: l.tabs.invites },
  ];

  useEffect(() => {
    const activeTabEl = tabRefs.current[tab];
    if (activeTabEl) {
      setIndicatorStyle({
        insetInlineStart: activeTabEl.offsetLeft,
        width: activeTabEl.offsetWidth,
      });
    }
  }, [tab, loading]); // also update on loading finish when tab counts refresh

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);


  useEffect(() => {
    refreshSummary();
  }, []);

  const loadPage = useCallback(async (pageOffset: number, activeTab: Tab, q: string) => {
    setLoading(true);
    setLoadError('');
    try {
      if (activeTab === 'invites') {
        const page = await api.admin.listInvites({
          limit: LIST_PAGE_SIZE,
          offset: pageOffset,
          search: q || undefined,
        });
        setInvites(page.items);
        setTotal(page.total);
        setOffset(page.offset);
      } else {
        const page = await api.admin.listUsers({
          limit: LIST_PAGE_SIZE,
          offset: pageOffset,
          role_group: activeTab === 'teacher' ? 'teacher' : activeTab === 'admin' ? 'admin' : undefined,
          search: q || undefined,
        });
        setUsers(page.items);
        setTotal(page.total);
        setOffset(page.offset);
      }
    } catch (err) {
      if (activeTab === 'invites') setInvites([]);
      else setUsers([]);
      setTotal(0);
      setLoadError(getErrorMessage(err, t('common.error'), apiErrors));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setOffset(0);
    loadPage(0, tab, debouncedSearch);
  }, [tab, debouncedSearch, loadPage]);

  function changeTab(id: Tab) {
    setTab(id);
    setOffset(0);
  }

  function tabCount(id: Tab): number {
    if (!summary) return 0;
    if (id === 'all') return summary.total;
    if (id === 'teacher') return summary.teachers;
    if (id === 'admin') return summary.admins;
    return summary.pending_invites;
  }

  async function refreshSummary() {
    try {
      setSummary(await api.admin.usersSummary());
      setSummaryError('');
    } catch (err) {
      setSummary(null);
      setSummaryError(getErrorMessage(err, t('common.error'), apiErrors));
    }
  }

  async function handleInvite() {
    const emailErr = validateEmail(inviteEmail);
    if (emailErr) {
      setInviteFieldErrors({ email: emailErr });
      return;
    }
    setInviteFieldErrors({});
    setInviting(true);
    try {
      await api.admin.createInvite(inviteEmail.trim(), inviteRole);
      success(l.inviteSent.replace('{email}', inviteEmail.trim()));
      setInviteEmail('');
      closeModal();
      setTab('invites');
      await refreshSummary();
      await loadPage(0, 'invites', debouncedSearch);
    } catch (err) {
      toastError(getErrorMessage(err, t('common.error'), apiErrors));
    } finally {
      setInviting(false);
    }
  }

  async function handleForceReset() {
    if (!resetTarget) return;
    const pwErr = validatePassword(resetPw);
    if (pwErr) {
      setResetFieldErrors({ password: pwErr });
      return;
    }
    setResetFieldErrors({});
    setResetting(true);
    try {
      await api.admin.forceResetPassword(resetTarget.id, resetPw);
      success(l.resetDone.replace('{email}', resetTarget.email));
      setResetPw('');
      closeModal();
    } catch (err) {
      toastError(getErrorMessage(err, t('common.error'), apiErrors));
    } finally {
      setResetting(false);
    }
  }

  async function toggleActive(user: User) {
    if (user.is_active) {
      const confirmed = await confirm(
        l.deactivateTitle,
        l.deactivateDesc.replace('{name}', user.full_name || user.email),
        { confirmLabel: l.deactivateCta, cancelLabel: t('common.cancel'), variant: 'warning' }
      );
      if (!confirmed) return;
    }
    try {
      const nextActiveState = !user.is_active;
      await api.admin.updateUser(user.id, { is_active: nextActiveState });
      success(
        l.userState
          .replace('{email}', user.email)
          .replace('{state}', nextActiveState ? l.active : l.inactive),
      );
      await loadPage(offset, tab, debouncedSearch);
      await refreshSummary();
    } catch (err) {
      toastError(getErrorMessage(err, t('common.error'), apiErrors));
    }
  }

  async function handleRevokeInvite(id: string) {
    const confirmed = await confirm(
      l.revokeTitle,
      l.revokeDesc,
      { confirmLabel: l.revokeCta, cancelLabel: t('common.cancel'), variant: 'danger' }
    );
    if (!confirmed) return;
    try {
      await api.admin.revokeInvite(id);
      success(l.inviteRevoked);
      await loadPage(offset, 'invites', debouncedSearch);
      await refreshSummary();
    } catch (err) {
      toastError(getErrorMessage(err, t('common.error'), apiErrors));
    }
  }

  const roleVariant = (role: string) =>
    role === 'super_admin' ? 'danger' : role === 'admin' ? 'purple' : 'accent';

  function closeModal() {
    setModal(null);
    setResetTarget(null);
    setInviteEmail('');
    setResetPw('');
    setInviteFieldErrors({});
    setResetFieldErrors({});
  }


  function inviteStatus(inv: TeacherInvite): 'accepted' | 'pending' | 'expired' {
    if (inv.used_at) return 'accepted';
    if (new Date(inv.expires_at) < new Date()) return 'expired';
    return 'pending';
  }

  // ── Column definitions for the user list ────────────────────────
  const userColumns: TableColumn<User>[] = useMemo(() => [
    {
      id: 'name',
      header: l.table.name,
      primary: true,
      cell: u => (
        <Link href={`/admin/users/${u.id}`} className={styles.nameLink}>
          {u.full_name || u.email}
        </Link>
      ),
    },
    {
      id: 'email',
      header: l.table.email,
      cell: u => <span className={styles.email}>{u.email}</span>,
    },
    {
      id: 'role',
      header: l.table.role,
      cell: u => (
        <Badge variant={roleVariant(u.role)}>
          {t(`admin.role.${u.role}`)}
        </Badge>
      ),
    },
    {
      id: 'status',
      header: l.table.status,
      cell: u =>
        u.is_deleted ? (
          <Badge variant="default">{l.status.deleted}</Badge>
        ) : u.is_active ? (
          <Badge variant="success" dot>{l.status.active}</Badge>
        ) : (
          <Badge variant="default" dot>{l.status.inactive}</Badge>
        ),
    },
    {
      id: 'joined',
      header: l.table.joined,
      hideOnMobile: true,
      cell: u => (
        <span className={styles.date}>
          {new Date(u.created_at).toLocaleDateString(
            locale === 'fr' ? 'fr-DZ' : locale === 'ar' ? 'ar-DZ' : 'en-US',
          )}
        </span>
      ),
    },
    {
      id: 'actions',
      header: '',
      align: 'end',
      unlabeledOnMobile: true,
      cell: u =>
        u.is_deleted ? null : (
          <div className={styles.actionGroup}>
            <button
              type="button"
              onClick={() => toggleActive(u)}
              className={[
                'ui-action-btn',
                u.is_active ? 'ui-action-btn--warn' : 'ui-action-btn--accent',
                styles.actionBtn,
              ].join(' ')}
            >
              {u.is_active ? t('admin.deactivate') : t('admin.activate')}
            </button>
            <button
              type="button"
              title={t('admin.forceReset')}
              onClick={() => { setResetTarget(u); setModal('reset'); }}
              className={['ui-action-btn', 'ui-action-btn--ghost', styles.actionBtn].join(' ')}
              aria-label={t('admin.forceReset')}
            >
              <RefreshCw size={12} />
            </button>
          </div>
        ),
    },
  ], [t, l, locale]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Column definitions for invites ──────────────────────────────
  const inviteColumns: TableColumn<TeacherInvite>[] = useMemo(() => [
    {
      id: 'email',
      header: l.table.email,
      primary: true,
      cell: inv => inv.email,
    },
    {
      id: 'role',
      header: l.table.role,
      cell: inv => (
        <Badge variant={roleVariant(inv.role)}>
          {t(`admin.role.${inv.role}`)}
        </Badge>
      ),
    },
    {
      id: 'status',
      header: l.table.status,
      cell: inv => {
        const s = inviteStatus(inv);
        if (s === 'accepted') return <Badge variant="success" dot>{l.status.accepted}</Badge>;
        if (s === 'pending')  return <Badge variant="warning" dot>{l.status.pending}</Badge>;
        return <Badge variant="default">{l.status.expired}</Badge>;
      },
    },
    {
      id: 'expires',
      header: l.table.expires,
      hideOnMobile: true,
      cell: inv => (
        <span className={styles.date}>
          {new Date(inv.expires_at).toLocaleString(
            locale === 'fr' ? 'fr-DZ' : locale === 'ar' ? 'ar-DZ' : 'en-US',
            {
            dateStyle: 'short',
            timeStyle: 'short',
            },
          )}
        </span>
      ),
    },
    {
      id: 'actions',
      header: '',
      align: 'end',
      unlabeledOnMobile: true,
      cell: inv =>
        inviteStatus(inv) === 'pending' ? (
          <button
            type="button"
            onClick={() => handleRevokeInvite(inv.id)}
            className={['ui-action-btn', 'ui-action-btn--warn', styles.actionBtn].join(' ')}
          >
            {l.table.revoke}
          </button>
        ) : null,
    },
  ], [t, l, locale]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <PageHeader
        title={t('admin.users')}
        subtitle={
          summary
            ? `${summary.total} ${t('admin.users').toLowerCase()} · ${summary.pending_invites} ${l.pending}`
            : loading && offset === 0
              ? '…'
              : `${total} ${tab === 'invites' ? t('admin.inviteUser').toLowerCase() : t('admin.users').toLowerCase()}`
        }
        border
        action={<Button size="sm" onClick={() => setModal('invite')}>+ {t('admin.inviteUser')}</Button>}
      />

      {loadError && <FormAlert message={loadError} className={styles.pageAlert} />}
      {summaryError && (
        <FormAlert variant="warning" message={summaryError} className={styles.pageAlert} />
      )}

      <div className={styles.toolbar}>
        <div className={styles.searchWrap}>
          <Search size={13} className={styles.searchIcon} />
          <input
            className={`${styles.searchInput} ui-search ui-control-sm`}
            placeholder={t('common.search')}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className={styles.tabs} ref={tabsRef}>
          {tabs.map(({ id, label }) => (
            <button
              key={id}
              ref={el => { tabRefs.current[id] = el; }}
              type="button"
              onClick={() => changeTab(id)}
              className={['ui-tab', styles.tab, tab === id ? 'is-active' : ''].join(' ')}
            >
              {label}
              <span className={styles.tabCount}>{tabCount(id)}</span>
            </button>
          ))}
          <div
            className={styles.tabIndicator}
            style={{
              insetInlineStart: indicatorStyle.insetInlineStart,
              width: indicatorStyle.width,
            }}
          />
        </div>
      </div>

      {tab === 'invites' ? (
        <ResponsiveTable<TeacherInvite>
          columns={inviteColumns}
          data={invites}
          getRowKey={inv => inv.id}
          loading={loading}
          emptyState={
            <EmptyState
              icon={Mail}
              title={t('admin.inviteUser')}
              description={search ? t('common.noData') : t('admin.inviteUser')}
            />
          }
        />
      ) : (
        <ResponsiveTable<User>
          columns={userColumns}
          data={users}
          getRowKey={u => u.id}
          loading={loading}
          emptyState={
            <EmptyState
              icon={UsersIcon}
              title={t('admin.noUsers')}
              description={t('common.noData')}
            />
          }
        />
      )}

      <Pagination
        offset={offset}
        pageSize={LIST_PAGE_SIZE}
        total={total}
        loading={loading}
        itemLabel={tab === 'invites' ? t('admin.inviteUser').toLowerCase() : t('admin.users').toLowerCase()}
        onPageChange={next => loadPage(next, tab, debouncedSearch)}
      />

      <Modal
        isOpen={modal === 'invite'}
        onClose={closeModal}
        title={t('admin.inviteUser')}
        subtitle={l.inviteDesc}
        size="md"
      >
        <div className={styles.modalForm}>
          <Input
            label={l.inviteEmailLabel}
            type="email"
            placeholder={l.inviteEmailPlaceholder}
            value={inviteEmail}
            onChange={e => {
              setInviteEmail(e.target.value);
              if (inviteFieldErrors.email) setInviteFieldErrors({});
            }}
            error={inviteFieldErrors.email}
            autoFocus
          />
          <div>
            <label className={styles.fieldLabel}>{l.inviteRoleLabel}</label>
            <div className={styles.chipRow}>
              {(['teacher', 'admin'] as const).map(r => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setInviteRole(r)}
                  className={[
                    'ui-chip',
                    inviteRole === r ? 'is-active' : '',
                  ].join(' ')}
                >
                  {r === 'admin' && <Shield size={12} />}
                  {t(`admin.role.${r}`)}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.modalActions}>
            <Button variant="ghost" onClick={closeModal}>{t('common.close')}</Button>
            <Button onClick={handleInvite} loading={inviting}>{t('admin.inviteUser')}</Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={modal === 'reset'}
        onClose={closeModal}
        title={t('auth.resetPassword')}
        subtitle={`${resetTarget?.email ?? ''}`}
        size="md"
      >
        <div className={styles.modalForm}>
          <Input
            label={l.newPassword}
            type="password"
            value={resetPw}
            onChange={e => {
              setResetPw(e.target.value);
              if (resetFieldErrors.password) setResetFieldErrors({});
            }}
            error={resetFieldErrors.password}
            hint={l.newPasswordHint}
            autoFocus
          />
          <div className={styles.modalActions}>
            <Button variant="ghost" onClick={closeModal}>{t('common.cancel')}</Button>
            <Button onClick={handleForceReset} loading={resetting} variant="danger">
              {t('auth.resetPassword')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
