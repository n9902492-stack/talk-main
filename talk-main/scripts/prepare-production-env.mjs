import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';

const root = fileURLToPath(new URL('../', import.meta.url));
const target = path.join(root, '.env.backend.production.local');
if (existsSync(target)) console.log('Private production environment file already exists; it was left unchanged.');
else {
  const local = parse(readFileSync(path.join(root, '.env.local')));
  const template = parse(readFileSync(path.join(root, 'deployment/backend.env.example')));
  for (const name of ['GOOGLE_CLIENT_ID', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM']) if (local[name]) template[name] = local[name];
  template.AUTH_COOKIE_SECRET = randomBytes(32).toString('base64url');
  template.PGPASSWORD = randomBytes(32).toString('base64url');
  writeFileSync(target, '# PRIVATE backend preparation. Excluded from Git, Docker and Hosting.\n' + Object.entries(template).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n', { flag: 'wx', mode: 0o600 });
  console.log('Private backend environment prepared using existing local SMTP/Google settings and a new cookie key. Values withheld.');
  console.log('Proposed database credentials were generated privately. Database provisioning and Secret Manager upload remain pending approval.');
}
// Explicitly complete only the blank database field in an older preparation;
// never replace an existing password or rotate a cookie key implicitly.
if (process.argv.includes('--complete-database-settings')) {
  const raw = readFileSync(target, 'utf8');
  if (!parse(raw).PGPASSWORD) writeFileSync(target, raw.replace(/^PGPASSWORD=.*$/m, `PGPASSWORD="${randomBytes(32).toString('base64url')}"`));
}
const migrationTarget = path.join(root, '.env.backend.migration.local');
if (!existsSync(migrationTarget)) {
  const runtime = parse(readFileSync(target));
  const migration = Object.fromEntries(['PGHOST', 'PGPORT', 'PGDATABASE', 'PGPOOL_MAX', 'PGSSLMODE'].map(name => [name, runtime[name] || '']));
  migration.PGUSER = 'talk_auth_migrator'; migration.PGPASSWORD = randomBytes(32).toString('base64url');
  writeFileSync(migrationTarget, '# PRIVATE migration-owner preparation; never grant to the app runtime.\n' + Object.entries(migration).map(([name, value]) => `${name}=${JSON.stringify(value)}`).join('\n') + '\n', { flag: 'wx', mode: 0o600 });
  console.log('Separate private migration-owner settings prepared. No database account or secret was created remotely.');
}
