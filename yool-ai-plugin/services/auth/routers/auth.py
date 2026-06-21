"""Auth router — login, refresh, logout, password reset, email verification,
self-service account management, teacher onboarding invite acceptance.

Student registration and class-link invites were removed in the enterprise
pivot — only admins can create accounts now (via teacher-invite or direct
admin creation). See `services/auth/routers/admin.py`.
"""

import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

import structlog
from fastapi import APIRouter, BackgroundTasks, Cookie, Depends, HTTPException, Query, Request, Response, status
from jose import JWTError
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.dependencies import blocklist_jti, get_current_user
from core.email import send_email_verification, send_password_reset
from core.rate_limit import (
    check_forgot_password_rate_limit,
    check_invite_token_rate_limit,  # still used: /teacher-invites/preview + /teacher-invites/accept
    check_login_rate_limit,
    check_resend_verification_rate_limit,
    check_reset_password_rate_limit,
    check_verify_email_rate_limit,
)
from core.security import (
    create_access_token,
    create_refresh_token,
    decode_access_token,
    hash_password,
    hash_refresh_token,
    verify_password,
)
from core.utils import (
    get_client_ip as _get_ip,
    get_user_agent as _get_ua,
    hash_token as _hash_token,
    validate_password as _validate_password,
    write_audit_log as _audit,
)
from schemas.token import TokenResponse
from schemas.user import UserOut
from shared.database import get_session
from shared.models import (
    EmailVerificationToken, PasswordResetToken, RefreshToken,
    TeacherInvite, User, UserRole,
)

log = structlog.get_logger()
router = APIRouter()

_MAX_SESSIONS: int = settings.MAX_SESSIONS_PER_USER


# ── Health ─────────────────────────────────────────────────────────────────────

@router.get("/health", include_in_schema=False)
async def health():
    return {"status": "ok", "service": "auth"}


# Dummy hash for constant-time login (prevents user-enumeration via timing)
_DUMMY_HASH = hash_password("dummy-constant-value-never-matches-real-pw-xK7!")


# ── Schemas ────────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class PasswordChangeRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str     = Field(min_length=8, max_length=128)


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str       = Field(min_length=10, max_length=200)
    new_password: str = Field(min_length=8,  max_length=128)


class ActiveSessionOut(BaseModel):
    id: uuid.UUID
    ip_address: str | None
    user_agent: str | None
    created_at: datetime
    last_used_at: datetime | None
    expires_at: datetime


# ── Email verification ─────────────────────────────────────────────────────────

@router.post("/verify-email", status_code=status.HTTP_204_NO_CONTENT)
async def verify_email(
    token: Annotated[str, Query(min_length=10, max_length=200)],
    request: Request,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: None = Depends(check_verify_email_rate_limit),
):
    """Consume an email verification token and mark the account as verified."""
    token_hash = _hash_token(token)
    now = datetime.now(timezone.utc)

    result = await db.execute(
        select(EmailVerificationToken).where(
            EmailVerificationToken.token_hash == token_hash,
            EmailVerificationToken.expires_at > now,
        )
    )
    evt = result.scalar_one_or_none()
    if not evt:
        raise HTTPException(410, "Verification link is invalid or has expired")

    user = await db.get(User, evt.user_id)
    if not user or user.is_deleted:
        raise HTTPException(404, "User not found")
    if user.is_verified:
        raise HTTPException(409, "Email already verified")

    user.is_verified = True
    await db.delete(evt)   # one-time use

    _audit(db, user.id, "user.email_verified", "user", str(user.id), request)
    log.info("user.email_verified", user_id=str(user.id))


@router.post("/resend-verification", status_code=status.HTTP_204_NO_CONTENT)
async def resend_verification(
    request: Request,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(get_current_user)],
    _: None = Depends(check_resend_verification_rate_limit),
):
    """Re-send the email verification link. Invalidates the previous token."""
    if user.is_verified:
        raise HTTPException(409, "Email is already verified")

    now = datetime.now(timezone.utc)

    # Invalidate existing tokens for this user
    result = await db.execute(
        select(EmailVerificationToken).where(EmailVerificationToken.user_id == user.id)
    )
    for old in result.scalars().all():
        await db.delete(old)

    raw_verify = secrets.token_urlsafe(32)
    db.add(EmailVerificationToken(
        id=uuid.uuid4(),
        user_id=user.id,
        token_hash=_hash_token(raw_verify),
        expires_at=now + timedelta(hours=settings.EMAIL_VERIFY_EXPIRE_HOURS),
    ))

    verify_url = f"{settings.FRONTEND_URL}/verify-email?token={raw_verify}"
    background_tasks.add_task(send_email_verification, user.email, verify_url)
    log.info("user.verification_resent", user_id=str(user.id))


