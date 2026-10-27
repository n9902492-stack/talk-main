import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import { createRuntimeAuth } from './runtime-auth.mjs';
import { createProductionAuth } from './runtime-auth.mjs';
import { existsSync } from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const production = process.env.NODE_ENV === 'production';
if (!production) {
  dotenv.config({ path: path.join(root, '.env.local'), quiet: true });
  dotenv.config({ path: path.join(root, '.env'), quiet: true });
}

let appUrl;
try { appUrl = new URL(process.env.APP_URL || 'http://localhost:3001'); }
catch { console.error('Invalid APP_URL. Runtime values withheld.'); process.exit(1); }
const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(appUrl.hostname);
const secureCookies = appUrl.protocol === 'https:';
if (!['http:', 'https:'].includes(appUrl.protocol) || (!secureCookies && !loopback)) {
  throw new Error('APP_URL must use HTTPS except when running on localhost.');
}
const port = Number(process.env.PORT || appUrl.port || 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port.');

const origins = [appUrl.origin];
if (loopback && !secureCookies) {
  origins.push(`http://localhost:${port}`, `http://127.0.0.1:${port}`);
}
const app = express();
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.set({
    'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
    'Referrer-Policy': loopback ? 'no-referrer-when-downgrade' : 'strict-origin-when-cross-origin',
  });
  next();
});
let auth;
try { auth = production ? await createProductionAuth(process.env) : createRuntimeAuth(process.env, { origins, secureCookies }); }
catch { console.error('Talk authentication backend could not start. Check private runtime configuration, database connectivity and migrations. Details withheld.'); process.exit(1); }
app.get('/healthz', async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  try { if (auth.locals.checkAuthDatabase) await auth.locals.checkAuthDatabase(); res.json({ ready: true }); }
  catch { res.status(503).json({ ready: false }); }
});
app.use(auth);
app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found', message: 'This API route does not exist.' }));
app.use(express.static(path.join(root, 'frontend/dist')));
app.get('*', (_req, res) => existsSync(path.join(root, 'frontend/dist/index.html')) ? res.sendFile(path.join(root, 'frontend/dist/index.html')) : res.status(404).json({ error: 'not_found' }));
const server = app.listen(port, process.env.HOST || (production ? '0.0.0.0' : '127.0.0.1'), () => {
  console.log(`Talk is running at ${appUrl.origin}`);
  if (!process.env.GOOGLE_CLIENT_ID) console.log('Set GOOGLE_CLIENT_ID in .env.local to enable Google sign-in.');
});
auth.locals.attachMeetingGateway(server);
let cleanup;
const closeAuth = () => cleanup ||= Promise.resolve(auth.locals.closeAuthDatabase());
server.once('close', () => { void closeAuth().catch(() => console.error('Talk shutdown cleanup did not finish.')); });
let stopping = false;
const shutdown = async () => {
  if (stopping) return; stopping = true;
  server.close();
  server.closeIdleConnections();
  // Close media sockets and flush capture before releasing the shared database.
  // Transcription child processes receive cancellation rather than blocking exit.
  const deadline = setTimeout(() => process.exit(1), 180000); deadline.unref();
  try { await closeAuth(); }
  catch { console.error('Talk shutdown cleanup did not finish.'); process.exitCode = 1; }
  finally { clearTimeout(deadline); }
};
process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
