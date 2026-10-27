import nodemailer from 'nodemailer';

const DELIVERY_MESSAGE = "We couldn't send a verification email. Please try again later.";
const HEADER_CONTROLS = /[\u0000-\u001f\u007f]/;
const PLACEHOLDER = /^(?:<[^>]*>|(?:your[-_ ]|replace[-_ ]|change[-_ ]).+|placeholder|changeme)$/i;
const DELIVERY_CATEGORIES = new Set(['configuration', 'authentication', 'dns', 'timeout', 'connection', 'tls', 'recipient_rejected', 'unknown']);
const TRANSPORT_CATEGORIES = new Map([
  ['EAUTH', 'authentication'],
  ['EDNS', 'dns'], ['ENOTFOUND', 'dns'], ['EAI_AGAIN', 'dns'],
  ['ETIMEDOUT', 'timeout'],
  ['ECONNECTION', 'connection'], ['ECONNREFUSED', 'connection'], ['ECONNRESET', 'connection'],
  ['ENETUNREACH', 'connection'], ['EHOSTUNREACH', 'connection'], ['ESOCKET', 'connection'],
  ['ETLS', 'tls'], ['CERT_HAS_EXPIRED', 'tls'], ['DEPTH_ZERO_SELF_SIGNED_CERT', 'tls'],
  ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'tls'], ['SELF_SIGNED_CERT_IN_CHAIN', 'tls'],
  ['ERR_TLS_CERT_ALTNAME_INVALID', 'tls'],
  ['EENVELOPE', 'recipient_rejected'],
]);

function deliveryFailure(error) {
  // Only exact known transport codes select a fixed category. Never copy an
  // upstream message, response, cause or arbitrary diagnostic value.
  const category = error && typeof error === 'object' && typeof error.code === 'string'
    ? TRANSPORT_CATEGORIES.get(error.code) || 'unknown'
    : 'unknown';
  return new EmailDeliveryError('EMAIL_DELIVERY_FAILED', category);
}

export class EmailDeliveryError extends Error {
  constructor(code = 'EMAIL_DELIVERY_FAILED', diagnosticCategory = 'unknown') {
    super(code === 'EMAIL_NOT_CONFIGURED'
      ? 'Email verification delivery is not configured.'
      : DELIVERY_MESSAGE);
    this.name = 'EmailDeliveryError';
    this.code = code === 'EMAIL_NOT_CONFIGURED' ? code : 'EMAIL_DELIVERY_FAILED';
    // Backend diagnostics only; authentication endpoints retain their generic
    // delivery error. This property contains only fixed, non-sensitive values.
    Object.defineProperty(this, 'diagnosticCategory', {
      enumerable: true,
      value: this.code === 'EMAIL_NOT_CONFIGURED' ? 'configuration'
        : DELIVERY_CATEGORIES.has(diagnosticCategory) ? diagnosticCategory : 'unknown',
    });
  }
}

function configuredValue(value) {
  if (typeof value !== 'string' || HEADER_CONTROLS.test(value)) return '';
  const trimmed = value.trim();
  return trimmed && !PLACEHOLDER.test(trimmed) ? trimmed : '';
}

function emailAddress(value) {
  if (typeof value !== 'string' || HEADER_CONTROLS.test(value)) return null;
  const email = value.trim();
  if (email.length > 254 || !/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9.-]+$/.test(email)) return null;
  const [local, domain] = email.split('@');
  if (local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return null;
  const labels = domain.split('.');
  if (labels.length < 2 || labels.some(label => !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label))) return null;
  return email;
}

function senderAddress(value) {
  const raw = configuredValue(value);
  if (!raw) return null;
  const simple = emailAddress(raw);
  if (simple) return { name: 'Talk', address: simple };
  const named = /^(?:"([^"<>]{1,100})"|([^"<>]{1,100}))\s*<([^<>]+)>$/.exec(raw);
  const address = named && emailAddress(named[3]);
  const name = named && (named[1] || named[2]).trim();
  return address && name ? { name, address } : null;
}

function smtpConfiguration(env) {
  const host = configuredValue(env.SMTP_HOST || 'smtp.gmail.com');
  const port = configuredValue(env.SMTP_PORT || '587');
  const user = emailAddress(configuredValue(env.SMTP_USER));
  let password = configuredValue(env.SMTP_PASSWORD);
  const from = senderAddress(env.SMTP_FROM);
  if (!host || host.length > 253 || !/^[a-zA-Z0-9.-]+$/.test(host) || port !== '587' || !user || !password || !from) return null;
  // Gmail displays App Passwords in groups of four characters. Spaces are display formatting.
  if (host.toLowerCase() === 'smtp.gmail.com') password = password.replace(/\s/g, '');
  return {
    from,
    transport: {
      host,
      port: 587,
      secure: false,
      requireTLS: true,
      ignoreTLS: false,
      opportunisticTLS: false,
      auth: { user, pass: password },
      tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 25_000,
      dnsTimeout: 15_000,
      logger: false,
      debug: false,
      transactionLog: false,
      disableFileAccess: true,
      disableUrlAccess: true,
      maxRecipients: 1,
    },
  };
}

