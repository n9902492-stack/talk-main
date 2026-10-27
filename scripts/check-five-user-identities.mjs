// Read-only counts. Never print identities, password hashes or environment values.
import fs from 'node:fs';
import dotenv from 'dotenv';
import { DatabaseSync } from 'node:sqlite';
const env = dotenv.parse(fs.readFileSync('.env.tunnel-test.local'));
const allowed = env.TUNNEL_TEST_EMAILS.split(',').map(v => v.trim().toLowerCase());
const local = dotenv.parse(fs.readFileSync('.env.local'));
for (const file of new Set(['data/tunnel-test/talk.sqlite', local.AUTH_DATABASE_PATH || 'data/talk.sqlite'])) {
  if (!fs.existsSync(file)) continue;
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const accounts = db.prepare('SELECT id,email,email_verified FROM accounts').all().filter(a => allowed.includes(a.email?.toLowerCase()));
    const ready = accounts.filter(a => a.email_verified && db.prepare("SELECT 1 FROM identities WHERE account_id=? AND provider='password' AND password_hash IS NOT NULL AND verified_at IS NOT NULL").get(a.id));
    console.log(JSON.stringify({ database: file, approvedAccounts: accounts.length, verifiedPasswordAccounts: ready.length }));
  } finally { db.close(); }
}
