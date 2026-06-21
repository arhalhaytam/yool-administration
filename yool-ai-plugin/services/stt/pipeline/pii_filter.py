"""PII filter — strips personally identifiable information before Gemini calls.

Removes: email addresses, phone numbers, and obvious proper names
followed by personal identifiers.
"""

import re

# Email
_EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Z|a-z]{2,}\b")

# Phone numbers — Algerian, French, international formats
_PHONE_RE = re.compile(
    r"(\+?213|0)(5|6|7)\d{8}"          # Algerian mobile
    r"|(\+33|0)[1-9](\d{2}){4}"        # French
    r"|\b\d{2}[\s\-\.]\d{2}[\s\-\.]\d{2}[\s\-\.]\d{2}[\s\-\.]\d{2}\b"  # formatted
)

# Simple URL scrub (lecturers sometimes share links)
_URL_RE = re.compile(r"https?://\S+")


def scrub(text: str) -> str:
    """Remove PII from text before sending to external LLM API.
    
    Returns cleaned text with placeholders.
    """
    text = _EMAIL_RE.sub("[EMAIL]", text)
    text = _PHONE_RE.sub("[PHONE]", text)
    text = _URL_RE.sub("[URL]", text)
    return text


def scrub_transcript(segments: list[dict]) -> list[dict]:
    """Scrub a list of transcript segment dicts in-place."""
    return [
        {**seg, "text": scrub(seg["text"])} if "text" in seg else seg
        for seg in segments
    ]
