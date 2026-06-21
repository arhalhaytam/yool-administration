'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, BookOpen } from 'lucide-react';
import { api } from '@/lib/api';
import type { Course } from '@/lib/types';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import FormAlert from '@/components/ui/FormAlert';
import { getErrorMessage } from '@/lib/errors';
import { useLocale, useT } from '@/lib/i18n/LanguageContext';
import { useApiErrors } from '@/lib/i18n/useApiErrors';
import styles from './list.module.css';

function toDisplayCase(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return trimmed
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

export default function TeacherCoursesListPage() {
  const t = useT();
  const { locale, isRTL } = useLocale();
  const apiErrors = useApiErrors();
  const router = useRouter();

  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading]   = useState(true);
  const [loadError, setLoadError] = useState('');

  const l = {
    en: {
      title:       'My Courses',
      subtitle:    'All courses assigned to you',
      startFirst:  'Start first session',
    },
    fr: {
      title:       'Mes cours',
      subtitle:    'Tous les cours qui vous sont assignés',
      startFirst:  'Démarrer la première séance',
    },
    ar: {
      title:       'دروسي',
      subtitle:    'جميع المواد المسندة إليك',
      startFirst:  'ابدأ أول جلسة',
    },
  }[locale];

  useEffect(() => {
    api.courses.list({ assigned_to_me: true, limit: 200 })
      .then(p => setCourses(p.items))
      .catch(err => setLoadError(getErrorMessage(err, t('common.error'), apiErrors)))
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <PageHeader title={l.title} subtitle={l.subtitle} border />

      {loadError && <FormAlert message={loadError} className={styles.pageAlert} />}

      {loading ? (
        <div className={styles.grid}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={`${styles.skeletonCard} ${styles[`skDly${i}`]}`}>
              <span className={`skeleton-line ${styles.s1}`} />
              <span className={`skeleton-line ${styles.s2}`} />
              <span className={`skeleton-line ${styles.s3}`} />
              <span className={`skeleton-line ${styles.s4}`} />
            </div>
          ))}
        </div>
      ) : courses.length === 0 ? (
        <div className={styles.emptyWrap}>
          <EmptyState
            icon={BookOpen}
            title={t('course.noCourses')}
            description={t('session.noSessionsDesc')}
          />
        </div>
      ) : (
        <div className={styles.grid}>
          {courses.map((course, i) => {
            const n = course.session_count ?? 0;
            const dly = Math.min(i, 10);
            const isEmpty = n === 0;
            const addedOn = new Date(course.created_at).toLocaleDateString(
              locale === 'fr' ? 'fr-DZ' : locale === 'ar' ? 'ar-DZ' : 'en-US',
              { dateStyle: 'medium' },
            );
            const courseTitle = `${course.matiere?.name || t('course.subject')} - ${course.level?.name || t('course.level')}`;

            return (
              <article
                key={course.id}
                className={[styles.card, styles[`cardDly${dly}`], isEmpty ? styles.cardEmpty : ''].join(' ')}
              >
                <div className={styles.cardHeader}>
                  <h3 className={styles.courseTitle}>{toDisplayCase(courseTitle)}</h3>
                  <span className={styles.badgeWrap}>
                    <Badge variant="accent">{(course.official_language || 'fr').toUpperCase()}</Badge>
                  </span>
                </div>

                <div className={styles.cardBody}>
                  <div className={styles.metaRow}>
                    <span className={styles.metaLabel}>{t('session.title')}</span>
                    <span className={styles.metaValue}>
                      {isEmpty
                        ? <span className={styles.noSessionsHint}>{l.startFirst}</span>
                        : `${n} ${t('common.sessions')}`}
                    </span>
                  </div>
                  <div className={styles.metaRow}>
                    <span className={styles.metaLabel}>{t('session.recordedAt')}</span>
                    <span className={styles.metaValue}>{addedOn}</span>
                  </div>
                </div>

                <div className={styles.cardFooter}>
                  <Button
                    variant={isEmpty ? 'outline' : 'primary'}
                    size="sm"
                    fullWidth
                    onClick={() => router.push(`/teacher/courses/${course.id}`)}
                  >
                    <span>{t('course.chapters')}</span>
                    {isRTL
                      ? <span className={styles.arrowRtl}><ArrowRight size={14} strokeWidth={2.2} /></span>
                      : <ArrowRight size={14} strokeWidth={2.2} />}
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
