"""User model — supports Super-Admin, Admin, and Teacher roles.

The STUDENT enum value is preserved for legacy database rows (the migration
soft-deletes existing student accounts) but is blocked at the schema layer:
no new account can be created with role='student'.
"""

import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class UserRole(str, enum.Enum):
    SUPER_ADMIN = "super_admin"
    ADMIN       = "admin"
    TEACHER     = "teacher"
    STUDENT     = "student"   # deprecated: kept only for historical rows


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    email: Mapped[str] = mapped_column(
        String(255), unique=True, nullable=False, index=True
    )
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(
        Enum(
            UserRole,
            name="user_role",
            values_callable=lambda x: [e.value for e in x],  # store 'super_admin', not 'SUPER_ADMIN'
            create_type=False,   # type is managed by Alembic migrations
            native_enum=False,   # prevents SQLAlchemy 2.x from binding enum .name instead of .value
        ),
        nullable=False,
        default=UserRole.TEACHER,
    )

    is_active: Mapped[bool]   = mapped_column(Boolean, default=True,  nullable=False)
    is_deleted: Mapped[bool]  = mapped_column(Boolean, default=False, nullable=False)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Set when user exercises GDPR right to erasure — data anonymized, row kept for audit
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # Relationships
    refresh_tokens: Mapped[list["RefreshToken"]] = relationship(  # noqa: F821
        back_populates="user", cascade="all, delete-orphan"
    )
    audit_logs: Mapped[list["AuditLog"]] = relationship(  # noqa: F821
        back_populates="user"
    )
    courses_taught: Mapped[list["Course"]] = relationship(  # noqa: F821
        back_populates="teacher", foreign_keys="Course.teacher_id"
    )

    def __repr__(self) -> str:
        return f"<User {self.email} [{self.role}]>"