# ── Login ──────────────────────────────────────────────────────────────────────

@router.post("/login", response_model=TokenResponse)
async def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_session)],
):
    result = await db.execute(
        select(User).where(
            User.email == body.email.lower(),
            User.is_active == True,
            User.is_deleted == False,
        )
    )
    user = result.scalar_one_or_none()

    # Constant-time check prevents user enumeration via response timing
    hash_to_check = user.password_hash if user else _DUMMY_HASH
    password_ok = verify_password(body.password, hash_to_check)
    if not user or not password_ok:
        # Only count FAILED attempts — successful logins must not burn the rate limit
        await check_login_rate_limit(request)
        log.warning("login.failed", email=body.email[:3] + "***")
        raise HTTPException(401, "Invalid credentials")

    access_token = create_access_token(user.id, user.role.value)
    raw_refresh, refresh_hash = create_refresh_token()
    expires = datetime.now(timezone.utc) + timedelta(days=settings.JWT_REFRESH_EXPIRE_DAYS)
    now_ts = datetime.now(timezone.utc)

    # ── FIFO session cap ──────────────────────────────────────────────────────
    # Evict oldest sessions (FIFO) once the per-user cap is reached.
    active_q = await db.execute(
        select(RefreshToken)
        .where(
            RefreshToken.user_id == user.id,
            RefreshToken.revoked == False,
            RefreshToken.expires_at > now_ts,
        )
        .order_by(RefreshToken.created_at.asc())   # oldest first
    )
    active_sessions = active_q.scalars().all()
    overflow = len(active_sessions) - (_MAX_SESSIONS - 1)  # -1: space for new session
    if overflow > 0:
        for old in active_sessions[:overflow]:
            old.revoked = True
            log.info(
                "session.evicted_by_cap",
                evicted_session_id=str(old.id),
                user_id=str(user.id),
            )

    db.add(RefreshToken(
        user_id=user.id,
        token_hash=refresh_hash,
        expires_at=expires,
        ip_address=_get_ip(request),
        user_agent=_get_ua(request),
        last_used_at=now_ts,
    ))
    _audit(db, user.id, "user.login", "user", str(user.id), request)

    response.set_cookie(
        key="refresh_token", value=raw_refresh,
        httponly=True, secure=True, samesite="strict",
        max_age=settings.JWT_REFRESH_EXPIRE_DAYS * 24 * 3600,
        path="/api/auth/refresh",
    )
    log.info("user.login", user_id=str(user.id))
    return TokenResponse(
        access_token=access_token,
        expires_in=settings.JWT_ACCESS_EXPIRE_MINUTES * 60,
    )


# ── Refresh ────────────────────────────────────────────────────────────────────

@router.post("/refresh", response_model=TokenResponse)
async def refresh(
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_session)],
    refresh_token: Annotated[str | None, Cookie()] = None,
):
    if not refresh_token:
        raise HTTPException(401, "Missing refresh token")

    token_hash = hash_refresh_token(refresh_token)
    result = await db.execute(
        select(RefreshToken).where(
            RefreshToken.token_hash == token_hash,
            RefreshToken.revoked == False,
            RefreshToken.expires_at > datetime.now(timezone.utc),
        )
    )
    stored = result.scalar_one_or_none()
    if not stored:
        raise HTTPException(401, "Invalid or expired refresh token")

    user_result = await db.execute(select(User).where(User.id == stored.user_id))
    user = user_result.scalar_one()
    if not user.is_active or user.is_deleted:
        stored.revoked = True
        raise HTTPException(401, "Account is disabled")

    # Rotate: revoke old token, issue new one
    stored.revoked = True
    raw_new, hash_new = create_refresh_token()
    expires = datetime.now(timezone.utc) + timedelta(days=settings.JWT_REFRESH_EXPIRE_DAYS)
    db.add(RefreshToken(
        user_id=stored.user_id,
        token_hash=hash_new,
        expires_at=expires,
        ip_address=_get_ip(request),
        user_agent=_get_ua(request),
        last_used_at=datetime.now(timezone.utc),
    ))

    access_token = create_access_token(user.id, user.role.value)

    response.set_cookie(
        key="refresh_token", value=raw_new,
        httponly=True, secure=True, samesite="strict",
        max_age=settings.JWT_REFRESH_EXPIRE_DAYS * 24 * 3600, path="/api/auth/refresh",
    )
    return TokenResponse(
        access_token=access_token,
        expires_in=settings.JWT_ACCESS_EXPIRE_MINUTES * 60,
    )


