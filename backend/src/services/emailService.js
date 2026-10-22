import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';

let emailConfig = env;

function publicAppUrl() {
  try {
    const url = new URL(emailConfig.publicAppUrl);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (emailConfig.isProduction && url.protocol !== 'https:') return null;
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

export function emailDeliveryStatus() {
  const missing = [];
  if (!emailConfig.smtpHost) missing.push('SMTP_HOST');
  if (!Number.isInteger(emailConfig.smtpPort) || emailConfig.smtpPort < 1 || emailConfig.smtpPort > 65535) missing.push('SMTP_PORT');
  if (!emailConfig.smtpFrom) missing.push('SMTP_FROM');
  if (!publicAppUrl()) missing.push('PUBLIC_APP_URL (an absolute HTTP URL; HTTPS is required in production)');
  if (Boolean(emailConfig.smtpUser) !== Boolean(emailConfig.smtpPass)) missing.push('both SMTP_USER and SMTP_PASS, or neither');
  return { configured: missing.length === 0, missing };
}

let transportFactory = () => nodemailer.createTransport(transportOptions());

function transportOptions() {
  return {
    host: emailConfig.smtpHost,
    port: emailConfig.smtpPort,
    secure: emailConfig.smtpSecure,
    ...(emailConfig.smtpUser ? { auth: { user: emailConfig.smtpUser, pass: emailConfig.smtpPass } } : {}),
  };
}

export function __setEmailTransportFactory(factory) {
  transportFactory = factory;
}

export function __setEmailConfigForTests(config) {
  emailConfig = { ...env, ...config };
}

export function __resetEmailTransportFactory() {
  transportFactory = () => nodemailer.createTransport(transportOptions());
  emailConfig = env;
}

export function applicationUrl(path) {
  const base = publicAppUrl();
  if (!base) throw new AppError(503, `Email delivery is unavailable. Configure: ${emailDeliveryStatus().missing.join(', ')}.`);
  return new URL(path, `${base}/`).toString();
}

export async function sendActionEmail({ to, subject, text }) {
  const status = emailDeliveryStatus();
  if (!status.configured) {
    throw new AppError(503, `Email delivery is unavailable. Configure: ${status.missing.join(', ')}.`);
  }
  try {
    const delivery = await transportFactory().sendMail({ from: env.smtpFrom, to, subject, text });
    const acceptedRecipients = Array.isArray(delivery?.accepted) ? delivery.accepted : [];
    if (!acceptedRecipients.some((recipient) => String(recipient).toLowerCase() === String(to).toLowerCase())) {
      throw new Error('The SMTP provider did not accept the recipient.');
    }
  } catch (error) {
    console.error('Configured SMTP delivery failed:', error?.code || error?.name || 'unknown error');
    throw new AppError(503, 'Email delivery could not be confirmed. Verify SMTP_HOST, SMTP_PORT, SMTP_SECURE, optional SMTP_USER/SMTP_PASS, and SMTP_FROM, then check provider logs before retrying.');
  }
}
