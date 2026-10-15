import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { productionConfig } from '../backend/src/production-config.mjs';
import { postgresConfig } from '../backend/src/postgres-database.mjs';
import { hostingCookies } from '../backend/src/hosting-cookies.mjs';

try {
  const env = parse(readFileSync(new URL('../.env.backend.production.local', import.meta.url)));
  const config = productionConfig(env); postgresConfig(env);
  hostingCookies({ secret: env.AUTH_COOKIE_SECRET, origin: config.origin });
  console.log('PASS Private production configuration has required values. No database connection, secret upload, deployment or SMS was attempted.');
} catch {
  console.error('NOT READY: Check the private backend environment, database password and runtime settings. Values withheld; no external actions attempted.');
  process.exitCode = 1;
}
