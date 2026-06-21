import type { Summary } from './types';

/**
 * Generates a styled HTML document from a session summary and opens the
 * browser print dialog. The user can print to PDF from there.
 *
 * This approach requires zero extra dependencies — no jsPDF, no docx —
 * and produces a properly paginated, printable document that looks
 * professional in both screen and print media.
 */
export function exportSessionAsPDF(summary: Summary, sessionId?: string): void {
  const o = summary.content;
  const topics = o.topics ?? [];

  const topicsHtml = topics.map((t: any, i: number) => `
    <div class="topic">
      <div class="topic-header">
        <span class="topic-number">${String(i + 1).padStart(2, '0')}</span>
        <div class="topic-meta">
          <span class="topic-time">${t.start_time} – ${t.end_time}</span>
          <h3 class="topic-title">${escHtml(t.title)}</h3>
        </div>
      </div>
      <p class="topic-desc">${escHtml(t.description)}</p>
      ${t.key_concepts?.length ? `
        <div class="concepts">
          ${t.key_concepts.map((c: string) => `<span class="concept">${escHtml(c)}</span>`).join('')}
        </div>` : ''}
    </div>
  `).join('');

  const recordedAt = o.recorded_at
    ? new Date(o.recorded_at).toLocaleString('fr-DZ', { dateStyle: 'long', timeStyle: 'short' })
    : 'Unknown';

  const html = `<!DOCTYPE html>
<html lang="${o.language ?? 'fr'}">
<head>
  <meta charset="UTF-8" />
  <title>${escHtml(o.session_title)} — Topic Outline</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      font-size: 13px;
      line-height: 1.6;
      color: #1a1a2e;
      background: #fff;
      padding: 0;
    }

    /* ── Cover page ─────────────────────────────────────────────── */
    .cover {
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding: 72px 64px 48px;
      page-break-after: always;
      border-left: 6px solid #4f6ef7;
    }
    .cover-top {}
    .cover-badge {
      display: inline-block;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: #4f6ef7;
      border: 1px solid #4f6ef7;
      padding: 4px 12px;
      border-radius: 100px;
      margin-bottom: 40px;
    }
    .cover h1 {
      font-size: 36px;
      font-weight: 700;
      color: #0d1526;
      line-height: 1.2;
      margin-bottom: 12px;
    }
    .cover-subtitle {
      font-size: 16px;
      color: #555;
      margin-bottom: 48px;
    }
    .cover-meta {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px 32px;
      border-top: 1px solid #e5e7eb;
      padding-top: 32px;
      margin-top: 32px;
    }
    .cover-meta-item { display: flex; flex-direction: column; gap: 4px; }
    .cover-meta-label {
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: #9aa5b4;
    }
    .cover-meta-value { font-size: 14px; color: #1a1a2e; font-weight: 500; }
    .cover-footer {
      font-size: 11px;
      color: #aaa;
      border-top: 1px solid #f0f0f0;
      padding-top: 16px;
    }

    /* ── Content page ───────────────────────────────────────────── */
    .content { padding: 56px 64px; }
    .section-heading {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: #4f6ef7;
      margin-bottom: 28px;
      padding-bottom: 12px;
      border-bottom: 2px solid #eef0ff;
    }

    /* ── Topic card ─────────────────────────────────────────────── */
    .topic {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 20px 24px;
      margin-bottom: 16px;
      border: 1px solid #e9ecf0;
      border-left: 3px solid #4f6ef7;
      border-radius: 8px;
      break-inside: avoid;
    }
    .topic-header { display: flex; align-items: flex-start; gap: 16px; }
    .topic-number {
      font-size: 12px;
      font-weight: 700;
      color: #4f6ef7;
      font-variant-numeric: tabular-nums;
      min-width: 24px;
      padding-top: 2px;
      opacity: 0.6;
    }
    .topic-meta { flex: 1; }
    .topic-time {
      display: block;
      font-family: 'Courier New', monospace;
      font-size: 11px;
      color: #4f6ef7;
      letter-spacing: 0.04em;
      margin-bottom: 4px;
    }
    .topic-title {
      font-size: 15px;
      font-weight: 600;
      color: #0d1526;
      line-height: 1.3;
    }
    .topic-desc {
      font-size: 13px;
      color: #4b5563;
      line-height: 1.65;
      margin-left: 40px;
    }
    .concepts {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-left: 40px;
    }
    .concept {
      font-size: 11px;
      font-weight: 500;
      color: #4f6ef7;
      background: #eef0ff;
      border: 1px solid #c7d0ff;
      border-radius: 100px;
      padding: 2px 10px;
    }

    /* ── Print ──────────────────────────────────────────────────── */
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .cover { min-height: 100vh; }
      @page { margin: 0; size: A4; }
    }
  </style>
</head>
<body>

  <div class="cover">
    <div class="cover-top">
      <span class="cover-badge">Session Coverage Report</span>
      <h1>${escHtml(o.session_title)}</h1>
      <p class="cover-subtitle">${escHtml(o.course_title)}</p>

      <div class="cover-meta">
        <div class="cover-meta-item">
          <span class="cover-meta-label">Teacher</span>
          <span class="cover-meta-value">${escHtml(o.teacher_name)}</span>
        </div>
        <div class="cover-meta-item">
          <span class="cover-meta-label">Date</span>
          <span class="cover-meta-value">${recordedAt}</span>
        </div>
        <div class="cover-meta-item">
          <span class="cover-meta-label">Duration</span>
          <span class="cover-meta-value">${o.duration_minutes} minutes</span>
        </div>
        <div class="cover-meta-item">
          <span class="cover-meta-label">Language</span>
          <span class="cover-meta-value">${(o.language ?? '').toUpperCase()}</span>
        </div>
        <div class="cover-meta-item">
          <span class="cover-meta-label">Topics covered</span>
          <span class="cover-meta-value">${topics.length}</span>
        </div>
        ${sessionId ? `
        <div class="cover-meta-item">
          <span class="cover-meta-label">Session ID</span>
          <span class="cover-meta-value" style="font-size:11px;font-family:monospace">${sessionId}</span>
        </div>` : ''}
      </div>
    </div>
    <p class="cover-footer">Generated by Yool AI · ${new Date().toLocaleString('fr-DZ', { dateStyle: 'medium', timeStyle: 'short' })}</p>
  </div>

  <div class="content">
    <p class="section-heading">Chronological Topic Outline</p>
    ${topics.length === 0
      ? '<p style="color:#9aa5b4;text-align:center;padding:40px">No topics were extracted from this session.</p>'
      : topicsHtml}
  </div>

</body>
</html>`;

  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) {
    // Fallback: download as HTML file
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${slugify(o.session_title)}_outline.html`;
    a.click();
    return;
  }
  win.document.write(html);
  win.document.close();
  // Give browser time to render fonts/styles before opening print dialog
  win.onload = () => setTimeout(() => win.print(), 400);
}

function escHtml(str: string | undefined | null): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function slugify(str: string): string {
  return (str ?? 'session')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}
