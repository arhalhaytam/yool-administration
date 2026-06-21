"""Token response schemas."""

from pydantic import BaseModel


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int  # seconds; always set explicitly at the call site from settings
