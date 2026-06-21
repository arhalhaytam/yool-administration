"""Admin router — user management, teacher invite management, and audit log access."""

import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal

import structlog
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.dependencies import get_current_user, require_role
from core.email import send_teacher_invite
from core.security import hash_password
from core.tasks import purge_expired_tokens
from core.utils import (
    hash_token as _hash_token,
    validate_password as _validate_password,
    write_audit_log as _audit,
)
from schemas.user import UserCreate, UserOut
from shared.database import get_session
from shared.models import (
    AuditLog, RefreshToken, TeacherInvite, User, UserRole,
)

log = structlog.get_logger()
router = APIRouter()


# ── Schemas ────────────────────────────────────────────────────────────────────

class AdminUserOut(BaseModel):
    model_config = {"from_attributes": True}
    id: uuid.UUID
    email: str          # plain str — GDPR-erased accounts use @anonymized.invalid
    full_name: str
    role: str
    is_active: bool
    is_verified: bool
    is_deleted: bool
    created_at: datetime


class AdminUserPatch(BaseModel):
    """Fields an admin can update on any user account."""
    is_active: bool | None = None
    role: UserRole | None = None
    full_name: str | None = Field(default=None, min_length=2, max_length=200, strip_whitespace=True)


class AdminPasswordReset(BaseModel):
    new_password: str = Field(min_length=8, max_length=128)


class AuditLogOut(BaseModel):
    model_config = {"from_attributes": True}
    id: uuid.UUID
    user_id: uuid.UUID | None
    action: str
    resource_type: str
    resource_id: str | None
    ip_address: str | None
    user_agent: str | None
    created_at: datetime


class AuditLogListPage(BaseModel):
    items: list[AuditLogOut]
    total: int
    limit: int
    offset: int
    has_more: bool


class UserListPage(BaseModel):
    items: list[AdminUserOut]
    total: int
    limit: int
    offset: int
    has_more: bool


class UserRoleSummary(BaseModel):
    total: int
    teachers: int
    admins: int
    pending_invites: int


def _visible_users_base(admin: User):
    """Base query with admin visibility rules applied."""
    q = select(User)
    if admin.role == UserRole.ADMIN:
        q = q.where(User.role != UserRole.SUPER_ADMIN)
    return q


def _apply_user_list_filters(
    q,
    *,
    role: UserRole | None,
    role_group: Literal["teacher", "admin"] | None,
    is_active: bool | None,
    search: str | None,
):
    if role_group == "teacher":
        q = q.where(User.role == UserRole.TEACHER)
    elif role_group == "admin":
        q = q.where(User.role.in_([UserRole.ADMIN, UserRole.SUPER_ADMIN]))
    elif role is not None:
        q = q.where(User.role == role)
    if is_active is not None:
        q = q.where(User.is_active == is_active)
    if search:
        escaped = search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{escaped}%"
        q = q.where(
            or_(
                User.email.ilike(pattern, escape="\\"),
                User.full_name.ilike(pattern, escape="\\"),
            )
        )
    return q


# ── User management ────────────────────────────────────────────────────────────

@router.get("/users/summary", response_model=UserRoleSummary)
async def users_role_summary(
    db: Annotated[AsyncSession, Depends(get_session)],
    admin: Annotated[User, Depends(require_role(UserRole.ADMIN, UserRole.SUPER_ADMIN))],
):
    """Counts for admin user-management tabs."""
    async def _count(extra_filters=None):
        q = select(func.count(User.id))
        if admin.role == UserRole.ADMIN:
            q = q.where(User.role != UserRole.SUPER_ADMIN)
        if extra_filters:
            for clause in extra_filters:
                q = q.where(clause)
        return int((await db.execute(q)).scalar() or 0)

    total = await _count()
    teachers = await _count([User.role == UserRole.TEACHER])
    admins = await _count([User.role.in_([UserRole.ADMIN, UserRole.SUPER_ADMIN])])

    now = datetime.now(timezone.utc)
    inv_q = select(func.count(TeacherInvite.id)).where(
        TeacherInvite.used_at.is_(None),
        TeacherInvite.expires_at > now,
    )
    pending_invites = int((await db.execute(inv_q)).scalar() or 0)

    return UserRoleSummary(
        total=total,
        teachers=teachers,
        admins=admins,
        pending_invites=pending_invites,
    )


