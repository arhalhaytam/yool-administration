"""Shared utilities for the session service.

All functions here are pure utilities — no route logic, no business rules.
Keeping these in core/ prevents sibling-router imports.
"""

import uuid

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models import AuditLog


# ── Request metadata ──────────────────────────────────────────────────────────

def get_client_ip(request: Request) -> str | None:
    """Real client IP, honouring the X-Real-IP header set by nginx."""
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
    """
    db.add(AuditLog(
        user_id=user_id,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        ip_address=get_client_ip(request),
        user_agent=get_user_agent(request),
    ))
