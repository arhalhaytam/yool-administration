'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { Level, Matiere } from '@/lib/types';
import { ApiError } from '@/lib/errors';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import PageHeader from '@/components/ui/PageHeader';
import FormAlert from '@/components/ui/FormAlert';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/Confirm';
import { useT } from '@/lib/i18n/LanguageContext';
import { getErrorMessage } from '@/lib/errors';
import {
  Layers,
  BookOpen,
  Plus,
  Pencil,
  Trash2,
  Check,
  X as XIcon,
} from 'lucide-react';
import styles from './page.module.css';

type Kind = 'level' | 'matiere';
type HierarchyItem = { id: string; name: string };

export default function CurriculumPage() {
  const t = useT();
  const { success, error: toastError } = useToast();
  const { confirm } = useConfirm();

  const [levels, setLevels] = useState<Level[]>([]);
  const [matieres, setMatieres] = useState<Matiere[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [levelsData, matieresData] = await Promise.all([
        api.hierarchy.listLevels(),
        api.hierarchy.listMatieres(),
      ]);
      setLevels(levelsData);
      setMatieres(matieresData);
    } catch (err) {
      setLoadError(getErrorMessage(err, t('common.error')));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { loadData(); }, [loadData]);

  // ─── Levels mutations ────────────────────────────────────────────────────
  const handleCreateLevel = async (name: string) => {
    await api.hierarchy.createLevel(name);
    success(t('curriculum.levelCreated'));
    await loadData();
  };
  const handleRenameLevel = async (id: string, name: string) => {
    await api.hierarchy.renameLevel(id, name);
    success(t('curriculum.levelRenamed'));
    await loadData();
  };
  const handleDeleteLevel = async (item: HierarchyItem) => {
    const ok = await confirm(
      t('common.delete'),
      t('curriculum.deleteLevelConfirm'),
      { variant: 'danger', confirmLabel: t('common.delete'), cancelLabel: t('common.cancel') },
    );
    if (!ok) return;
    try {
      await api.hierarchy.deleteLevel(item.id);
      success(t('curriculum.levelDeleted'));
      await loadData();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        toastError(t('curriculum.levelInUse'));
      } else {
        toastError(getErrorMessage(err, t('common.error')));
      }
    }
  };

  // ─── Subjects mutations ──────────────────────────────────────────────────
  const handleCreateMatiere = async (name: string) => {
    await api.hierarchy.createMatiere(name);
    success(t('curriculum.subjectCreated'));
    await loadData();
  };
  const handleRenameMatiere = async (id: string, name: string) => {
    await api.hierarchy.renameMatiere(id, name);
    success(t('curriculum.subjectRenamed'));
    await loadData();
  };
  const handleDeleteMatiere = async (item: HierarchyItem) => {
    const ok = await confirm(
      t('common.delete'),
      t('curriculum.deleteSubjectConfirm'),
      { variant: 'danger', confirmLabel: t('common.delete'), cancelLabel: t('common.cancel') },
    );
    if (!ok) return;
    try {
      await api.hierarchy.deleteMatiere(item.id);
      success(t('curriculum.subjectDeleted'));
      await loadData();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        toastError(t('curriculum.subjectInUse'));
      } else {
        toastError(getErrorMessage(err, t('common.error')));
      }
    }
  };

  return (
    <div className={styles.page}>
      <PageHeader
        title={t('curriculum.title')}
        subtitle={t('curriculum.subtitle')}
        border
      />

      {loadError && <FormAlert message={loadError} className={styles.pageAlert} />}

      <div className={styles.grid}>
        <CurriculumPanel
          kind="level"
          icon={<Layers size={18} strokeWidth={2} />}
          title={t('curriculum.levels')}
          hint={t('curriculum.levelsHint')}
          countLabel={t('curriculum.levelCount')}
          addLabel={t('curriculum.addLevel')}
          inputPlaceholder={t('curriculum.addLevel')}
          renameLabel={t('curriculum.renameLevel')}
          emptyMessage={t('curriculum.noLevels')}
          loading={loading}
          items={levels}
          onCreate={handleCreateLevel}
          onRename={handleRenameLevel}
          onDelete={handleDeleteLevel}
          onCreateError={(msg) => toastError(msg)}
          onRenameError={(msg) => toastError(msg)}
        />

        <CurriculumPanel
          kind="matiere"
          icon={<BookOpen size={18} strokeWidth={2} />}
          title={t('curriculum.subjects')}
          hint={t('curriculum.subjectsHint')}
          countLabel={t('curriculum.subjectCount')}
          addLabel={t('curriculum.addSubject')}
          inputPlaceholder={t('curriculum.addSubject')}
          renameLabel={t('curriculum.renameSubject')}
          emptyMessage={t('curriculum.noSubjects')}
          loading={loading}
          items={matieres}
          onCreate={handleCreateMatiere}
          onRename={handleRenameMatiere}
          onDelete={handleDeleteMatiere}
          onCreateError={(msg) => toastError(msg)}
          onRenameError={(msg) => toastError(msg)}
        />
      </div>
    </div>
  );
}

// ─── Panel ──────────────────────────────────────────────────────────────────