@router.get("/users", response_model=UserListPage)
async def list_users(
    db: Annotated[AsyncSession, Depends(get_session)],
    admin: Annotated[User, Depends(require_role(UserRole.ADMIN, UserRole.SUPER_ADMIN))],
    role: UserRole | None = Query(default=None, description="Filter by exact role"),
    role_group: Literal["teacher", "admin"] | None = Query(
        default=None, description="Filter teachers or admin+super_admin group"
    ),
    is_active: bool | None = Query(default=None, description="Filter by active status"),
    search: str | None = Query(default=None, description="Search by email or name"),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
):
    """
    Paginated user list with optional filters.
    - SUPER_ADMIN sees all roles including other super_admins.
    - ADMIN sees all roles except super_admins.
    """
    count_q = select(func.count(User.id))
    if admin.role == UserRole.ADMIN:
        count_q = count_q.where(User.role != UserRole.SUPER_ADMIN)
    count_q = _apply_user_list_filters(
        count_q,
        role=role,
        role_group=role_group,
        is_active=is_active,
        search=search,
    )
    total = int((await db.execute(count_q)).scalar() or 0)

    items_q = _apply_user_list_filters(
        _visible_users_base(admin),
        role=role,
        role_group=role_group,
        is_active=is_active,
        search=search,
    )
    items_q = items_q.order_by(User.created_at.desc()).limit(limit).offset(offset)
    result = await db.execute(items_q)
    items = [AdminUserOut.model_validate(u) for u in result.scalars().all()]

    return UserListPage(
        items=items,
        total=total,
        limit=limit,
        offset=offset,
        has_more=offset + len(items) < total,
    )


@router.get("/users/{user_id}", response_model=AdminUserOut)
async def get_user(
    user_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_session)],
    admin: Annotated[User, Depends(require_role(UserRole.ADMIN, UserRole.SUPER_ADMIN))],
):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    # Admins cannot inspect super_admin accounts
    if admin.role == UserRole.ADMIN and user.role == UserRole.SUPER_ADMIN:
        raise HTTPException(403, "Insufficient permissions")
    return AdminUserOut.model_validate(user)


@router.patch("/users/{user_id}", response_model=AdminUserOut)
async def update_user(
    user_id: uuid.UUID,
    body: AdminUserPatch,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_session)],
    admin: Annotated[User, Depends(require_role(UserRole.ADMIN, UserRole.SUPER_ADMIN))],
):
    """
    Update a user's active status, role, or name.

    Privilege rules:
    - Managing a super_admin or admin account → SUPER_ADMIN only
    - Managing a teacher or student account  → ADMIN or SUPER_ADMIN
    - Cannot deactivate self
    - Cannot deactivate the last super_admin
    """
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    if user.is_deleted:
        raise HTTPException(409, "Cannot modify an erased account")
    if user.id == admin.id:
        raise HTTPException(409, "You cannot modify your own account via admin")

    # Only SUPER_ADMIN can touch admin/super_admin accounts
    if user.role in (UserRole.ADMIN, UserRole.SUPER_ADMIN) and admin.role != UserRole.SUPER_ADMIN:
        raise HTTPException(403, "Only a super_admin can modify admin accounts")

    if body.is_active is not None:
        # Protect: cannot deactivate the last super_admin
        if not body.is_active and user.role == UserRole.SUPER_ADMIN:
            count = await db.execute(
                select(func.count()).where(
                    User.role == UserRole.SUPER_ADMIN,
                    User.is_active == True,
                    User.is_deleted == False,
                )
            )
            if (count.scalar() or 0) <= 1:
                raise HTTPException(409, "Cannot deactivate the last active super_admin")

        user.is_active = body.is_active
        if not body.is_active:
            rts = await db.execute(
                select(RefreshToken).where(
                    RefreshToken.user_id == user.id,
                    RefreshToken.revoked == False,
                )
            )
            for rt in rts.scalars().all():
                rt.revoked = True
            # Issue 2: deactivation must appear in audit log
            _audit(db, admin.id, "admin.user_deactivated", "user", str(user_id), request)
            log.info("admin.user_deactivated", target_id=str(user_id), by=str(admin.id))
        else:
            _audit(db, admin.id, "admin.user_reactivated", "user", str(user_id), request)
            log.info("admin.user_reactivated", target_id=str(user_id), by=str(admin.id))

    if body.role is not None:
        # Granting admin/super_admin role requires SUPER_ADMIN
        if body.role in (UserRole.ADMIN, UserRole.SUPER_ADMIN) and admin.role != UserRole.SUPER_ADMIN:
            raise HTTPException(403, "Only a super_admin can grant admin or super_admin roles")
        old_role = user.role.value
        user.role = body.role
        # Issue 5: audit every role change
        _audit(db, admin.id, "admin.user_role_changed", "user", str(user_id), request)
        log.info("admin.user_role_changed", target_id=str(user_id),
                 old_role=old_role, new_role=body.role.value, by=str(admin.id))

    if body.full_name is not None:
        user.full_name = body.full_name
        # Issue 5: audit name changes too
        _audit(db, admin.id, "admin.user_name_changed", "user", str(user_id), request)

    return AdminUserOut.model_validate(user)


