"""Export all models so Alembic can auto-detect them."""

from .base import Base
from .audit import AuditLog, RefreshToken
from .auth_tokens import EmailVerificationToken, PasswordResetToken
from .chapter import Chapter
from .course import Course
from .level import Level
from .matiere import Matiere
from .session import Session, SessionStatus
from .summary import Summary
from .teacher_invite import TeacherInvite
from .transcript import SpeakerRole, Transcript
from .user import User, UserRole

__all__ = [
    "Base",
    "User", "UserRole",
    "Course",
    "Level",
    "Matiere",
    "Chapter",
    "Session", "SessionStatus",
    "Transcript", "SpeakerRole",
    "Summary",
    "AuditLog", "RefreshToken",
    "PasswordResetToken", "EmailVerificationToken",
    "TeacherInvite",
]
