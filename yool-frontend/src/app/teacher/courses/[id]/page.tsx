'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { api } from '@/lib/api';
import type { Course, Chapter, Session } from '@/lib/types';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import { FileText } from 'lucide-react';
import FormAlert from '@/components/ui/FormAlert';
import { getErrorMessage } from '@/lib/errors';
import { useLocale, useT } from '@/lib/i18n/LanguageContext';
import { useApiErrors } from '@/lib/i18n/useApiErrors';
import { useToast } from '@/components/ui/Toast';
import Modal from '@/components/ui/Modal';
import Input from '@/components/ui/Input';
import { Mic } from 'lucide-react';
import styles from './page.module.css';

type BadgeVariant = 'success' | 'warning' | 'danger' | 'default' | 'accent';

function StatusBadge({ status }: { status: Session['status'] }) {
  const t = useT();
  const map: Record<string, { v: BadgeVariant; sKey: string; dot?: boolean }> = {
    done:       { v: 'success', sKey: 'session.status.done'       },
    processing: { v: 'warning', sKey: 'session.status.processing' },
    live:       { v: 'danger',  sKey: 'session.status.live', dot: true },
    failed:     { v: 'default', sKey: 'session.status.failed'     },
    created:    { v: 'accent',  sKey: 'session.status.created'    },
  };
  const cfg = map[status] ?? map.created;
  return <Badge variant={cfg.v} dot={!!cfg.dot} pulse={!!cfg.dot}>{t(cfg.sKey)}</Badge>;
}

export default function TeacherCoursePage() {
  const params = useParams();
  const courseId = params?.id as string;
  const router = useRouter();
  const t = useT();
  const { locale } = useLocale();
  const apiErrors = useApiErrors();
  const { success, error: toastError } = useToast();

  const [course, setCourse] = useState<Course | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [showChapterModal, setShowChapterModal] = useState(false);
  const [newChapterTitle, setNewChapterTitle] = useState('');
  const [savingChapter, setSavingChapter] = useState(false);
  
  const [startingSessionId, setStartingSessionId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [courseData, chaptersData] = await Promise.all([
        api.courses.get(courseId),
        api.chapters.list(courseId)
      ]);
      setCourse(courseData);
      setChapters(chaptersData ?? []);
      
      // Load all sessions for this course at once
      const page = await api.sessions.list({ course_id: courseId, limit: 200 });
      setSessions(page.items ?? []);
      setLoadError('');
    } catch (err) {
      setLoadError(getErrorMessage(err, t('common.error'), apiErrors));
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    if (courseId) {
      loadData();
    }
  }, [loadData, courseId]);

  async function handleCreateChapter(e: React.FormEvent) {
    e.preventDefault();
    if (!newChapterTitle.trim()) return;
    setSavingChapter(true);
    try {
      await api.chapters.create({
        course_id: courseId,
        title: newChapterTitle.trim()
      });
      success(t('course.chapters'));
      setNewChapterTitle('');
      setShowChapterModal(false);
      await loadData();
    } catch (err) {
      toastError(getErrorMessage(err, t('common.error'), apiErrors));
    } finally {
      setSavingChapter(false);
    }
  }

  async function handleStartSession(chapterId: string) {
    setStartingSessionId(chapterId);
    try {
      const session = await api.sessions.start(chapterId);
      router.push(`/teacher/record/${session.id}`);
    } catch (err) {
      setStartingSessionId(null);
      toastError(getErrorMessage(err, t('common.error'), apiErrors));
    }
  }

  if (loading && !course) {
    return <div className={styles.loadingWrap}>{t('common.loading')}</div>;
  }

  if (!course) {
    return <FormAlert message={loadError || t('common.error')} />;
  }

  const courseTitle = `${course.matiere?.name || t('course.subject')} - ${course.level?.name || t('course.level')}`;

  return (
    <div>
      <PageHeader
        title={courseTitle}
        subtitle={t('course.chapters')}
        border
        action={
          <Button onClick={() => setShowChapterModal(true)}>+ {t('course.newChapter')}</Button>
        }
      />

      {loadError && <FormAlert message={loadError} className={styles.pageAlert} />}

      {chapters.length === 0 ? (
        <div className={styles.emptyWrap}>
          <EmptyState
            icon={FileText}
            title={t('course.noChapters')}
            description={t('session.noSessionsDesc')}
            action={<Button onClick={() => setShowChapterModal(true)}>+ {t('course.newChapter')}</Button>}
          />
        </div>
      ) : (
        <div className={styles.chapterList}>
          {chapters.map(chapter => {
            const chapterSessions = sessions.filter(s => s.chapter_id === chapter.id);
            
            return (
              <div key={chapter.id} className={`${styles.chapterCard} ui-surface`}>
                <div className={styles.chapterHeader}>
                  <h2 className={styles.chapterTitle}>{chapter.title}</h2>
                  <Button 
                    size="sm" 
                    onClick={() => handleStartSession(chapter.id)}
                    loading={startingSessionId === chapter.id}
                    disabled={!!startingSessionId}
                  >
                    <Mic size={14} className={styles.micIcon} /> {t('record.start')}
                  </Button>
                </div>
                
                {chapterSessions.length > 0 ? (
                  <div className={styles.sessionList}>
                    {chapterSessions.map(session => (
                      <div key={session.id} className={styles.sessionRow}>
                        <div className={styles.sessionInfo}>
                          <span className={styles.sessionTitle}>{session.title}</span>
                          <span className={styles.sessionDate}>
                            {new Date(session.created_at).toLocaleDateString(
                              locale === 'fr' ? 'fr-DZ' : locale === 'ar' ? 'ar-DZ' : 'en-US',
                            )}
                          </span>
                        </div>
                        <div className={styles.sessionActions}>
                          <StatusBadge status={session.status} />
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => router.push(`/teacher/sessions/${session.id}`)}
                          >
                            {t('common.actions')}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className={styles.noSessionsText}>{t('session.noSessions')}</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Modal
        isOpen={showChapterModal}
        onClose={() => setShowChapterModal(false)}
        title={t('course.newChapter')}
        size="sm"
      >
        <form onSubmit={handleCreateChapter} className={styles.chapterForm}>
          <Input
            label={t('course.newChapter')}
            placeholder="e.g. Limites et Continuité"
            value={newChapterTitle}
            onChange={e => setNewChapterTitle(e.target.value)}
            autoFocus
          />
          <div className={styles.chapterFormActions}>
            <Button type="button" variant="ghost" onClick={() => setShowChapterModal(false)}>{t('common.cancel')}</Button>
            <Button type="submit" loading={savingChapter} disabled={!newChapterTitle.trim()}>{t('common.confirm')}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