# ── Logout ─────────────────────────────────────────────────────────────────────

@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_session)],
    refresh_token: Annotated[str | None, Cookie()] = None,
):
    """Revokes the refresh token and blocklists the current access token."""
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        raw_jwt = auth_header[7:]
        try:
            payload = decode_access_token(raw_jwt)
            jti = payload.get("jti")
            exp = payload.get("exp")
            if jti and exp:
                remaining = int(exp - datetime.now(timezone.utc).timestamp())
                if remaining > 0:
                    await blocklist_jti(jti, remaining)
        except (JWTError, Exception):
            pass

    if refresh_token:
        token_hash = hash_refresh_token(refresh_token)
        result = await db.execute(
            select(RefreshToken).where(RefreshToken.token_hash == token_hash)
        )
        stored = result.scalar_one_or_none()
        if stored:
            stored.revoked = True
            _audit(db, stored.user_id, "user.logout", "user", str(stored.user_id), request)
            log.info("user.logout", user_id=str(stored.user_id))

    response.delete_cookie("refresh_token", path="/api/auth/refresh")


# ── Forgot / Reset password ────────────────────────────────────────────────────

@router.post("/forgot-password", status_code=status.HTTP_204_NO_CONTENT)
async def forgot_password(
    body: ForgotPasswordRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: None = Depends(check_forgot_password_rate_limit),
):
    """Always returns 204 — prevents email enumeration."""
    result = await db.execute(
        select(User).where(
            User.email == body.email.lower(),
            User.is_active == True,
            User.is_deleted == False,
        )
    )
    user = result.scalar_one_or_none()

    if user:
        existing = await db.execute(
            select(PasswordResetToken).where(
                PasswordResetToken.user_id == user.id,
                PasswordResetToken.used_at == None,
            )
        )
        for old in existing.scalars().all():
            old.used_at = datetime.now(timezone.utc)

        raw_token = secrets.token_urlsafe(32)
        expires = datetime.now(timezone.utc) + timedelta(
            hours=settings.PASSWORD_RESET_EXPIRE_HOURS
        )
        db.add(PasswordResetToken(
            id=uuid.uuid4(),
            user_id=user.id,
            token_hash=_hash_token(raw_token),
            requested_from_ip=_get_ip(request),
            expires_at=expires,
        ))
        _audit(db, user.id, "user.password_reset_requested", "user", str(user.id), request)

        reset_url = f"{settings.FRONTEND_URL}/reset-password?token={raw_token}"
        background_tasks.add_task(send_password_reset, user.email, reset_url)
        log.info("password_reset.requested", user_id=str(user.id))


@router.post("/reset-password", status_code=status.HTTP_204_NO_CONTENT)
async def reset_password(
    body: ResetPasswordRequest,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: None = Depends(check_reset_password_rate_limit),
):
    """Consume a reset token and set a new password. Revokes all active sessions."""
    token_hash = _hash_token(body.token)
    now = datetime.now(timezone.utc)

    result = await db.execute(
        select(PasswordResetToken).where(
            PasswordResetToken.token_hash == token_hash,
            PasswordResetToken.used_at == None,
            PasswordResetToken.expires_at > now,
        )
    )
    prt = result.scalar_one_or_none()
    if not prt:
        raise HTTPException(410, "Reset link is invalid or has expired")

    user = await db.get(User, prt.user_id)
    if not user or user.is_deleted:
        raise HTTPException(404, "User not found")

    _validate_password(body.new_password)

    user.password_hash = hash_password(body.new_password)
    prt.used_at = now

    rts = await db.execute(
        select(RefreshToken).where(
            RefreshToken.user_id == user.id, RefreshToken.revoked == False
        )
    )
    for rt in rts.scalars().all():
        rt.revoked = True

    _audit(db, user.id, "user.password_reset_completed", "user", str(user.id), request)
    log.info("password_reset.completed", user_id=str(user.id))


