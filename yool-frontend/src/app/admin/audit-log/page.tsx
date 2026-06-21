"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";

import { api } from "@/lib/api";

import type { AuditLog } from "@/lib/types";

import {
  Search,
  RefreshCw,
  SlidersHorizontal,
  ListFilter,
  ChevronDown,
} from "lucide-react";
import DateTimeField from "@/components/ui/DateTimeField";

import PageHeader from "@/components/ui/PageHeader";

import EmptyState from "@/components/ui/EmptyState";
import { FileText } from "lucide-react";

import Pagination from "@/components/ui/Pagination";

import DropdownSelect, {
  type DropdownGroup,
} from "@/components/ui/DropdownSelect";

import ResponsiveTable, { type TableColumn } from "@/components/ui/ResponsiveTable";

import { LIST_PAGE_SIZE } from "@/lib/pagination";

import FormAlert from "@/components/ui/FormAlert";

import { getErrorMessage } from "@/lib/errors";

import {
  validateDateTimeRange,
} from "@/lib/validation";
import { useLocale } from "@/lib/i18n/LanguageContext";

import styles from "./page.module.css";

const ACTION_OPTIONS = [
  "",
  "user.login",
  "user.logout",
  "user.password_changed",
  "user.profile_updated",

  "user.email_verified",
  "user.session_revoked",
  "user.account_erased",

  "admin.create_user",
  "admin.user_deactivated",
  "admin.user_reactivated",

  "admin.user_role_changed",
  "admin.password_reset",
  "admin.teacher_invite_revoked",

  "session.started",
  "session.ended",
  "session.cancelled",
  "session.updated",

  "course.created",
  "course.updated",
  "course.deleted",
  "course.teacher_reassigned",
];

function actionsForPrefix(prefix: string) {
  return ACTION_OPTIONS.filter((a) => a.startsWith(`${prefix}.`)).map((a) => ({
    value: a,
    label: a,
  }));
}

const ACTION_GROUPS: DropdownGroup[] = [
  { label: "General", options: [{ value: "", label: "All actions" }] },
  { label: "User", options: actionsForPrefix("user") },
  { label: "Admin", options: actionsForPrefix("admin") },
  { label: "Session", options: actionsForPrefix("session") },
  { label: "Course", options: actionsForPrefix("course") },
];

type AuditFilters = {
  action: string;
  since: string;
  until: string;
  userId: string;
};

type AuditUserOption = {
  id: string;
  email: string;
  full_name?: string | null;
};

function actionToneClass(a: string): string {
  if (a.includes("delete") || a.includes("erase") || a.includes("cancel"))
    return styles.actionToneDanger;

  if (a.includes("create") || a.includes("start") || a.includes("accept"))
    return styles.actionToneSuccess;

  if (a.includes("update") || a.includes("reassign") || a.includes("ended"))
    return styles.actionToneWarn;

  return styles.actionToneMuted;
}

