"""Auth request/response schemas.

Note: the STUDENT role was removed from the schema layer in the enterprise
pivot. New accounts can only have role super_admin, admin, or teacher.
"""

import uuid
from datetime import datetime
from enum import Enum

from pydantic import BaseModel, EmailStr, Field, field_validator


class UserRole(str, Enum):
    SUPER_ADMIN = "super_admin"
    ADMIN       = "admin"
    TEACHER     = "teacher"


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: str = Field(min_length=2, max_length=255, strip_whitespace=True)
    role: UserRole

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if not any(c.isupper() for c in v):
            raise ValueError("Password must contain at least one uppercase letter")
        if not any(c.isdigit() for c in v):
            raise ValueError("Password must contain at least one digit")
        return v


class UserOut(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    email: str          # str not EmailStr — anonymized emails fail EmailStr validation
    full_name: str
    role: str
    is_active: bool
    is_verified: bool
    created_at: datetime