# ── Me ────────────────────────────────────────────────────────────────────────

@router.get("/me", response_model=UserOut)
async def me(user: Annotated[User, Depends(get_current_user)]):
    return UserOut.model_validate(user)


class ProfileUpdate(BaseModel):
    full_name: str = Field(min_length=2, max_length=200, strip_whitespace=True)


@router.patch("/me", response_model=UserOut)
async def update_me(
    body: ProfileUpdate,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(get_current_user)],
):
    """Users update their own profile information (currently: full_name)."""
    user.full_name = body.full_name
    _audit(db, user.id, "user.profile_updated", "user", str(user.id), request)
    log.info("user.profile_updated", user_id=str(user.id))
    return UserOut.model_validate(user)


# ── Change password ────────────────────────────────────────────────────────────

@router.put("/users/me/password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(
    body: PasswordChangeRequest,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(get_current_user)],
):
    """Requires current password. Revokes all sessions and blocklists current JWT."""
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(400, "Current password is incorrect")
    _validate_password(body.new_password)

    user.password_hash = hash_password(body.new_password)

    rts = await db.execute(
        select(RefreshToken).where(
            RefreshToken.user_id == user.id, RefreshToken.revoked == False
        )
    )
    for rt in rts.scalars().all():
        rt.revoked = True

    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        try:
            payload = decode_access_token(auth_header[7:])
            jti = payload.get("jti")
            exp = payload.get("exp")
            if jti and exp:
                remaining = int(exp - datetime.now(timezone.utc).timestamp())
                if remaining > 0:
                    await blocklist_jti(jti, remaining)
        except Exception:
            pass

    _audit(db, user.id, "user.password_changed", "user", str(user.id), request)
    log.info("user.password_changed", user_id=str(user.id))


# ── GDPR Right to Erasure ──────────────────────────────────────────────────────

@router.delete("/users/me", status_code=status.HTTP_204_NO_CONTENT)
async def delete_account(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(get_current_user)],
):
    if user.role == UserRole.SUPER_ADMIN:
        count_result = await db.execute(
            select(func.count()).where(
                User.role == UserRole.SUPER_ADMIN,
                User.is_active == True,
                User.is_deleted == False,
            )
        )
        if (count_result.scalar() or 0) <= 1:
            raise HTTPException(
                409,
                "Cannot erase the last active super_admin account. "
                "Promote another user to super_admin first.",
            )

    anon_id = _hash_token(str(user.id))[:16]
    user.email = f"deleted_{anon_id}@anonymized.invalid"
    user.full_name = "Deleted User"
    user.password_hash = "DELETED"
    user.is_active = False
    user.is_deleted = True
    user.deleted_at = datetime.now(timezone.utc)

    rts = await db.execute(
        select(RefreshToken).where(
            RefreshToken.user_id == user.id, RefreshToken.revoked == False
        )
    )
    for rt in rts.scalars().all():
        rt.revoked = True

    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        try:
            payload = decode_access_token(auth_header[7:])
            jti = payload.get("jti")
            exp = payload.get("exp")
            if jti and exp:
                remaining = int(exp - datetime.now(timezone.utc).timestamp())
                if remaining > 0:
                    await blocklist_jti(jti, remaining)
        except Exception:
            pass

    _audit(db, user.id, "user.account_erased", "user", str(user.id), request)
    log.info("gdpr.erasure", user_id=str(user.id))


# ── Active sessions (device list) ─────────────────────────────────────────────

