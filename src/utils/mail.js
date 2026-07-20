import nodemailer from 'nodemailer';

/**
 * Lightweight mail helper.
 * When SMTP_HOST + SMTP_USER + SMTP_PASS are set, sends via nodemailer.
 * Otherwise falls back to console.log (local/dev).
 * Set FRONTEND_URL for links in emails / API responses.
 * When EXPOSE_EMAIL_LINKS=1 (or non-production), auth APIs may return the link for QA.
 */
export function appBaseUrl() {
  return (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
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
