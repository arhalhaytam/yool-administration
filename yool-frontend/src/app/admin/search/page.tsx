'use client';
import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import type { Course, Level, Matiere, User } from '@/lib/types';
import PageHeader from '@/components/ui/PageHeader';
import FormAlert from '@/components/ui/FormAlert';
import { getErrorMessage } from '@/lib/errors';
import EmptyState from '@/components/ui/EmptyState';
import { Search, SearchX } from 'lucide-react';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Pagination from '@/components/ui/Pagination';
import { LIST_PAGE_SIZE } from '@/lib/pagination';
import { useApiErrors } from '@/lib/i18n/useApiErrors';
import { useLocale, useT } from '@/lib/i18n/LanguageContext';
import styles from './page.module.css';

const STAGGER = [
  styles.d0, styles.d1, styles.d2, styles.d3, styles.d4, styles.d5,
  styles.d6, styles.d7, styles.d8, styles.d9, styles.d10, styles.d11, styles.d12,
] as const;
const LANGUAGES = ['fr', 'ar', 'en'] as const;

export default function AdminSearchPage() {
  const t = useT();
  const { locale } = useLocale();
  const apiErrors = useApiErrors();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [query, setQuery] = useState(searchParams.get('q') ?? '');
  const [teacherId, setTeacherId] = useState(searchParams.get('teacher_id') ?? '');
  const [courseId, setCourseId] = useState(searchParams.get('course_id') ?? '');
  const [levelId, setLevelId] = useState(searchParams.get('level_id') ?? '');
  const [matiereId, setMatiereId] = useState(searchParams.get('matiere_id') ?? '');
  const [language, setLanguage] = useState(searchParams.get('language') ?? '');
  const [offset, setOffset] = useState(Number(searchParams.get('offset') ?? '0') || 0);

  const [teachers, setTeachers] = useState<User[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [levels, setLevels] = useState<Level[]>([]);
  const [matieres, setMatieres] = useState<Matiere[]>([]);
  const [filterLoadError, setFilterLoadError] = useState('');

  const [results, setResults] = useState<
    Awaited<ReturnType<typeof api.query.search>>['results']
  >([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(Boolean((searchParams.get('q') ?? '').trim()));
  const [searchError, setSearchError] = useState('');

  const filtersActive = useMemo(
    () => Boolean(query.trim() || teacherId || courseId || levelId || matiereId || language),
    [query, teacherId, courseId, levelId, matiereId, language],
  );

  function buildParams(next: {
    q?: string;
    teacher_id?: string;
    course_id?: string;
    level_id?: string;
    matiere_id?: string;
    language?: string;
    offset?: number;
  }) {
    const params = new URLSearchParams();
    if (next.q) params.set('q', next.q);
    if (next.teacher_id) params.set('teacher_id', next.teacher_id);
    if (next.course_id) params.set('course_id', next.course_id);
    if (next.level_id) params.set('level_id', next.level_id);
    if (next.matiere_id) params.set('matiere_id', next.matiere_id);
    if (next.language) params.set('language', next.language);
    if (next.offset && next.offset > 0) params.set('offset', String(next.offset));
    return params;
  }

  function syncUrl(nextOffset: number) {
    const params = buildParams({
      q: query.trim(),
      teacher_id: teacherId,
      course_id: courseId,
      level_id: levelId,
      matiere_id: matiereId,
      language,
      offset: nextOffset,
    });
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  async function runSearch(nextOffset = 0) {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setSearchError('Query must contain at least 2 characters');
      return;
    }

    setSearchError('');
    setLoading(true);
    setSearched(true);
    setOffset(nextOffset);
    syncUrl(nextOffset);
    try {
      const data = await api.query.search({
        query: trimmed,
        limit: LIST_PAGE_SIZE,
        offset: nextOffset,
        teacher_id: teacherId || undefined,
        course_id: courseId || undefined,
        level_id: levelId || undefined,
        matiere_id: matiereId || undefined,
        language: language || undefined,
      });
      setResults(data.results);
      setTotal(data.total);
    } catch (err) {
      setResults([]);
      setTotal(0);
      setSearchError(getErrorMessage(err, t('common.error'), apiErrors));
    } finally {
      setLoading(false);
    }
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    await runSearch(0);
  }

  function clearFilters() {
    setQuery('');
    setTeacherId('');
    setCourseId('');
    setLevelId('');
    setMatiereId('');
    setLanguage('');
    setOffset(0);
    setSearched(false);
    setResults([]);
    setTotal(0);
    setSearchError('');
    router.replace(pathname);
  }

  useEffect(() => {
    (async () => {
      try {
        setFilterLoadError('');
        const [teacherData, courseData, levelData, matiereData] = await Promise.all([
          api.admin.listUsers({ role_group: 'teacher', limit: 200, offset: 0 }),
          api.courses.list({ limit: 200, offset: 0 }),
          api.hierarchy.listLevels(),
          api.hierarchy.listMatieres(),
        ]);
        setTeachers(teacherData.items ?? []);
        setCourses(courseData.items ?? []);
        setLevels(levelData);
        setMatieres(matiereData);
      } catch (err) {
        setTeachers([]);
        setCourses([]);
        setLevels([]);
        setMatieres([]);
        setFilterLoadError(getErrorMessage(err, t('common.error'), apiErrors));
      }
    })();
  }, [t, apiErrors]);

  useEffect(() => {
    const initialQuery = (searchParams.get('q') ?? '').trim();
    if (!initialQuery) return;
    const nextOffset = Number(searchParams.get('offset') ?? '0') || 0;
    setQuery(initialQuery);
    setTeacherId(searchParams.get('teacher_id') ?? '');
    setCourseId(searchParams.get('course_id') ?? '');
    setLevelId(searchParams.get('level_id') ?? '');
    setMatiereId(searchParams.get('matiere_id') ?? '');
    setLanguage(searchParams.get('language') ?? '');
    void runSearch(nextOffset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resultCountLabel = t('search.resultCount').replace('{count}', String(total));

  return (
    <div className={styles.page}>
      <PageHeader
        title={t('search.title')}
        subtitle={t('search.subtitle')}
        border
      />

      <form onSubmit={handleSearch} className={styles.searchForm}>
        <div className={styles.toolbar} role="search">
          <div className={styles.searchWrap}>
            <Search size={15} strokeWidth={1.8} className={styles.searchGlyph} aria-hidden />
            <Input
              className={styles.searchInput}
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={t('search.placeholder')}
              autoFocus
              aria-label={t('common.search')}
            />
          </div>

          <div className={styles.toolbarSelect}>
            <Select value={teacherId} onChange={e => { setTeacherId(e.target.value); setOffset(0); }}>
              <option value="">{t('search.filters.teacher')}: {t('search.filters.all')}</option>
              {teachers.map(teacher => (
                <option key={teacher.id} value={teacher.id}>{teacher.full_name}</option>
              ))}
            </Select>
          </div>
          <div className={styles.toolbarSelect}>
            <Select value={courseId} onChange={e => { setCourseId(e.target.value); setOffset(0); }}>
              <option value="">{t('search.filters.course')}: {t('search.filters.all')}</option>
              {courses.map(course => (
                <option key={course.id} value={course.id}>
                  {course.matiere?.name} - {course.level?.name}
                </option>
              ))}
            </Select>
          </div>
          <div className={styles.toolbarSelect}>
            <Select value={levelId} onChange={e => { setLevelId(e.target.value); setOffset(0); }}>
              <option value="">{t('search.filters.level')}: {t('search.filters.all')}</option>
              {levels.map(level => (
                <option key={level.id} value={level.id}>{level.name}</option>
              ))}
            </Select>
          </div>
          <div className={styles.toolbarSelect}>
            <Select value={matiereId} onChange={e => { setMatiereId(e.target.value); setOffset(0); }}>
              <option value="">{t('search.filters.matiere')}: {t('search.filters.all')}</option>
              {matieres.map(matiere => (
                <option key={matiere.id} value={matiere.id}>{matiere.name}</option>
              ))}
            </Select>
          </div>
          <div className={styles.toolbarSelect}>
            <Select value={language} onChange={e => { setLanguage(e.target.value); setOffset(0); }}>
              <option value="">{t('search.filters.language')}: {t('search.filters.all')}</option>
              {LANGUAGES.map(lang => (
                <option key={lang} value={lang}>{lang.toUpperCase()}</option>
              ))}
            </Select>
          </div>
          <button type="button" className={styles.resetBtn} onClick={clearFilters} disabled={!filtersActive}>
            {t('search.filters.clear')}
          </button>
          <button type="submit" className={styles.searchBtn} disabled={loading || query.trim().length < 2}>
            {loading ? t('search.loading') : t('search.submit')}
          </button>
        </div>
      </form>

      <FormAlert variant="warning" message={searchError} className={styles.searchAlert} />
      <FormAlert variant="warning" message={filterLoadError} className={styles.searchAlert} />

      {loading && (
        <div className={styles.results}>
          <div className={`${styles.skeletonCard} ${styles.delay0}`}>
            <span className={`skeleton-line ${styles.skw1}`} />
            <span className={`skeleton-line ${styles.skw2}`} />
            <span className={`skeleton-line ${styles.skw3}`} />
          </div>
          <div className={`${styles.skeletonCard} ${styles.delay1}`}>
            <span className={`skeleton-line ${styles.skw1}`} />
            <span className={`skeleton-line ${styles.skw2}`} />
            <span className={`skeleton-line ${styles.skw3}`} />
          </div>
          <div className={`${styles.skeletonCard} ${styles.delay2}`}>
            <span className={`skeleton-line ${styles.skw1}`} />
            <span className={`skeleton-line ${styles.skw2}`} />
            <span className={`skeleton-line ${styles.skw3}`} />
          </div>
        </div>
      )}

      {!loading && searched && results.length === 0 && (
        <div className={styles.noResults}>
          <EmptyState
            icon={SearchX}
            title={t('search.noResults')}
            description={t('search.noResultsDesc').replace('{query}', query)}
          />
        </div>
      )}

      {!loading && results.length > 0 && (
        <>
          <div className={styles.results}>
            <p className={styles.resultCount}>{resultCountLabel}</p>
            {results.map((r, i) => {
              const pct = Math.min(100, Math.max(0, Math.round(r.score * 100)));
              const contextPct = r.context_score == null
                ? null
                : Math.min(100, Math.max(0, Math.round(r.context_score * 100)));
              return (
                <Link
                  key={r.session_id}
                  href={`/admin/sessions/${r.session_id}`}
                  className={[styles.resultCard, STAGGER[Math.min(i, 12)]].join(' ')}
                >
                  <div className={styles.scoreRow}>
                    <span className={styles.scoreLabel}>{pct}% {t('search.match')}</span>
                    <div className={styles.scoreTrack} aria-hidden>
                      <div className={styles.scoreFill} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <div className={styles.resultTitle}>{r.session_title ?? '—'}</div>
                  <div className={styles.courseTitle}>{r.course_title ?? '—'}</div>
                  <div className={styles.metaRow}>
                    <span>{r.teacher_name ?? '—'}</span>
                    <span>•</span>
                    <span>{r.level ?? '—'}</span>
                    <span>•</span>
                    <span>{r.matiere ?? '—'}</span>
                    <span>•</span>
                    <span>{(r.language ?? '—').toUpperCase()}</span>
                    <span>•</span>
                    <span>
                      {r.recorded_at ? new Date(r.recorded_at).toLocaleDateString(locale, { dateStyle: 'medium' }) : '—'}
                    </span>
                  </div>
                  {r.snippet && (
                    <div className={styles.snippet}>
                      <div className={styles.snippetLabel}>{t('search.topicLabel')}</div>
                      <div className={styles.snippetTitle}>{r.snippet.topic_title || '—'}</div>
                      <p className={styles.snippetDesc}>{r.snippet.topic_description || '—'}</p>
                    </div>
                  )}
                  {contextPct != null && (
                    <div className={styles.contextText}>{t('search.contextLabel')}: {contextPct}%</div>
                  )}
                  <div className={styles.resultAction}>{t('search.openSession')}</div>
                </Link>
              );
            })}
          </div>
          <Pagination
            offset={offset}
            pageSize={LIST_PAGE_SIZE}
            total={total}
            loading={loading}
            itemLabel={t('common.sessions')}
            onPageChange={(next) => {
              void runSearch(next);
            }}
          />
        </>
      )}

      {!searched && !loading && (
        <div className={styles.unsearched}>
          <EmptyState
            icon={Search}
            title={t('search.unsearchedTitle')}
            description={t('search.unsearchedDesc')}
          />
        </div>
      )}
    </div>
  );
}
