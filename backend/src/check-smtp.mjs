import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createVerificationMailer, EmailDeliveryError } from './mailer.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: path.join(root, '.env.local'), quiet: true });
dotenv.config({ path: path.join(root, '.env'), quiet: true });
const mailer = createVerificationMailer(process.env);
if (!mailer.configured) {
  console.error('SMTP is not configured. Set SMTP_HOST=smtp.gmail.com, SMTP_PORT=587, SMTP_USER, SMTP_PASSWORD and SMTP_FROM in .env. Gmail requires an App Password.');
  process.exitCode = 1;
} else {
  try {
    await mailer.verifyConnection();
    console.log('SMTP STARTTLS and authentication passed. No email was sent; this does not confirm inbox delivery.');
  } catch (error) {
    const category = error instanceof EmailDeliveryError ? error.diagnosticCategory : 'unknown';
    console.error(`SMTP verification failed (${category}). Check network access, Gmail App Password and sender configuration. Credentials and server responses are not printed.`);
    process.exitCode = 1;
  }
}