function verificationContent(code, expiresAt, deliveryTest = false) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) throw new TypeError('A six-digit verification code is required.');
  if (!(expiresAt instanceof Date) && (typeof expiresAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(expiresAt))) {
    throw new TypeError('A valid verification expiry is required.');
  }
  const expiry = new Date(expiresAt);
  if (!Number.isFinite(expiry.getTime())) throw new TypeError('A valid verification expiry is required.');
  const expiryLabel = `${new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(expiry)} IST`;
  const introduction = deliveryTest
    ? 'This is a delivery test for Talk email verification. The sample code below cannot be used to sign in. Start signup on Talk to receive a working verification code.'
    : 'Use this code to verify your email address for Talk.';
  const text = `Talk\n\n${deliveryTest ? 'Verification email delivery test' : 'Verify your email'}\n\n${introduction}\n\n${code}\n\nThis code expires in 5 minutes, at ${expiryLabel}. It can be used only once.\n\nEnter verification codes only on the Talk verification screen. Never share this code with anyone.\n\nIf you didn't request this, you can ignore this email.\n\nThe Talk team`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Verify your Talk email</title></head>
<body style="margin:0;padding:0;background:#F5F5F5;color:#1C1C1C;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:#F5F5F5;"><tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="width:100%;max-width:480px;background:#FFFFFF;border:1px solid #E8F1FF;border-radius:20px;">
      <tr><td style="padding:32px 32px 24px;font-size:30px;font-weight:700;letter-spacing:-1px;">Talk<span style="color:#0877C9;">.</span></td></tr>
      <tr><td style="padding:0 32px 32px;">
        <h1 style="margin:0 0 16px;font-size:26px;line-height:1.25;font-weight:700;">${deliveryTest ? 'Verification email delivery test' : 'Verify your email'}</h1>
        <p style="margin:0 0 24px;color:#737373;font-size:15px;line-height:1.6;">${introduction}</p>
        <div style="margin:0 0 24px;padding:20px 12px;background:#E8F1FF;border-radius:12px;color:#0877C9;font-family:monospace;font-size:34px;font-weight:700;letter-spacing:6px;text-align:center;">${code}</div>
        <p style="margin:0 0 16px;font-size:14px;line-height:1.6;">This code expires in <strong>5 minutes</strong>, at <strong>${expiryLabel}</strong>. It can be used only once.</p>
        <p style="margin:0 0 24px;color:#737373;font-size:14px;line-height:1.6;">Enter it only on the Talk verification screen. Never share this code with anyone.</p>
        <p style="margin:0;padding-top:24px;border-top:1px solid #E8F1FF;color:#737373;font-size:12px;line-height:1.6;">If you didn't request this, you can ignore this email.</p>
      </td></tr>
    </table>
    <p style="margin:20px 0 0;color:#737373;font-size:12px;line-height:1.6;">The Talk team</p>
  </td></tr></table>
</body></html>`;
  return { text, html };
}

/** Backend-only SMTP delivery. The injected factory is for isolated tests, not frontend use. */
export function createVerificationMailer(env, { createTransport = nodemailer.createTransport } = {}) {
  const configuration = smtpConfiguration(env || {});
  const configured = Boolean(configuration);
  let transport;
  function getTransport() {
    if (!configured) throw new EmailDeliveryError('EMAIL_NOT_CONFIGURED');
    if (!transport) transport = createTransport(configuration.transport);
    return transport;
  }
  return {
    configured,
    async sendVerification({ to, code, expiresAt, deliveryTest = false, purpose = 'verification' }) {
      const recipient = emailAddress(to);
      if (!recipient) throw new TypeError('A valid verification recipient is required.');
      const content = verificationContent(code, expiresAt, deliveryTest === true);
      if(purpose==='password-reset'&&!deliveryTest){
        for(const format of ['text','html'])content[format]=content[format]
          .replaceAll('Use this code to verify your email address for Talk.','Use this code to reset your Talk password.')
          .replaceAll('Verify your email','Reset your password')
          .replaceAll('Verify your Talk email','Reset your Talk password')
          .replaceAll('verification screen','password reset screen')
          .replaceAll('Enter verification codes only','Enter password reset codes only');
      }
      try {
        const result = await getTransport().sendMail({
          from: configuration.from,
          to: { address: recipient },
          subject: deliveryTest === true ? 'Talk verification email - delivery test' : purpose==='password-reset'?'Your Talk password reset code':'Your Talk verification code',
          ...content,
          disableFileAccess: true,
          disableUrlAccess: true,
        });
        const accepted = Array.isArray(result?.accepted) && result.accepted.some(address => typeof address === 'string' && address.toLowerCase() === recipient.toLowerCase());
        if (!accepted || result.rejected?.length) throw new EmailDeliveryError('EMAIL_DELIVERY_FAILED', 'recipient_rejected');
        if (result.pending?.length) throw new EmailDeliveryError();
      } catch (error) {
        if (error instanceof EmailDeliveryError) throw error;
        // SMTP errors can contain credentials, recipient addresses or protocol payloads.
        // Do not preserve their message, response, cause or stack in the public error.
        throw deliveryFailure(error);
      }
    },
    async verifyConnection() {
      try {
        const verified = await getTransport().verify();
        if (verified !== true) throw new EmailDeliveryError();
      } catch (error) {
        if (error instanceof EmailDeliveryError) throw error;
        throw deliveryFailure(error);
      }
    },
  };
}
