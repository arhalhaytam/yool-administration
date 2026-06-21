/** Client-side validation before API calls (mirrors common backend rules). */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateRequired(value: string, label: string): string | null {
  if (!value.trim()) return `${label} is required`;
  return null;
}

export function validateEmail(email: string): string | null {
  const v = email.trim();
  if (!v) return 'Email is required';
  if (!EMAIL_RE.test(v)) return 'Enter a valid email address';
  return null;
}

export function validatePassword(password: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters';
  if (!/[A-Z]/.test(password)) return 'Password must include an uppercase letter';
  if (!/[0-9]/.test(password)) return 'Password must include a number';
  return null;
}

export function validatePasswordMatch(password: string, confirm: string): string | null {
  if (password !== confirm) return 'Passwords do not match';
  return null;
}

export function validateUuid(value: string, label = 'User ID'): string | null {
  const v = value.trim();
  if (!v) return null;
  if (!UUID_RE.test(v)) return `${label} must be a valid UUID`;
  return null;
}

export function validateDateTimeRange(since: string, until: string): string | null {
  if (since && until && since > until) {
    return '"From" must be before or equal to "To"';
  }
  return null;
}

export type FieldErrors = Record<string, string>;

export function firstFieldError(errors: FieldErrors): string | null {
  const keys = Object.keys(errors);
  if (keys.length === 0) return null;
  return errors[keys[0]] ?? null;
}
