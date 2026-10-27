import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ffmpeg from '@ffmpeg-installer/ffmpeg';
import { expect } from '@playwright/test';
import { meetingHarness, openPanel, panel, connected } from './helpers/live-meeting.mjs';
import { localSfu } from './helpers/local-sfu.mjs';

// Real WebRTC, native synthetic-tab sharing and the production recording worker.
// No physical devices, Cloud LiveKit credentials, application DB or public server.
assert.equal(globalThis.__cloudEgressGuard, true, 'Run with the loopback-only egress guard');
const directory = await fs.mkdtemp(path.resolve('artifacts/qa/recording-screen-share-'));
const cameras = {};
for (const [name, color] of [['ScreenHost', 'red'], ['ScreenMember', 'lime']]) {
  cameras[name] = path.join(directory, name + '.y4m');
  execFileSync(ffmpeg.path, ['-y', '-f', 'lavfi', '-i', `color=c=${color}:size=640x360:rate=10`, '-t', '2', '-pix_fmt', 'yuv420p', cameras[name]], { stdio: 'ignore', windowsHide: true });
}
const sfu = await localSfu();
const options = { recordings: true, databasePath: path.join(directory, 'test.sqlite'), cameraFiles: cameras, rawAudio: true, lowResourceMedia: true,
  frontendBuild: process.env.TALK_TEST_FRONTEND_BUILD || process.argv[2] || 'frontend/dist', livekitConfig: sfu.config,
  recordingEnv: { RECORDING_LOCAL_PATH: path.join(directory, 'media'), WHISPER_EXECUTABLE: path.join(directory, 'not-installed.exe') } };
