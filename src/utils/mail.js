/**
 * Lightweight mail helper — logs messages locally.
 * Set FRONTEND_URL for links in emails / API responses.
 * When EXPOSE_EMAIL_LINKS=1 (or non-production), auth APIs may return the link for QA.
 */
export function appBaseUrl() {
  return (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
}

export function shouldExposeEmailLinks() {
  return process.env.EXPOSE_EMAIL_LINKS === '1' || process.env.NODE_ENV !== 'production';
}

export async function sendAppMail({ to, subject, text }) {
  const payload = { to, subject, text, at: new Date().toISOString() };
  console.log('[mail]', JSON.stringify(payload));
  return payload;
}