@router.post("/users/{user_id}/reset-password", status_code=status.HTTP_204_NO_CONTENT)
async def admin_reset_password(
    user_id: uuid.UUID,
    body: AdminPasswordReset,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_session)],
    admin: Annotated[User, Depends(require_role(UserRole.ADMIN, UserRole.SUPER_ADMIN))],
):
    """
    Admin-initiated password reset — no email needed.
    Resetting an admin/super_admin password requires SUPER_ADMIN.
    """
    user = await db.get(User, user_id)
    if not user or user.is_deleted:
        raise HTTPException(404, "User not found")

    # Only SUPER_ADMIN can reset another admin's password
    if user.role in (UserRole.ADMIN, UserRole.SUPER_ADMIN) and admin.role != UserRole.SUPER_ADMIN:
        raise HTTPException(403, "Only a super_admin can reset an admin's password")

    _validate_password(body.new_password)
    user.password_hash = hash_password(body.new_password)

    rts = await db.execute(
        select(RefreshToken).where(
            RefreshToken.user_id == user.id,
            RefreshToken.revoked == False,
        )
    )
    for rt in rts.scalars().all():
        rt.revoked = True

    _audit(db, admin.id, "admin.password_reset", "user", str(user_id), request)
    log.info("admin.password_reset", target_id=str(user_id), by=str(admin.id))


# ── Create accounts ────────────────────────────────────────────────────────────

@router.post("/users", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def admin_create_user(
    body: UserCreate,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_session)],
    caller: Annotated[User, Depends(require_role(UserRole.ADMIN, UserRole.SUPER_ADMIN))],
):
    """
    Create a teacher / admin / super_admin account directly.

    The schema-level UserRole rejects 'student' with 422 — the enterprise
    pivot removed students from the system.

    Privilege rules:
    - SUPER_ADMIN → can create any role (super_admin, admin, teacher)
    - ADMIN       → can only create teachers
    """
    target_role = UserRole(body.role.value)

    if caller.role == UserRole.ADMIN and target_role in (UserRole.ADMIN, UserRole.SUPER_ADMIN):
        raise HTTPException(403, "Only a super_admin can create admin or super_admin accounts")

    existing = await db.execute(select(User).where(User.email == body.email.lower()))
    if existing.scalar_one_or_none():
        raise HTTPException(409, "Email already registered")

    user = User(
        id=uuid.uuid4(),
        email=body.email.lower(),
        password_hash=hash_password(body.password),
        full_name=body.full_name,
        role=target_role,
        is_verified=True,
    )
    db.add(user)
    _audit(db, caller.id, "admin.create_user", "user", str(user.id), request)
    try:
        await db.flush()
    except IntegrityError:
        raise HTTPException(409, "Email already registered")
    log.info("admin.user_created", user_id=str(user.id), role=user.role, by=str(caller.id))
    return UserOut.model_validate(user)


# ── Audit logs ─────────────────────────────────────────────────────────────────