const evidence = { syntheticMedia: true, loopbackOnly: true, actualMediaRecorder: true, results: [] };
let h, host, member, presentation, step = 'startup';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const wait = predicate => expect.poll(predicate, { timeout: 180000, intervals: [500, 1000, 2000] }).toBe(true);
const row = id => h.database.prepare('SELECT * FROM talk_recordings WHERE id=?').get(id);
async function state(context = host.context) { return (await context.request.get(h.origin + '/api/auth/meetings/talk-workshop/recording-state')).json(); }
async function action(context, suffix) {
  const cfg = await state(context);
  return context.request.post(h.origin + '/api/auth/meetings/talk-workshop/recordings/' + suffix, { headers: { Origin: h.origin, 'X-CSRF-Token': cfg.csrfToken }, data: {} });
}
async function start() {
  await presentation.evaluate(() => document.querySelector('main').style.background = '#005bff');
  await openPanel(host.page, 'More options');
  await panel(host.page).getByLabel('Recording mode', { exact: true }).selectOption('video');
  await expect(panel(host.page).getByText('Records shared screens, participant cameras and meeting audio together.', { exact: false })).toBeVisible();
  await panel(host.page).getByRole('button', { name: 'Request recording consent', exact: true }).click();
  await expect(host.page.getByRole('dialog').getByRole('heading', { name: 'This meeting requests recording', exact: true })).toBeVisible();
  const id = (await state()).active.id;
  assert.equal((await action(member.context, id + '/start')).status(), 404, 'Ordinary participant cannot start');
  assert.equal((await action(host.context, id + '/start')).status(), 409, 'Consent enforced on backend');
  for (const person of [host, member]) await person.page.getByRole('button', { name: 'I consent to recording', exact: true }).click();
  await expect(panel(host.page).getByRole('button', { name: 'Start Recording', exact: true })).toBeEnabled({ timeout: 30000 });
  await panel(host.page).getByRole('button', { name: 'Start Recording', exact: true }).click();
  await wait(() => { const r = row(id); assert.notEqual(r.status, 'failed', r.error_code); return r.status === 'recording'; });
  await expect(host.page.locator('.talk-recording-notice.is-recording')).toBeVisible();
  await delay(6000);
  await presentation.evaluate(() => document.querySelector('main').style.background = '#d000ff');
  await delay(6000);
  return id;
}
function energy(pcm, frequency) {
  let sum = 0, windows = 0;
  for (let start = 0; start + 4800 < Math.min(pcm.length / 4, 48000 * 6); start += 4800) {
    let re = 0, im = 0;
    for (let i = 0; i < 4800; i++) { const x = pcm.readFloatLE((start + i) * 4), angle = 2 * Math.PI * frequency * i / 48000; re += x * Math.cos(angle); im += x * Math.sin(angle); }
    sum += (re * re + im * im) / (4800 * 4800); windows++;
  }
  return Math.sqrt(sum / Math.max(1, windows));
}
function pixels(filename, seconds) {
  const rgb = execFileSync(ffmpeg.path, ['-v', 'error', '-ss', String(seconds), '-i', filename, '-frames:v', '1', '-vf', 'scale=640:360', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { windowsHide: true, maxBuffer: 1024 * 1024 });
  const counts = { red: 0, green: 0, blue: 0, purple: 0 };
  for (let i = 0; i < rgb.length; i += 3) {
    const [r, g, b] = rgb.subarray(i, i + 3);
    if (r > 140 && r > g * 1.7 && r > b * 1.7) counts.red++;
    if (g > 140 && g > r * 1.7 && g > b * 1.7) counts.green++;
    if (b > 140 && b > r * 1.7 && b > g * 1.7) counts.blue++;
    if (r > 120 && b > 140 && g < 70) counts.purple++;
  }
  return counts;
}
async function verify(id, reason) {
  await wait(() => { const r = row(id); assert.notEqual(r.status, 'failed', r.error_code); return r.status === 'completed'; });
  const r = row(id), filename = await h.recordingRuntime.storage.localPath(r.storage_key), info = await fs.stat(filename);
  assert.equal(info.size, r.bytes); assert.ok(info.size > 10000); assert.ok(r.duration_ms > 10000);
  execFileSync(ffmpeg.path, ['-v', 'error', '-i', filename, '-f', 'null', '-'], { windowsHide: true, stdio: 'pipe' });
  const early = pixels(filename, 2), late = pixels(filename, r.duration_ms / 1000 - 2);
  for (const frame of [early, late]) assert.ok(frame.red > 4000 && frame.green > 4000, 'Both participant cameras must be saved: ' + JSON.stringify(frame));
  assert.ok(early.blue > 4000 && early.purple < 1000, 'Initial shared-screen content required: ' + JSON.stringify(early));
  assert.ok(late.purple > 4000 && late.blue < 1000, 'Changed shared-screen content required: ' + JSON.stringify(late));
  const pcm = execFileSync(ffmpeg.path, ['-v', 'error', '-i', filename, '-af', 'aresample=async=1:first_pts=0', '-f', 'f32le', '-ar', '48000', '-ac', '1', 'pipe:1'], { windowsHide: true, maxBuffer: 40 * 1024 * 1024 });
  const audio = { host440: energy(pcm, 440), member660: energy(pcm, 660), noise520: energy(pcm, 520) };
  assert.ok(audio.host440 > 0.0001 && audio.member660 > 0.0001 && audio.host440 > audio.noise520 * 3 && audio.member660 > audio.noise520 * 3, 'Both microphones required');
  const history = await host.context.newPage(); await history.goto(h.origin + '/meeting-history/talk-workshop');
  const details = await (await host.context.request.get(h.origin + '/api/auth/meeting-history/talk-workshop')).json();
  const index = details.recordings.findIndex(item => item.id === id); assert.ok(index >= 0);
  await history.getByLabel('Recording segments').getByRole('button').nth(index).click();
  const player = history.getByLabel('Meeting recording', { exact: true });
  await expect(player).toHaveAttribute('src', `/api/auth/recordings/${id}/playback`);
  await expect.poll(() => player.evaluate(el => el.videoWidth), { timeout: 30000 }).toBe(1280);
  assert.equal(await player.evaluate(el => el.videoHeight), 720);
  await player.evaluate(el => el.play()); await expect.poll(() => player.evaluate(el => el.currentTime), { timeout: 20000 }).toBeGreaterThan(0.5);
  await player.evaluate(el => { el.pause(); el.currentTime = el.duration - 2; });
  await expect.poll(() => player.evaluate(el => !el.seeking && el.readyState >= 2)).toBe(true);
  await history.screenshot({ path: path.join(directory, reason + '-details.png'), fullPage: true }); await history.close();
  const playback = h.origin + `/api/auth/recordings/${id}/playback`;
  assert.equal((await member.context.request.get(playback)).status(), 404);
  assert.equal((await host.context.request.get(playback, { headers: { Range: 'bytes=0-1023' } })).status(), 206);
  assert.equal((await host.context.request.get(playback + '?download=1')).status(), 200);
  evidence.results.push({ reason, id, filename, bytes: r.bytes, durationMs: r.duration_ms, early, late, audio, decoded: true, playedInMeetingDetails: true, seeked: true, privateAccess: true, rangeDownload: true });
  console.log('PASS', reason, 'saved/decoded/played shared screen, two cameras and two microphones');
}
try {
  h = await meetingHarness(options); host = await h.member('ScreenHost'); member = await h.member('ScreenMember', 660);
  await h.join(host.page, 'ScreenHost', true); await h.join(member.page, 'ScreenMember', true);
  step = 'native synthetic tab share';
  presentation = await host.context.newPage(); await presentation.goto(h.origin + '/test-presentation'); await presentation.bringToFront();
  await host.page.getByRole('button', { name: 'Share screen', exact: true }).click();
  await expect.poll(() => host.page.evaluate(() => window.__talkTestDisplays.some(stream => stream.getVideoTracks().some(track => track.readyState === 'live'))), { timeout: 30000 }).toBe(true);
  step = 'normal stop'; const id = await start();
  await panel(host.page).getByRole('button', { name: 'Stop Recording', exact: true }).click(); await verify(id, 'normal-stop');
  await connected(host.page); await connected(member.page);
  step = 'host end while recording'; const endedId = await start();
  assert.equal((await h.api(host.context, 'end')).status(), 200); await verify(endedId, 'host-ended');
  step = 'persistent restart'; const before = row(id); await h.close(); h = undefined;
  h = await meetingHarness(options); host = await h.member('ScreenHost'); member = await h.member('ScreenMember', 660);
  assert.equal(row(id).storage_key, before.storage_key); assert.equal(row(id).bytes, before.bytes);
  await verify(id, 'after-restart');
  assert.deepEqual(h.errors, []); evidence.passed = true;
} catch (error) {
  process.exitCode = 1; evidence.passed = false; evidence.step = step; evidence.error = error.message;
  if (h) evidence.workerEvents = h.database.prepare("SELECT action,detail FROM talk_recording_events WHERE action IN ('worker_stage','capture_failed','capture_finalizing','capture_completed') ORDER BY created_at").all();
  if (host?.page && !host.page.isClosed()) await host.page.screenshot({ path: path.join(directory, 'failure.png'), fullPage: true }).catch(() => {});
  console.error('FAIL', step, error.message);
} finally {
  await fs.writeFile(path.join(directory, 'results.json'), JSON.stringify(evidence, null, 2));
  console.log('Evidence:', path.join(directory, 'results.json'));
  if (h) await h.close(); await sfu.stop();
}