@router.get("/sessions", response_model=list[ActiveSessionOut])
async def list_active_sessions(
    db: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(get_current_user)],
):
    """List all active refresh token sessions (devices). Used for account security page."""
    result = await db.execute(
        select(RefreshToken).where(
            RefreshToken.user_id == user.id,
            RefreshToken.revoked == False,
            RefreshToken.expires_at > datetime.now(timezone.utc),
        ).order_by(RefreshToken.last_used_at.desc())
    )
    return [
        ActiveSessionOut(
            id=rt.id,
            ip_address=rt.ip_address,
            user_agent=rt.user_agent,
            created_at=rt.created_at,
            last_used_at=rt.last_used_at,
            expires_at=rt.expires_at,
        )
        for rt in result.scalars().all()
    ]


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_session(
    session_id: uuid.UUID,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(get_current_user)],
):
    """Revoke a specific device session (sign out a single device)."""
    result = await db.execute(
        select(RefreshToken).where(
            RefreshToken.id == session_id,
            RefreshToken.user_id == user.id,
        )
    )
    rt = result.scalar_one_or_none()
    if not rt:
        raise HTTPException(404, "Session not found")
    if rt.revoked:
        raise HTTPException(409, "Session already revoked")
    rt.revoked = True
    _audit(db, user.id, "user.session_revoked", "session", str(session_id), request)
    log.info("session.revoked", session_id=str(session_id), user_id=str(user.id))


# ── Teacher onboarding invite (public — preview + accept) ─────────────────────

class AcceptTeacherInvite(BaseModel):
    """Payload sent when a teacher or admin clicks their onboarding invite link."""
    token:     str = Field(min_length=10)
    full_name: str = Field(min_length=2, max_length=200, strip_whitespace=True)
    password:  str = Field(min_length=8, max_length=128)


class TeacherInvitePreview(BaseModel):
    """Returned by GET /teacher-invites/preview so the frontend can pre-fill the email field."""
    email: str
    role: str
    expires_at: datetime


@router.get("/teacher-invites/preview", response_model=TeacherInvitePreview)
async def preview_teacher_invite(
    token: Annotated[str, Query(min_length=10, max_length=200)],
    request: Request,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: None = Depends(check_invite_token_rate_limit),
):
    """Pre-fill the email and show the role on the signup page. Does NOT consume the token."""
    token_hash = _hash_token(token)
    now = datetime.now(timezone.utc)

    result = await db.execute(
        select(TeacherInvite).where(TeacherInvite.token_hash == token_hash)
    )
    invite = result.scalar_one_or_none()

    if not invite:
        raise HTTPException(404, "Invite not found or invalid")
    if invite.used_at:
        raise HTTPException(409, "This invite has already been accepted")
    if invite.expires_at < now:
        raise HTTPException(410, "This invite has expired")

    return TeacherInvitePreview(
        email=invite.email,
        role=invite.role.value,
        expires_at=invite.expires_at,
    )


@router.post(
    "/teacher-invites/accept",
    response_model=UserOut,
    status_code=status.HTTP_201_CREATED,
)
async def accept_teacher_invite(
    body: AcceptTeacherInvite,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: None = Depends(check_invite_token_rate_limit),
):
    """Teacher or admin accepts their onboarding invite and creates their account."""
    token_hash = _hash_token(body.token)
    now = datetime.now(timezone.utc)

    result = await db.execute(
        select(TeacherInvite)
        .where(TeacherInvite.token_hash == token_hash)
        .with_for_update()
    )
    invite = result.scalar_one_or_none()

    if not invite:
        raise HTTPException(404, "Invite not found or invalid")
    if invite.used_at:
        raise HTTPException(409, "This invite has already been accepted")
    if invite.expires_at < now:
        raise HTTPException(410, "This invite has expired")

    _validate_password(body.password)

    existing = await db.execute(select(User).where(User.email == invite.email))
    if existing.scalar_one_or_none():
        raise HTTPException(409, "An account with this email already exists")

    user = User(
        id=uuid.uuid4(),
        email=invite.email,
        password_hash=hash_password(body.password),
        full_name=body.full_name,
        role=invite.role,
        is_active=True,
        is_verified=True,
    )
    db.add(user)

    invite.used_at = now
    invite.used_by = user.id

    try:
        await db.flush()
    except IntegrityError:
        raise HTTPException(409, "An account with this email already exists")

    _audit(db, None, "user.teacher_invite_accepted", "user", str(user.id), request)
    log.info(
        "teacher_invite.accepted",
        user_id=str(user.id),
        role=user.role.value,
        invite_id=str(invite.id),
    )
    return UserOut.model_validate(user)
