import Link from 'next/link';

export default function NotFound() {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg)', padding: '24px', textAlign: 'center',
    }}>
      <p style={{ fontSize: 72, fontWeight: 700, color: 'var(--border-2)', letterSpacing: '-0.05em', lineHeight: 1 }}>
        404
      </p>
      <h1 style={{ fontSize: 18, fontWeight: 600, marginTop: 16, marginBottom: 8 }}>
        Page not found
      </h1>
      <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 24 }}>
        This page doesn't exist or you don't have access to it.
      </p>
      <Link href="/" style={{
        height: 36, padding: '0 18px', background: 'var(--accent)',
        color: '#fff', borderRadius: 8, display: 'inline-flex',
        alignItems: 'center', fontSize: 13, fontWeight: 500,
      }}>
        Go home
      </Link>
    </div>
  );
}