async def _audit_log_filters(
    db: AsyncSession,
    admin: User,
    *,
    user_id: uuid.UUID | None,
    action: str | None,
    since: datetime | None,
    until: datetime | None,
) -> list:
    """Shared WHERE clauses for audit log list + count."""
    clauses = []

    if admin.role == UserRole.ADMIN:
        super_admin_ids = await db.execute(
            select(User.id).where(User.role == UserRole.SUPER_ADMIN)
        )
        excluded = [row[0] for row in super_admin_ids.all()]
        if excluded:
            clauses.append(AuditLog.user_id.not_in(excluded))

    if user_id:
        clauses.append(AuditLog.user_id == user_id)
    if action:
        clauses.append(AuditLog.action == action)
    if since:
        clauses.append(AuditLog.created_at >= since)
    if until:
        clauses.append(AuditLog.created_at <= until)

    return clauses


@router.get("/audit-logs", response_model=AuditLogListPage)
async def list_audit_logs(
    db: Annotated[AsyncSession, Depends(get_session)],
    admin: Annotated[User, Depends(require_role(UserRole.ADMIN, UserRole.SUPER_ADMIN))],
    user_id: uuid.UUID | None = Query(default=None),
    action: str | None = Query(default=None),
    since: datetime | None = Query(default=None),
    until: datetime | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    """
    Paginated, filterable audit log. Supports filtering by user, action, and time range.
    Results are ordered newest-first.
    """
    filters = await _audit_log_filters(
        db, admin, user_id=user_id, action=action, since=since, until=until,
    )

    count_q = select(func.count(AuditLog.id))
    for clause in filters:
        count_q = count_q.where(clause)
    total = int((await db.execute(count_q)).scalar() or 0)

    items_q = select(AuditLog)
    for clause in filters:
        items_q = items_q.where(clause)
    items_q = items_q.order_by(AuditLog.created_at.desc()).limit(limit).offset(offset)
    result = await db.execute(items_q)
    items = [AuditLogOut.model_validate(a) for a in result.scalars().all()]

    return AuditLogListPage(
        items=items,
        total=total,
        limit=limit,
        offset=offset,
        has_more=offset + len(items) < total,
    )


# ── Token cleanup (housekeeping) ──────────────────────────────────────────────

@router.delete("/cleanup-tokens", status_code=status.HTTP_200_OK)
async def cleanup_expired_tokens(
    admin: Annotated[User, Depends(require_role(UserRole.ADMIN, UserRole.SUPER_ADMIN))],
):
    """
    On-demand trigger for the same cleanup that runs automatically every
    TOKEN_CLEANUP_INTERVAL_HOURS hours.  Useful for immediate housekeeping
    or testing without waiting for the next scheduled run.

    Returns counts of deleted rows per table.
    """
    counts = await purge_expired_tokens()
    log.info("admin.token_cleanup.manual", by=str(admin.id), **counts)
    return counts


# ── Teacher / Admin invite management ─────────────────────────────────────────

TEACHER_INVITE_EXPIRE_HOURS = settings.TEACHER_INVITE_EXPIRE_HOURS


class TeacherInviteCreate(BaseModel):
    email: EmailStr
    role: UserRole = UserRole.TEACHER   # Default teacher; SUPER_ADMIN can set admin


class TeacherInviteOut(BaseModel):
    id: uuid.UUID
    email: str
    role: str
    expires_at: datetime
    used_at: datetime | None
    is_pending: bool
    invite_url: str   # Raw token embedded on creation; placeholder on list


class TeacherInviteListPage(BaseModel):
    items: list[TeacherInviteOut]
    total: int
    limit: int
    offset: int
    has_more: bool


@router.post(
    "/teacher-invites",
    response_model=TeacherInviteOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_teacher_invite(
    body: TeacherInviteCreate,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_session)],
    admin: Annotated[User, Depends(require_role(UserRole.ADMIN, UserRole.SUPER_ADMIN))],
):
    """
    Generate a single-use, email-locked invite for a teacher (or admin).

    Privilege rules:
    - ADMIN can only invite teachers
    - SUPER_ADMIN can invite teachers or admins

    The raw invite_url is returned ONCE and also sent via email if SMTP is configured.
    Admin can copy the URL and share via any channel (WhatsApp, LMS, etc.).
    """
    target_role = body.role

    # Admins cannot create admin invites
    if admin.role == UserRole.ADMIN and target_role in (UserRole.ADMIN, UserRole.SUPER_ADMIN):
        raise HTTPException(403, "Only a super_admin can invite admin accounts")

    # Prevent duplicate pending invites for same email
    now = datetime.now(timezone.utc)
    existing = await db.execute(
        select(TeacherInvite).where(
            TeacherInvite.email == str(body.email).lower(),
            TeacherInvite.used_at == None,
            TeacherInvite.expires_at > now,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            409,
            f"A pending invite for {body.email} already exists. Revoke it first or wait for expiry.",
        )

    # Check an account with this email doesn't already exist
    user_check = await db.execute(
        select(User).where(User.email == str(body.email).lower())
    )
    if user_check.scalar_one_or_none():
        raise HTTPException(409, f"An account with {body.email} already exists")

    raw_token = secrets.token_urlsafe(32)
    token_hash = _hash_token(raw_token)
    expires_at = now + timedelta(hours=TEACHER_INVITE_EXPIRE_HOURS)

    invite = TeacherInvite(
        id=uuid.uuid4(),
        token_hash=token_hash,
        email=str(body.email).lower(),
        role=target_role,
        created_by=admin.id,
        expires_at=expires_at,
    )
    db.add(invite)
    await db.flush()

    invite_url = f"{settings.invite_base_url}/setup-account?token={raw_token}"

    background_tasks.add_task(send_teacher_invite, str(body.email), invite_url, target_role.value)
    log.info(
        "teacher_invite.created",
        invite_id=str(invite.id),
        email=body.email,
        role=target_role,
        by=str(admin.id),
        invite_base=settings.invite_base_url,
    )

    return TeacherInviteOut(
        id=invite.id,
        email=invite.email,
        role=invite.role.value,
        expires_at=invite.expires_at,
        used_at=invite.used_at,
        is_pending=True,
        invite_url=invite_url,   # ← Shown ONCE — admin copies this
    )


@router.get("/teacher-invites", response_model=TeacherInviteListPage)
async def list_teacher_invites(
    db: Annotated[AsyncSession, Depends(get_session)],
    admin: Annotated[User, Depends(require_role(UserRole.ADMIN, UserRole.SUPER_ADMIN))],
    pending_only: bool = Query(default=False, description="Only show unused, non-expired invites"),
    search: str | None = Query(default=None, description="Filter invites by email"),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
):
    """Paginated teacher/admin invites. Token not shown — only metadata."""
    now = datetime.now(timezone.utc)

    def _apply_invite_filters(q):
        if pending_only:
            q = q.where(TeacherInvite.used_at.is_(None), TeacherInvite.expires_at > now)
        if search:
            escaped = search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            q = q.where(TeacherInvite.email.ilike(f"%{escaped}%", escape="\\"))
        return q

    count_q = _apply_invite_filters(select(func.count(TeacherInvite.id)))
    total = int((await db.execute(count_q)).scalar() or 0)

    items_q = _apply_invite_filters(select(TeacherInvite))
    items_q = items_q.order_by(TeacherInvite.created_at.desc()).limit(limit).offset(offset)
    result = await db.execute(items_q)
    invites = list(result.scalars().all())
    items = [
        TeacherInviteOut(
            id=inv.id,
            email=inv.email,
            role=inv.role.value,
            expires_at=inv.expires_at,
            used_at=inv.used_at,
            is_pending=inv.is_pending,
            invite_url="<token not shown after creation>",
        )
        for inv in invites
    ]

    return TeacherInviteListPage(
        items=items,
        total=total,
        limit=limit,
        offset=offset,
        has_more=offset + len(items) < total,
    )


@router.delete(
    "/teacher-invites/{invite_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def revoke_teacher_invite(
    invite_id: uuid.UUID,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_session)],
    admin: Annotated[User, Depends(require_role(UserRole.ADMIN, UserRole.SUPER_ADMIN))],
):
    """Revoke a pending invite before the teacher uses it."""
    result = await db.execute(
        select(TeacherInvite).where(TeacherInvite.id == invite_id)
    )
    invite = result.scalar_one_or_none()
    if not invite:
        raise HTTPException(404, "Invite not found")
    if invite.used_at:
        raise HTTPException(409, "Invite already accepted — cannot revoke")

    invite.expires_at = datetime.now(timezone.utc)
    _audit(db, admin.id, "admin.teacher_invite_revoked", "teacher_invite", str(invite_id), request)
    log.info("teacher_invite.revoked", invite_id=str(invite_id), by=str(admin.id))