function toIsoParam(local: string): string | undefined {
  if (!local) return undefined;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export default function AuditLogPage() {
  const { locale } = useLocale();
  const l = {
    en: {
      title: "Audit Log",
      events: "events",
      refresh: "Refresh",
      panel: "Filter audit events",
      refine: "Refine results",
      active: "active",
      action: "Action",
      user: "User",
      from: "From",
      to: "To",
      allActions: "All actions",
      allUsers: "All users",
      userSearchPlaceholder: "Search by name or email…",
      searchingUsers: "Searching users…",
      noUserResults: "No users found",
      startDate: "Start date & time",
      endDate: "End date & time",
      apply: "Apply filters",
      clear: "Clear",
      timestamp: "Timestamp",
      actor: "Actor",
      resource: "Resource",
      ip: "IP",
      noEvents: "No events",
      noEventsDesc: "No audit events match the current filters.",
      failedLoad: "Failed to load audit log",
    },
    fr: {
      title: "Journal d'audit",
      events: "événements",
      refresh: "Actualiser",
      panel: "Filtrer les événements d'audit",
      refine: "Affiner les résultats",
      active: "actifs",
      action: "Action",
      user: "Utilisateur",
      from: "De",
      to: "À",
      allActions: "Toutes les actions",
      allUsers: "Tous les utilisateurs",
      userSearchPlaceholder: "Rechercher par nom ou e-mail…",
      searchingUsers: "Recherche des utilisateurs…",
      noUserResults: "Aucun utilisateur trouvé",
      startDate: "Date et heure de début",
      endDate: "Date et heure de fin",
      apply: "Appliquer les filtres",
      clear: "Effacer",
      timestamp: "Date",
      actor: "Acteur",
      resource: "Ressource",
      ip: "IP",
      noEvents: "Aucun événement",
      noEventsDesc: "Aucun événement d'audit ne correspond aux filtres actuels.",
      failedLoad: "Échec du chargement du journal d'audit",
    },
    ar: {
      title: "سجل التدقيق",
      events: "أحداث",
      refresh: "تحديث",
      panel: "تصفية أحداث التدقيق",
      refine: "تحسين النتائج",
      active: "نشطة",
      action: "الإجراء",
      user: "المستخدم",
      from: "من",
      to: "إلى",
      allActions: "كل الإجراءات",
      allUsers: "كل المستخدمين",
      userSearchPlaceholder: "ابحث بالاسم أو البريد…",
      searchingUsers: "جارٍ البحث عن المستخدمين…",
      noUserResults: "لم يتم العثور على مستخدمين",
      startDate: "تاريخ ووقت البداية",
      endDate: "تاريخ ووقت النهاية",
      apply: "تطبيق المرشحات",
      clear: "مسح",
      timestamp: "الوقت",
      actor: "الفاعل",
      resource: "المورد",
      ip: "IP",
      noEvents: "لا توجد أحداث",
      noEventsDesc: "لا توجد أحداث تدقيق تطابق المرشحات الحالية.",
      failedLoad: "فشل تحميل سجل التدقيق",
    },
  }[locale];
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [action, setAction] = useState("");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [userId, setUserId] = useState("");
  const [userQuery, setUserQuery] = useState("");
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [userHighlightIndex, setUserHighlightIndex] = useState(-1);
  const [users, setUsers] = useState<AuditUserOption[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [usersLoadError, setUsersLoadError] = useState("");
  const [filterError, setFilterError] = useState("");
  const userPickerRef = useRef<HTMLDivElement | null>(null);
  const userOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const usersFetchSeq = useRef(0);

  const loadPage = useCallback(
    async (pageOffset: number, filters?: AuditFilters) => {
      const f = filters ?? { action, since, until, userId };
      setLoading(true);
      try {
        const page = await api.admin.auditLogs({
          limit: LIST_PAGE_SIZE,
          offset: pageOffset,
          action: f.action || undefined,
          since: toIsoParam(f.since),
          until: toIsoParam(f.until),
          user_id: f.userId.trim() || undefined,
        });
        setLogs(page.items);
        setTotal(page.total);
        setOffset(page.offset);
      } catch (err) {
        setLogs([]);
        setTotal(0);
        setLoadError(getErrorMessage(err, l.failedLoad));
      } finally {
        setLoading(false);
      }
    },
    [action, since, until, userId],
  );

  useEffect(() => {
    loadPage(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial load only
  }, []);

  useEffect(() => {
    if (!userMenuOpen) return;
    const timer = window.setTimeout(async () => {
      const seq = ++usersFetchSeq.current;
      setUsersLoading(true);
      try {
        const page = await api.admin.listUsers({
          search: userQuery.trim() || undefined,
          limit: 20,
          offset: 0,
        });
        if (seq !== usersFetchSeq.current) return;
        setUsers((page.items ?? []).map((u) => ({
          id: u.id,
          email: u.email,
          full_name: u.full_name,
        })));
        setUsersLoadError("");
      } catch (err) {
        if (seq !== usersFetchSeq.current) return;
        setUsers([]);
        setUsersLoadError(getErrorMessage(err, l.failedLoad));
      } finally {
        if (seq === usersFetchSeq.current) setUsersLoading(false);
      }
    }, 220);
    return () => window.clearTimeout(timer);
  }, [userMenuOpen, userQuery, l.failedLoad]);

  useEffect(() => {
    if (!userMenuOpen) return;
    const onDocClick = (evt: MouseEvent) => {
      const target = evt.target as Node;
      if (userPickerRef.current?.contains(target)) return;
      setUserMenuOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [userMenuOpen]);

  function applyFilters() {
    const rangeErr = validateDateTimeRange(since, until);
    if (rangeErr) {
      setFilterError(rangeErr ?? "");
      return;
    }
    setFilterError("");
    loadPage(0);
  }

  function clearFilters() {
    const empty = { action: "", since: "", until: "", userId: "" };
    setFilterError("");
    setAction(empty.action);
    setSince(empty.since);
    setUntil(empty.until);
    setUserId(empty.userId);
    setUserQuery("");
    setUserMenuOpen(false);
    loadPage(0, empty);
  }

  const activeFilterCount = [action, since, until, userId.trim()].filter(
    Boolean,
  ).length;
  const userOptions = useMemo(
    () => users.map((u) => ({
      id: u.id,
      label: u.full_name?.trim() || u.email,
      subtitle: u.email,
    })),
    [users],
  );
  const selectUserOption = useCallback((idx: number) => {
    const u = userOptions[idx];
    if (!u) return;
    setUserId(u.id);
    setUserQuery(`${u.label} (${u.subtitle})`);
    setUserMenuOpen(false);
    setUserHighlightIndex(-1);
  }, [userOptions]);

  useEffect(() => {
    if (!userMenuOpen || userOptions.length === 0) {
      setUserHighlightIndex(-1);
      return;
    }
    setUserHighlightIndex(0);
  }, [userMenuOpen, userOptions]);

  useEffect(() => {
    userOptionRefs.current = userOptionRefs.current.slice(0, userOptions.length);
  }, [userOptions.length]);

  useEffect(() => {
    if (!userMenuOpen || userHighlightIndex < 0) return;
    const optionEl = userOptionRefs.current[userHighlightIndex];
    if (!optionEl) return;
    optionEl.scrollIntoView({ block: "nearest" });
  }, [userHighlightIndex, userMenuOpen, userOptions.length]);

  const columns: TableColumn<AuditLog>[] = useMemo(() => [
    {
      id: "ts",
      header: l.timestamp,
      primary: true,
      cell: log => (
        <span className={styles.timestamp}>
          {new Date(log.created_at).toLocaleString(locale === "fr" ? "fr-DZ" : locale === "ar" ? "ar-DZ" : "en-US", {
            dateStyle: "short",
            timeStyle: "medium",
          })}
        </span>
      ),
    },
    {
      id: "actor",
      header: l.actor,
      hideOnMobile: true,
      cell: log => (
        <span className={styles.actor} title={log.user_id ?? "—"}>
          {log.user_id ? `${log.user_id.slice(0, 8)}…` : "—"}
        </span>
      ),
    },
    {
      id: "action",
      header: l.action,
      cell: log => (
        <code className={`${styles.action} ${actionToneClass(log.action)}`}>
          {log.action}
        </code>
      ),
    },
    {
      id: "resource",
      header: l.resource,
      hideOnMobile: true,
      cell: log => (
        <span className={styles.resource}>
          {log.resource_type}/
          {log.resource_id ? log.resource_id.slice(0, 8) : "—"}
        </span>
      ),
    },
    {
      id: "ip",
      header: l.ip,
      hideOnMobile: true,
      cell: log => <span className={styles.ip}>{log.ip_address ?? "—"}</span>,
    },
  ], [locale, l]);

  return (
    <div>
      <PageHeader
        title={l.title}
        subtitle={
          loading && offset === 0
            ? "…"
            : `${total.toLocaleString()} ${l.events}`
        }
        border
        action={
          <button
            type="button"
            className={styles.refreshBtn}
            onClick={() => loadPage(offset)}
            disabled={loading}
            aria-label={l.refresh}
          >
            <RefreshCw
              size={14}
              className={loading ? styles.spin : undefined}
            />
          </button>
        }
      />

      {loadError && <FormAlert message={loadError} className={styles.pageAlert} />}
      {usersLoadError && <FormAlert message={usersLoadError} className={styles.pageAlert} />}

      <section className={styles.filterPanel} aria-label={l.panel}>
        <div className={styles.filterPanelTop}>
          <div className={styles.filterPanelTitle}>
            <SlidersHorizontal size={15} strokeWidth={2} />
            {l.refine}
          </div>

          {activeFilterCount > 0 && (
            <span className={styles.filterBadge}>
              {activeFilterCount} {l.active}
            </span>
          )}
        </div>

        <div className={styles.filterGrid}>
          <div
            className={[styles.field, action ? styles.fieldFilled : ""].join(
              " ",
            )}
          >
            <label
              id="audit-action-label"
              className={styles.fieldLabel}
              htmlFor="audit-action"
            >
              <span className={styles.fieldLabelDot} aria-hidden />
              {l.action}
            </label>

            <div className={styles.inputShell}>
              <ListFilter size={14} className={styles.fieldIcon} aria-hidden />

              <DropdownSelect
                id="audit-action"
                variant="bare"
                mono
                value={action}
                onChange={setAction}
                groups={ACTION_GROUPS}
                placeholder={l.allActions}
                aria-labelledby="audit-action-label"
              />

              <ChevronDown
                size={14}
                className={`${styles.fieldIcon} ${styles.fieldIconRight}`}
                aria-hidden
              />
            </div>
          </div>

          <div
            className={[
              styles.field,
              userId.trim() ? styles.fieldFilled : "",
            ].join(" ")}
            ref={userPickerRef}
          >
            <label id="audit-user-label" className={styles.fieldLabel} htmlFor="audit-user">
              <span className={styles.fieldLabelDot} aria-hidden />
              {l.user}
            </label>

            <div className={styles.inputShell}>
              <Search size={14} className={styles.fieldIcon} aria-hidden />

              <input
                id="audit-user"
                className={styles.textInput}
                value={userQuery}
                onChange={(e) => {
                  setUserQuery(e.target.value);
                  setUserId("");
                  setUserMenuOpen(true);
                  setUserHighlightIndex(0);
                }}
                onFocus={() => setUserMenuOpen(true)}
                onKeyDown={(e) => {
                  if (!userMenuOpen) {
                    if ((e.key === "ArrowDown" || e.key === "Home") && userOptions.length > 0) {
                      e.preventDefault();
                      setUserMenuOpen(true);
                      setUserHighlightIndex(0);
                    }
                    if ((e.key === "ArrowUp" || e.key === "End") && userOptions.length > 0) {
                      e.preventDefault();
                      setUserMenuOpen(true);
                      setUserHighlightIndex(userOptions.length - 1);
                    }
                    return;
                  }
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    if (userOptions.length > 0) {
                      setUserHighlightIndex((i) =>
                        i < 0 || i >= userOptions.length - 1 ? 0 : i + 1,
                      );
                    }
                    return;
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    if (userOptions.length > 0) {
                      setUserHighlightIndex((i) =>
                        i <= 0 ? userOptions.length - 1 : i - 1,
                      );
                    }
                    return;
                  }
                  if (e.key === "Home") {
                    e.preventDefault();
                    if (userOptions.length > 0) setUserHighlightIndex(0);
                    return;
                  }
                  if (e.key === "End") {
                    e.preventDefault();
                    if (userOptions.length > 0) setUserHighlightIndex(userOptions.length - 1);
                    return;
                  }
                  if (e.key === "Enter") {
                    if (userHighlightIndex >= 0 && userHighlightIndex < userOptions.length) {
                      e.preventDefault();
                      selectUserOption(userHighlightIndex);
                    }
                    return;
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setUserMenuOpen(false);
                    setUserHighlightIndex(-1);
                  }
                }}
                placeholder={l.userSearchPlaceholder}
                autoComplete="off"
                spellCheck={false}
              />
            </div>

            {userMenuOpen && (
              <div className={styles.userMenu}>
                {usersLoading ? (
                  <div className={styles.userHint}>{l.searchingUsers}</div>
                ) : userOptions.length === 0 ? (
                  <div className={styles.userHint}>{l.noUserResults}</div>
                ) : (
                  userOptions.map((u, idx) => (
                    <button
                      key={u.id}
                      type="button"
                      ref={(node) => {
                        userOptionRefs.current[idx] = node;
                      }}
                      className={[
                        styles.userOption,
                        userOptions[userHighlightIndex]?.id === u.id ? styles.userOptionActive : "",
                      ].join(" ")}
                      onMouseEnter={() => setUserHighlightIndex(idx)}
                      onClick={() => selectUserOption(idx)}
                    >
                      <span className={styles.userOptionMain}>{u.label}</span>
                      <span className={styles.userOptionSub}>{u.subtitle}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          <div
            className={[styles.field, since ? styles.fieldFilled : ""].join(
              " ",
            )}
          >
            <label className={styles.fieldLabel} htmlFor="audit-since">
              <span className={styles.fieldLabelDot} aria-hidden />
              {l.from}
            </label>

            <DateTimeField
              id="audit-since"
              value={since}
              onChange={setSince}
              placeholder={l.startDate}
            />
          </div>

          <div
            className={[styles.field, until ? styles.fieldFilled : ""].join(
              " ",
            )}
          >
            <label className={styles.fieldLabel} htmlFor="audit-until">
              <span className={styles.fieldLabelDot} aria-hidden />
              {l.to}
            </label>

            <DateTimeField
              id="audit-until"
              value={until}
              onChange={setUntil}
              placeholder={l.endDate}
              min={since || undefined}
            />
          </div>

          {filterError && (
            <div className={styles.filterErrorWrap}>
              <FormAlert message={filterError} />
            </div>
          )}

          <div className={styles.filterActions}>
            <button
              type="button"
              className={styles.applyBtn}
              onClick={applyFilters}
              disabled={loading}
            >
              {l.apply}
            </button>

            <button
              type="button"
              className={styles.clearBtn}
              onClick={clearFilters}
              disabled={loading}
            >
              {l.clear}
            </button>
          </div>
        </div>
      </section>

      <ResponsiveTable<AuditLog>
        columns={columns}
        data={logs}
        getRowKey={log => log.id}
        loading={loading}
        loadingRows={12}
        emptyState={
          <EmptyState
            icon={FileText}
            title={l.noEvents}
            description={l.noEventsDesc}
          />
        }
      />

      <Pagination
        offset={offset}
        pageSize={LIST_PAGE_SIZE}
        total={total}
        loading={loading}
        itemLabel={l.events}
        onPageChange={(next) => loadPage(next)}
      />
    </div>
  );
}
