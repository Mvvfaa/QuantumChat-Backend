import nodemailer from 'nodemailer';

/**
 * Lightweight mail helper.
 * When SMTP_HOST + SMTP_USER + SMTP_PASS are set, sends via nodemailer.
 * Otherwise falls back to console.log (local/dev).
 * Set FRONTEND_URL (or PUBLIC_APP_URL) to the public website origin for
 * invite / email links. CLIENT_URL / CORS_ORIGINS are used as fallbacks;
 * localhost is never chosen in production.
 * When EXPOSE_EMAIL_LINKS=1 (or non-production), auth APIs may return the link for QA.
 */
function isLocalHostUrl(url) {
  try {
    const host = new URL(url).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return true;
  }
}

/** Canonical public web app — used when production env still points at localhost. */
const DEFAULT_PRODUCTION_APP_URL = 'https://chat.quantumlogicslimited.com';

export function appBaseUrl() {
  const candidates = [
    process.env.FRONTEND_URL,
    process.env.PUBLIC_APP_URL,
    ...String(process.env.CLIENT_URL || '').split(','),
    ...String(process.env.CORS_ORIGINS || '').split(','),
  ]
    .map((s) => String(s || '').trim().replace(/\/$/, ''))
    .filter(Boolean);

  const httpsPublic = candidates.find((u) => /^https:\/\//i.test(u) && !isLocalHostUrl(u));
  if (httpsPublic) return httpsPublic;

  const anyPublic = candidates.find((u) => !isLocalHostUrl(u));
  if (anyPublic) return anyPublic;

  if (process.env.NODE_ENV === 'production' || process.env.VERCEL === '1') {
    return DEFAULT_PRODUCTION_APP_URL;
  }

  return candidates[0] || 'http://localhost:5173';
}

export function shouldExposeEmailLinks() {
  return process.env.EXPOSE_EMAIL_LINKS === '1' || process.env.NODE_ENV !== 'production';
}

function smtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

let transporter;

function getTransporter() {
  if (!smtpConfigured()) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === '1' || Number(process.env.SMTP_PORT) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return transporter;
}

export async function sendAppMail({ to, subject, text }) {
  const payload = { to, subject, text, at: new Date().toISOString() };

  const transport = getTransporter();
  if (!transport) {
    console.log('[mail]', JSON.stringify(payload));
    return payload;
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  await transport.sendMail({ from, to, subject, text });
  return payload;
}
