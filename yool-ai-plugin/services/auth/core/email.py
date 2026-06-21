"""
Email sending utility.

All public functions are async and designed to be passed to FastAPI's
BackgroundTasks.  BackgroundTasks run after the HTTP response is delivered
AND after all dependency teardown (including the DB session commit), so
emails are guaranteed to be dispatched only once the transaction is durable.

If SMTP is configured: sends real emails via aiosmtplib (STARTTLS).
If SMTP is not configured: logs the link to stdout (dev/staging fallback).
Never raises — email failures are logged and silently swallowed so they
don't break the auth flow.
"""

from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import aiosmtplib
import structlog

from core.config import settings

log = structlog.get_logger()


async def _send(to: str, subject: str, html: str, text: str) -> None:
    if not settings.smtp_enabled:
        log.warning(
            "smtp.not_configured",
            to=to,
            subject=subject,
            fallback_body=text,
        )
        return

    msg = MIMEMultipart("alternative")
    msg["From"]    = settings.SMTP_FROM
    msg["To"]      = to
    msg["Subject"] = subject
    msg.attach(MIMEText(text, "plain"))
    msg.attach(MIMEText(html, "html"))

    try:
        await aiosmtplib.send(
            msg,
            hostname=settings.SMTP_HOST,
            port=settings.SMTP_PORT,
            username=settings.SMTP_USER,
            password=settings.SMTP_PASSWORD,
            start_tls=settings.SMTP_TLS,
        )
        log.info("email.sent", to=to, subject=subject)
    except Exception as exc:
        log.error("email.send_failed", to=to, subject=subject, error=str(exc))


# ── Public send functions (async — pass directly to BackgroundTasks) ──────────

async def send_password_reset(to: str, reset_url: str) -> None:
    subject = "Reset your Yool AI password"
    text = (
        f"You requested a password reset.\n\n"
        f"Click the link below to set a new password. The link expires in "
        f"{settings.PASSWORD_RESET_EXPIRE_HOURS} hour(s).\n\n"
        f"{reset_url}\n\n"
        f"If you did not request this, ignore this email — your password will not change."
    )
    html = f"""
    <p>You requested a password reset.</p>
    <p>Click the button below to set a new password.
       The link expires in <strong>{settings.PASSWORD_RESET_EXPIRE_HOURS} hour(s)</strong>.</p>
    <p><a href="{reset_url}" style="
        display:inline-block;padding:12px 24px;background:#4F46E5;
        color:#fff;border-radius:6px;text-decoration:none;font-weight:bold;">
        Reset password
    </a></p>
    <p style="color:#6b7280;font-size:13px;">
        If you did not request this, ignore this email — your password will not change.
    </p>
    """
    await _send(to, subject, html, text)


async def send_email_verification(to: str, verify_url: str) -> None:
    subject = "Verify your Yool AI email address"
    text = (
        f"Welcome to Yool AI!\n\n"
        f"Please verify your email address by clicking the link below. "
        f"The link expires in {settings.EMAIL_VERIFY_EXPIRE_HOURS} hours.\n\n"
        f"{verify_url}\n\n"
        f"If you did not create an account, ignore this email."
    )
    html = f"""
    <p>Welcome to <strong>Yool AI</strong>!</p>
    <p>Please verify your email address. 
       The link expires in <strong>{settings.EMAIL_VERIFY_EXPIRE_HOURS} hours</strong>.</p>
    <p><a href="{verify_url}" style="
        display:inline-block;padding:12px 24px;background:#4F46E5;
        color:#fff;border-radius:6px;text-decoration:none;font-weight:bold;">
        Verify email
    </a></p>
    <p style="color:#6b7280;font-size:13px;">
        If you did not create an account, ignore this email.
    </p>
    """
    await _send(to, subject, html, text)


async def send_teacher_invite(to: str, invite_url: str, role: str = "teacher") -> None:
    role_display = role.replace("_", " ").title()
    ttl_hours = settings.TEACHER_INVITE_EXPIRE_HOURS
    subject = f"You've been invited to join Yool AI as a {role_display}"
    text = (
        f"You have been invited to set up your Yool AI {role_display} account.\n\n"
        f"Click the link below to choose your name and password. "
        f"The link expires in {ttl_hours} hours and can only be used once.\n\n"
        f"{invite_url}\n\n"
        f"If you were not expecting this invitation, ignore this email."
    )
    html = f"""
    <p>You have been invited to set up your <strong>Yool AI {role_display}</strong> account.</p>
    <p>Click the button below to choose your name and password.
       The link expires in <strong>{ttl_hours} hours</strong> and can only be used once.</p>
    <p><a href="{invite_url}" style="
        display:inline-block;padding:12px 24px;background:#4F46E5;
        color:#fff;border-radius:6px;text-decoration:none;font-weight:bold;">
        Set up my account
    </a></p>
    <p style="color:#6b7280;font-size:13px;">
        If you were not expecting this invitation, ignore this email.
    </p>
    """
    await _send(to, subject, html, text)
