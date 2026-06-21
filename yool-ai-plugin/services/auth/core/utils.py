"""Shared auth utilities used by multiple routers.

Everything here is pure utility — no route logic, no business rules.
Keeping these in core/ prevents sibling-router imports (routers importing
from each other is a dependency smell that breaks refactoring).
"""

import hashlib
import uuid

from fastapi import HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models import AuditLog


# ── Token hashing ─────────────────────────────────────────────────────────────

def hash_token(raw: str) -> str:
    """SHA-256 hex digest of a raw token string.

    Never store raw tokens in the database — always hash first.
    Comparing hashes is safe even if the DB is compromised.
    """
    return hashlib.sha256(raw.encode()).hexdigest()


# ── Request metadata ──────────────────────────────────────────────────────────

def get_client_ip(request: Request) -> str | None:
    """Extract real client IP, honouring the X-Real-IP header set by nginx."""
    return request.headers.get("X-Real-IP") or (
        request.client.host if request.client else None
    )


def get_user_agent(request: Request) -> str | None:
    return request.headers.get("User-Agent")


# ── Audit logging ─────────────────────────────────────────────────────────────

def write_audit_log(
    db: AsyncSession,
    user_id: uuid.UUID | None,
    action: str,
    resource_type: str,
    resource_id: str | None,
    request: Request,
) -> None:
    """Append an audit entry to the current DB session (not yet committed).

    The caller is responsible for committing the session.  Writing inside the
    same transaction as the mutating operation guarantees atomicity — if the
    mutation rolls back, so does the audit entry.

    Args:
        db:            The active async session.
        user_id:       Actor (None for unauthenticated actions like registration).
        action:        Dot-namespaced event string, e.g. "user.login".
        resource_type: Entity type affected, e.g. "user", "session".
        resource_id:   String representation of the entity's primary key.
        request:       FastAPI Request — used to extract IP and User-Agent.
    """
    db.add(AuditLog(
        user_id=user_id,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        ip_address=get_client_ip(request),
        user_agent=get_user_agent(request),
    ))


# ── Password validation ───────────────────────────────────────────────────────

def validate_password(password: str) -> None:
    """Enforce password complexity rules.

    Rules (applied in order of user-friendliness):
        1. Min 8 chars  — brute-force protection
        2. Max 128 chars — bcrypt truncates at 72 bytes; cap prevents DoS
        3. ≥1 uppercase — prevents trivially guessable lower-only passwords
        4. ≥1 digit     — increases effective keyspace

    Raises HTTPException 422 on any violation so FastAPI returns a
    consistent Unprocessable Entity response alongside Pydantic errors.
    """
    if len(password) < 8:
        raise HTTPException(422, "Password must be at least 8 characters")
    if len(password) > 128:
        raise HTTPException(422, "Password must be at most 128 characters")
    if not any(c.isupper() for c in password):
        raise HTTPException(422, "Password must contain at least one uppercase letter")
    if not any(c.isdigit() for c in password):
        raise HTTPException(422, "Password must contain at least one digit")
