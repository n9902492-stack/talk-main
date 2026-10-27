// Server owns only its listener. It never manages the connector process.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createServer } from 'node:http';
import { fiveUserConfiguration, createFiveUserApp } from '../backend/src/five-user-test.mjs';
let runtime, server, timer, heartbeat, launch, closing = false, origin = null, stage = 'manifest';
const atomic = (p, value) => { fs.writeFileSync(p + '.server.tmp', JSON.stringify(value), { mode: 0o600 }); fs.renameSync(p + '.server.tmp', p); };
const save = status => atomic(launch.serverState, { launchId: launch.id, serverPid: process.pid, listener: '127.0.0.1:3003', origin, status, connectorManagedByServer: false, updatedAt: new Date().toISOString() });
let dispatch = (_req, res) => res.writeHead(503, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' }).end('{"ready":false}');
async function close() { if (closing) return; closing = true; clearInterval(timer); clearInterval(heartbeat); dispatch = (_req, res) => res.writeHead(503).end(); server?.closeAllConnections(); if (server?.listening) await new Promise(resolve => server.close(resolve)); await runtime?.close(); if (launch) save('STOPPED'); }
try {
  launch = JSON.parse(fs.readFileSync('artifacts/qa/five-user-public-launch.json'));
  stage = 'approval'; assert.deepEqual(process.argv.slice(2), ['--approved', launch.id]); assert.equal(launch.approvedAction, 'five-user-public-test'); assert.equal(launch.securityPreflight, 'PASS'); assert.equal(launch.servicesDisabled, true);
  assert.equal(path.dirname(launch.directory), path.resolve('data/five-user-public-test'));
  stage = 'loopback bind'; server = createServer((req, res) => dispatch(req, res)); await new Promise((resolve, reject) => { server.once('error', reject); server.listen(3003, '127.0.0.1', resolve); }); assert.equal(server.address().address, '127.0.0.1'); stage = 'private status persistence'; save('WAITING_FOR_NEW_ORIGIN');
  let binding = false;
  timer = setInterval(async () => {
    if (closing || binding || !fs.existsSync(launch.originFile)) return; binding = true;
    try {
      const assigned = JSON.parse(fs.readFileSync(launch.originFile)); assert.equal(assigned.launchId, launch.id); assert.equal(assigned.connected, true); assert.ok(assigned.connectorPid !== process.pid);
      const config = fiveUserConfiguration(launch.root, assigned.origin, launch.directory); assert.equal(config.databasePath, launch.databasePath);
      process.env.SCHEDULING_PUBLIC_URL = config.origin; process.env.SCHEDULING_EMAIL_ENABLED = 'false';
      runtime = createFiveUserApp(config); runtime.attach(server); origin = config.origin; dispatch = (req, res) => runtime.app(req, res); clearInterval(timer);
      // Refresh private preview to the newly assigned origin, never print it.
      const { DatabaseSync } = await import('node:sqlite'); const { emailBookingSql } = await import('../backend/src/scheduling/email-outbox.mjs');
      const db = new DatabaseSync(launch.databasePath, { readOnly: true }); try { const b = db.prepare(emailBookingSql).get(launch.bookingId); fs.writeFileSync(path.join(launch.directory, 'confirmation-link.private.json'), JSON.stringify({ bookingId: b.id, joiningUrl: config.links.inviteeUrl(b) }), { mode: 0o600 }); } finally { db.close(); }
      save('READY'); heartbeat = setInterval(() => save('READY'), 15000); heartbeat.unref(); console.log(JSON.stringify({ ready: true, origin, listener: '127.0.0.1:3003', smtp: false, otp: false, connectorManagedByServer: false }));
    } catch { console.error('Five-user origin binding failed; routes closed. Private details withheld.'); await close(); process.exitCode = 1; }
  }, 300);
  process.once('SIGINT', () => void close()); process.once('SIGTERM', () => void close());
} catch (error) { console.error('Five-user server startup failed at ' + stage + ' (' + (/^[A-Z_]+$/.test(error.code || '') ? error.code : 'validation') + '). No other service stopped.'); await close().catch(() => {}); process.exitCode = 1; }