interface CurriculumPanelProps {
  kind: Kind;
  icon: React.ReactNode;
  title: string;
  hint: string;
  countLabel: string;
  addLabel: string;
  inputPlaceholder: string;
  renameLabel: string;
  emptyMessage: string;
  loading: boolean;
  items: HierarchyItem[];
  onCreate: (name: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (item: HierarchyItem) => Promise<void>;
  onCreateError: (msg: string) => void;
  onRenameError: (msg: string) => void;
}

function CurriculumPanel(props: CurriculumPanelProps) {
  const {
    icon, title, hint, countLabel, addLabel, inputPlaceholder,
    renameLabel, emptyMessage, loading, items,
    onCreate, onRename, onDelete, onCreateError, onRenameError,
  } = props;

  const t = useT();
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [editingSaving, setEditingSaving] = useState(false);

  const submitCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setSaving(true);
    try {
      await onCreate(name);
      setNewName('');
    } catch (err) {
      onCreateError(getErrorMessage(err, t('common.error')));
    } finally {
      setSaving(false);
    }
  };

  const beginEdit = (item: HierarchyItem) => {
    setEditingId(item.id);
    setEditingValue(item.name);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingValue('');
  };

  const submitEdit = async (item: HierarchyItem) => {
    const name = editingValue.trim();
    if (!name || name === item.name) {
      cancelEdit();
      return;
    }
    setEditingSaving(true);
    try {
      await onRename(item.id, name);
      setEditingId(null);
      setEditingValue('');
    } catch (err) {
      onRenameError(getErrorMessage(err, t('common.error')));
    } finally {
      setEditingSaving(false);
    }
  };

  return (
    <section className={`${styles.panel} ui-surface`}>
      <header className={styles.panelHead}>
        <span className={styles.headIcon} aria-hidden="true">{icon}</span>
        <div className={styles.headText}>
          <h2 className={styles.headTitle}>{title}</h2>
          <p className={styles.headHint}>{hint}</p>
        </div>
        {!loading && (
          <span className={styles.countChip}>
            {items.length} {countLabel}
          </span>
        )}
      </header>

      <form className={styles.addForm} onSubmit={submitCreate}>
        <Input
          placeholder={inputPlaceholder}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          disabled={saving || loading}
          aria-label={addLabel}
          className={styles.addInput}
        />
        <Button
          type="submit"
          loading={saving}
          disabled={!newName.trim() || loading}
          className={styles.addBtn}
        >
          <Plus size={14} strokeWidth={2.2} /> {t('common.create')}
        </Button>
      </form>

      <div className={styles.divider} />

      <ul className={styles.itemList} role="list">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <li key={i} className={styles.itemRow} aria-hidden="true">
              <span className={`skeleton-line ${styles.skeletonItem}`} />
            </li>
          ))
        ) : items.length === 0 ? (
          <li className={styles.emptyNotice}>{emptyMessage}</li>
        ) : (
          items.map((item) => {
            const isEditing = editingId === item.id;
            return (
              <li
                key={item.id}
                className={`${styles.itemRow} ${isEditing ? styles.itemEditing : ''}`}
              >
                <span className={styles.itemMark} aria-hidden="true" />

                {isEditing ? (
                  <EditField
                    value={editingValue}
                    setValue={setEditingValue}
                    onCancel={cancelEdit}
                    onSubmit={() => submitEdit(item)}
                    saving={editingSaving}
                  />
                ) : (
                  <span className={styles.itemName}>{item.name}</span>
                )}

                {!isEditing && (
                  <div className={styles.itemActions}>
                    <button
                      type="button"
                      className={styles.iconBtn}
                      onClick={() => beginEdit(item)}
                      aria-label={renameLabel}
                      title={renameLabel}
                    >
                      <Pencil size={14} strokeWidth={2} />
                    </button>
                    <button
                      type="button"
                      className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                      onClick={() => onDelete(item)}
                      aria-label={t('common.delete')}
                      title={t('common.delete')}
                    >
                      <Trash2 size={14} strokeWidth={2} />
                    </button>
                  </div>
                )}
              </li>
            );
          })
        )}
      </ul>
    </section>
  );
}

// ─── Inline edit field ──────────────────────────────────────────────────────

interface EditFieldProps {
  value: string;
  setValue: (s: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
  saving: boolean;
}

function EditField({ value, setValue, onCancel, onSubmit, saving }: EditFieldProps) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <span className={styles.editFieldWrap}>
      <input
        ref={inputRef}
        className={styles.editInput}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onSubmit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        disabled={saving}
        aria-label={t('common.rename')}
      />
      <button
        type="button"
        className={`${styles.iconBtn} ${styles.iconBtnConfirm}`}
        onClick={onSubmit}
        disabled={saving || !value.trim()}
        aria-label={t('common.save')}
        title={t('common.save')}
      >
        <Check size={14} strokeWidth={2.2} />
      </button>
      <button
        type="button"
        className={styles.iconBtn}
        onClick={onCancel}
        disabled={saving}
        aria-label={t('common.cancel')}
        title={t('common.cancel')}
      >
        <XIcon size={14} strokeWidth={2.2} />
      </button>
    </span>
  );
}
