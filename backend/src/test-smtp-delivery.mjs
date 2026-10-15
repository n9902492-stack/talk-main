import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomInt } from 'node:crypto';
import dotenv from 'dotenv';
import { createVerificationMailer } from './mailer.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: path.join(root, '.env.local'), quiet: true });
dotenv.config({ path: path.join(root, '.env'), quiet: true });
const mailer = createVerificationMailer(process.env);
if (!mailer.configured) {
  console.error('SMTP is not configured. Complete the backend SMTP settings in .env or .env.local. No email was sent.');
  process.exitCode = 1;
} else {
  try {
    await mailer.verifyConnection();
    console.log('Live SMTP STARTTLS and authentication passed.');
    await mailer.sendVerification({
      to: process.env.SMTP_USER,
      code: String(randomInt(0, 1000000)).padStart(6, '0'),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      deliveryTest: true,
    });
    console.log('Live SMTP accepted one Talk verification delivery-test email for the configured SMTP account. Inbox receipt is not confirmed. Password and sample code are withheld.');
  } catch {
    console.error('SMTP test failed. Check network access and Gmail App Password configuration. Passwords, codes and raw SMTP responses are withheld.');
    process.exitCode = 1;
  }
}
