import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'dotenv';
import { prepareSchedulingEmailSmokeTest, schedulingEmailSmokeConfiguration } from '../backend/src/scheduling/email-smoke-test.mjs';

// Deliberately preparation-only: no SMTP import, send switch, worker or network.
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--recipient') {
  console.error('Offline preparation: node scripts/prepare-scheduling-email-test.mjs --recipient <one explicitly selected email>');
  process.exitCode = 1;
} else {
  try {
    const env = {};
    for (const name of ['.env', '.env.local']) if (existsSync(name)) Object.assign(env, parse(readFileSync(name)));
    Object.assign(env, process.env);
    const configuration = schedulingEmailSmokeConfiguration(env);
    const prepared = await prepareSchedulingEmailSmokeTest({ recipient: args[1], ...configuration });
    console.log(JSON.stringify({ ...prepared.review, reviewFile: path.join(prepared.directory, 'review.json') }, null, 2));
  } catch {
    console.error('NOT READY: verify one recipient, SMTP_FROM, SMTP credentials, SCHEDULING_PUBLIC_URL, the dedicated link secret and disabled normal scheduling delivery/Cloud AI. No email was sent.');
    process.exitCode = 1;
  }
}
