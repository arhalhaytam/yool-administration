'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  User as UserIcon,
  Video,
  Trash2,
  ArrowRight,
  BookOpen,
  Search,
  RotateCcw,
} from 'lucide-react';
import { api } from '@/lib/api';
import type { Course, User, Level, Matiere } from '@/lib/types';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import Pagination from '@/components/ui/Pagination';
import { LIST_PAGE_SIZE } from '@/lib/pagination';
import FormAlert from '@/components/ui/FormAlert';
import { getErrorMessage } from '@/lib/errors';
import { type FieldErrors } from '@/lib/validation';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/Confirm';
import Modal from '@/components/ui/Modal';
import { useT, useLocale } from '@/lib/i18n/LanguageContext';
import { useApiErrors } from '@/lib/i18n/useApiErrors';
import styles from './page.module.css';

const LANGUAGES = ['fr', 'ar', 'en'] as const;
type LangCode = (typeof LANGUAGES)[number];

function teacherInitials(name?: string | null): string {
  if (!name) return '—';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function AdminCoursesPage() {
  const t = useT();
  const { locale, isRTL } = useLocale();
  const apiErrors = useApiErrors();
  const { success, error: toastError } = useToast();
  const { confirm } = useConfirm();

  // ─── Data ─────────────────────────────────────────────────────────────
  const [courses, setCourses] = useState<Course[]>([]);
  const [teachers, setTeachers] = useState<User[]>([]);
  const [levels, setLevels] = useState<Level[]>([]);
  const [matieres, setMatieres] = useState<Matiere[]>([]);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [loadError, setLoadError] = useState('');

  // ─── Filters ──────────────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterLevel, setFilterLevel] = useState('');
  const [filterMatiere, setFilterMatiere] = useState('');
  const [filterLanguage, setFilterLanguage] = useState('');

  // ─── Create modal ─────────────────────────────────────────────────────
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({
    level_id: '',
    matiere_id: '',
    official_language: 'fr',
    teacher_id: '',
  });
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const activeFilterCount = useMemo(() => {
    return [debouncedSearch, filterLevel, filterMatiere, filterLanguage]
      .filter(Boolean).length;
  }, [debouncedSearch, filterLevel, filterMatiere, filterLanguage]);

  // Debounce search input
  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(id);
  }, [search]);

  // ─── Fetch ────────────────────────────────────────────────────────────
  const loadPage = useCallback(
    async (pageOffset: number) => {
      setLoading(true);
      setLoadError('');
      try {
        const page = await api.courses.list({
          limit: LIST_PAGE_SIZE,
          offset: pageOffset,
          search: debouncedSearch || undefined,
          level_id: filterLevel || undefined,
          matiere_id: filterMatiere || undefined,
          language: filterLanguage || undefined,
        });
        setCourses(page.items ?? []);
        setTotal(page.total ?? 0);
        setOffset(page.offset ?? pageOffset);
      } catch (err) {
        setCourses([]);
        setTotal(0);
        setLoadError(getErrorMessage(err, t('common.error'), apiErrors));
      } finally {
        setLoading(false);
      }
    },
    [debouncedSearch, filterLevel, filterMatiere, filterLanguage, t, apiErrors],
  );

  // Whenever a filter changes, jump back to the first page
  useEffect(() => {
    loadPage(0);
    // Intentionally only re-run when the *filter inputs* change, not on every
    // identity change of loadPage (which is rebuilt whenever its deps change).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, filterLevel, filterMatiere, filterLanguage]);

  // ─── Initial dependencies (teachers/levels/matieres) ──────────────────
  useEffect(() => {
    const safe = async <T,>(fn: () => Promise<T>, fallback: T): Promise<T> => {
      try { return await fn(); } catch { return fallback; }
    };
    (async () => {
      const [teachersData, levelsData, matieresData] = await Promise.all([
        safe(() => api.admin.listUsers({ role_group: 'teacher', limit: 500, offset: 0 }),
             { items: [], total: 0, limit: 0, offset: 0, has_more: false }),
        safe(() => api.hierarchy.listLevels(), [] as Level[]),
        safe(() => api.hierarchy.listMatieres(), [] as Matiere[]),
      ]);
      setTeachers(teachersData.items ?? []);
      setLevels(levelsData);
      setMatieres(matieresData);
    })();
  }, []);

  // ─── Filter reset ─────────────────────────────────────────────────────
  const resetFilters = () => {
    setSearch('');
    setFilterLevel('');
    setFilterMatiere('');
    setFilterLanguage('');
  };

  // ─── Create ───────────────────────────────────────────────────────────
  async function handleCreate() {
    const errors: FieldErrors = {};
    if (!form.level_id) errors.level_id = t('course.selectLevel');
    if (!form.matiere_id) errors.matiere_id = t('course.selectSubject');
    if (!form.official_language) errors.official_language = t('course.filterByLanguage');
    if (!form.teacher_id) errors.teacher_id = t('course.selectTeacher');

    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSaving(true);
    try {
      await api.courses.create(form);
      success(t('course.newCourse'));
      setShowModal(false);
      setForm({ level_id: '', matiere_id: '', official_language: 'fr', teacher_id: '' });
      setFieldErrors({});
      await loadPage(0);
    } catch (err) {
      toastError(getErrorMessage(err, t('common.error'), apiErrors));
    } finally {
      setSaving(false);
    }
  }

  // ─── Delete ───────────────────────────────────────────────────────────
  async function handleDelete(id: string) {
    const ok = await confirm(
      t('course.deleteCourseTitle'),
      t('course.deleteCourseDesc'),
      {
        confirmLabel: t('common.delete'),
        cancelLabel: t('common.cancel'),
        variant: 'danger',
      },
    );
    if (!ok) return;
    try {
      await api.courses.delete(id);
      success(t('course.courseDeleted'));
      await loadPage(offset);
    } catch (err) {
      toastError(getErrorMessage(err, t('common.error'), apiErrors));
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────
  const filtersActive = activeFilterCount > 0;

  return (
    <div className={styles.page}>
      <PageHeader
        title={t('course.title')}
        subtitle={
          loading && offset === 0
            ? '…'
            : `${total} ${t('course.title').toLowerCase()}`
        }
        border
        action={
          <Button onClick={() => setShowModal(true)}>+ {t('course.newCourse')}</Button>
        }
      />

      {loadError && (
        <FormAlert variant="warning" message={loadError} className={styles.pageAlert} />
      )}

      {/* ── Filter toolbar ───────────────────────────────────────── */}
      <div className={styles.toolbar} role="search">
        <div className={styles.searchWrap}>
          <Search size={14} strokeWidth={2} className={styles.searchIcon} aria-hidden="true" />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('course.searchPlaceholder')}
            aria-label={t('common.search')}
            className={styles.searchInput}
          />
        </div>

        <div className={styles.toolbarSelect}>
          <Select
            value={filterLevel}
            onChange={(e) => setFilterLevel(e.target.value)}
            aria-label={t('course.filterByLevel')}
          >
            <option value="">{t('course.allLevels')}</option>
            {levels.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </Select>
        </div>

        <div className={styles.toolbarSelect}>
          <Select
            value={filterMatiere}
            onChange={(e) => setFilterMatiere(e.target.value)}
            aria-label={t('course.filterBySubject')}
          >
            <option value="">{t('course.allSubjects')}</option>
            {matieres.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </Select>
        </div>

        <div className={styles.toolbarSelect}>
          <Select
            value={filterLanguage}
            onChange={(e) => setFilterLanguage(e.target.value)}
            aria-label={t('course.filterByLanguage')}
          >
            <option value="">{t('course.allLanguages')}</option>
            {LANGUAGES.map((lng) => (
              <option key={lng} value={lng}>{lng.toUpperCase()}</option>
            ))}
          </Select>
        </div>

        <button
          type="button"
          className={styles.resetBtn}
          onClick={resetFilters}
          disabled={!filtersActive}
          aria-label={t('common.clear')}
        >
          <RotateCcw size={13} strokeWidth={2} />
          <span>{t('common.clear')}</span>
        </button>

        {filtersActive && (
          <span className={styles.activeFilterPill}>
            {activeFilterCount}{' '}
            {activeFilterCount === 1
              ? t('course.activeFilters')
              : t('course.activeFiltersPlural')}
          </span>
        )}
      </div>

      {/* ── Grid ─────────────────────────────────────────────────── */}
      {loading && courses.length === 0 ? (
        <div className={styles.grid}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className={styles.cardSkeleton}
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <span className={`skeleton-line ${styles.sk1}`} />
              <span className={`skeleton-line ${styles.sk2}`} />
              <span className={`skeleton-line ${styles.sk3}`} />
              <span className={`skeleton-line ${styles.sk4}`} />
            </div>
          ))}
        </div>
      ) : courses.length === 0 && total === 0 ? (
        <div className={styles.emptyWrap}>
          <EmptyState
            icon={BookOpen}
            title={t('course.noCoursesYet')}
            description={t('course.noCoursesYetDesc')}
            action={
              <Button onClick={() => setShowModal(true)}>
                + {t('course.newCourse')}
              </Button>
            }
          />
        </div>
      ) : (
        <>
          <div className={[styles.grid, loading ? styles.gridLoading : ''].join(' ')}>
            {courses.map((c, i) => {
              const teacher = teachers.find((tt) => tt.id === c.teacher_id);
              const n = c.session_count ?? 0;
              const matiereName = c.matiere?.name || t('course.subject');
              const levelName = c.level?.name || t('course.level');
              const lang = (c.official_language || 'fr').toUpperCase();
              return (
                <article
                  key={c.id}
                  className={`${styles.card} ui-surface ui-surface-interactive`}
                  style={{ animationDelay: `${i * 40}ms` }}
                >
                  <header className={styles.cardHead}>
                    <span className={styles.cardChip} aria-hidden="true">
                      <BookOpen size={14} strokeWidth={2} />
                    </span>
                    <div className={styles.cardEyebrow} title={levelName}>
                      <span className={styles.cardEyebrowText}>{levelName}</span>
                    </div>
                    <span className={styles.langPill}>{lang}</span>
                    <button
                      type="button"
                      className={styles.deleteBtn}
                      onClick={() => handleDelete(c.id)}
                      aria-label={t('common.delete')}
                      title={t('common.delete')}
                    >
                      <Trash2 size={14} strokeWidth={2} />
                    </button>
                  </header>

                  <h2 className={styles.cardSubject} title={matiereName}>
                    {matiereName}
                  </h2>

                  <div className={styles.metaRows}>
                    <div className={styles.metaRow}>
                      <span className={styles.teacherInitials} aria-hidden="true">
                        {teacherInitials(teacher?.full_name)}
                      </span>
                      <span className={styles.metaTeacher} title={teacher?.full_name ?? '—'}>
                        {teacher?.full_name ?? '—'}
                      </span>
                    </div>
                    <div className={styles.metaRow}>
                      <Video size={14} strokeWidth={2} className={styles.metaIcon} aria-hidden="true" />
                      <span className={styles.metaValue}>
                        {n}
                        <em>{t('course.sessions')}</em>
                      </span>
                    </div>
                  </div>

                  <footer className={styles.cardFooter}>
                    <span className={styles.cardDate}>
                      {t('course.addedOn')}{' '}
                      {new Date(c.created_at).toLocaleDateString(locale, { dateStyle: 'medium' })}
                    </span>
                    <Link
                      href={`/admin/courses/${c.id}`}
                      className={styles.viewLink}
                    >
                      {t('course.viewCourse')}
                      {isRTL ? <span className={styles.arrowRtl}><ArrowRight size={13} strokeWidth={2} /></span> : <ArrowRight size={13} strokeWidth={2} />}
                    </Link>
                  </footer>
                </article>
              );
            })}
          </div>

          <Pagination
            offset={offset}
            pageSize={LIST_PAGE_SIZE}
            total={total}
            loading={loading}
            itemLabel={t('course.title').toLowerCase()}
            onPageChange={(next) => {
              setOffset(next);
              loadPage(next);
            }}
          />
        </>
      )}

      {/* ── Create modal ─────────────────────────────────────────── */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={t('course.newCourse')}
        subtitle={t('course.assignTeacher')}
        size="md"
      >
        <div className={styles.modalForm}>
          <Select
            label={t('course.level')}
            value={form.level_id}
            onChange={(e) => setForm((f) => ({ ...f, level_id: e.target.value }))}
            error={fieldErrors.level_id}
          >
            <option value="">{t('course.selectLevel')}</option>
            {levels.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </Select>

          <Select
            label={t('course.subject')}
            value={form.matiere_id}
            onChange={(e) => setForm((f) => ({ ...f, matiere_id: e.target.value }))}
            error={fieldErrors.matiere_id}
          >
            <option value="">{t('course.selectSubject')}</option>
            {matieres.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </Select>

          <Select
            label={t('course.language')}
            value={form.official_language}
            onChange={(e) => setForm((f) => ({ ...f, official_language: e.target.value as LangCode }))}
            error={fieldErrors.official_language}
          >
            <option value="fr">Français (fr)</option>
            <option value="ar">العربية (ar)</option>
            <option value="en">English (en)</option>
          </Select>

          <Select
            id="course-teacher"
            label={t('course.assignTeacher')}
            value={form.teacher_id}
            onChange={(e) => setForm((f) => ({ ...f, teacher_id: e.target.value }))}
            error={fieldErrors.teacher_id}
          >
            <option value="">{t('course.selectTeacher')}</option>
            {teachers.map((tt) => (
              <option key={tt.id} value={tt.id}>
                {tt.full_name} ({tt.email})
              </option>
            ))}
          </Select>

          <div className={styles.modalActions}>
            <Button variant="ghost" onClick={() => setShowModal(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleCreate} loading={saving}>
              {t('common.create')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
