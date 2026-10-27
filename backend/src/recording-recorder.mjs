import { chromium } from 'playwright';
import { recordingClientBundle } from './recording-client-bundle.mjs';
import { open, stat, chmod, rename, unlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpeg from '@ffmpeg-installer/ffmpeg';
const execute = promisify(execFile);

// The prepared artifact is already cached on disk and fingerprint-checked.
// Recheck it per segment so a long-running server cannot keep stale capture
// logic after an offline preparation/update of the recorder client.
const bundle = () => recordingClientBundle();

// Every race observes the original operation's rejection, removes its abort
// listener, and clears its timer. A timed-out operation cannot retain a request.
async function deadline(operation, timeoutMs, signal) {
  if (signal?.aborted) throw new Error('Recording worker was cancelled.');
  let timer, cancelled;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Recording worker timed out.')), timeoutMs); }),
      ...(signal ? [new Promise((_, reject) => { cancelled = () => reject(new Error('Recording worker was cancelled.')); signal.addEventListener('abort', cancelled, { once: true }); })] : []),
    ]);
  } finally { clearTimeout(timer); if (cancelled) signal.removeEventListener('abort', cancelled); }
}

// BrowserServer retains ownership of the actual Chromium process tree. Merely
// racing browser.close() leaves a hung encoder/browser alive after the timeout.
export async function closeRecordingBrowser(server, { force = false, closeMs = 3000, killMs = 2000 } = {}) {
  if (!server) return;
  if (!force) {
    try { await deadline(() => server.close(), closeMs); return; } catch { /* Force only this worker's owned process tree. */ }
  }
  await deadline(() => server.kill(), killMs).catch(() => {});
}

export function createBrowserRecorder({ env = {}, service, browserType = chromium, runCommand = execute, buildClient = bundle, timeouts = {} } = {}) {
  const limits = { operation: 45000, launch: 30000, flush: 25000, io: 15000, remux: 120000, close: 3000, kill: 2000, ...timeouts };
  const configured = Boolean(service?.configured && (env.NODE_ENV !== 'production' || env.RECORDING_PROVIDER === 'local-browser' && env.CHROMIUM_PATH));
  return {
    configured,
    async start({ id, roomName, identity, mode, outputPath, allowedIdentities = [], maxBytes = 536870912, maxDurationMs = 7200000, onFailure = () => {}, onProgress = () => {}, signal }) {
      if (!configured) throw new Error('The recording worker is not configured.');
      const controller = new AbortController(), workerSignal = controller.signal;
      let server, browser, file, stopped = false, stopping, closing, acceptingChunks = true, written = 0, writeQueue = Promise.resolve(), timer;
      let context, page, credential, remuxing;
      const bounded = (operation, timeoutMs = limits.operation) => deadline(operation, timeoutMs, workerSignal);
      const close = ({ force = false } = {}) => closing ||= (async () => {
        clearTimeout(timer); acceptingChunks = false;
        signal?.removeEventListener('abort', cancel);
        await closeRecordingBrowser(server, { force, closeMs: limits.close, killMs: limits.kill });
        await deadline(() => writeQueue, limits.io).catch(() => {});
        const pendingFile = file; file = undefined;
        await deadline(() => pendingFile?.close(), limits.io).catch(() => {});
      })();
      const abort = () => {
        stopped = true; controller.abort(); clearTimeout(timer);
        // Also interrupt an already-running graceful close. kill() terminates
        // this worker only, including Chromium children; it never targets users.
        if (closing && server) void closeRecordingBrowser(server, { force: true, killMs: limits.kill });
        return close({ force: true });
      };
      const cancel = () => { void abort().catch(() => {}); };
      if (signal?.aborted) controller.abort();
      else signal?.addEventListener('abort', cancel, { once: true });
      const notifyFailure = code => { if (!stopped) { stopped = true; clearTimeout(timer); queueMicrotask(() => { void Promise.resolve(onFailure(code)).catch(() => {}); }); } };
      try {
        // Validate the local client before allocating a browser or opening a
        // partial file. Restricted runtimes read the prepared private artifact.
        await bounded(() => onProgress('client_bundle'));
        const client = await bounded(buildClient);
        credential = await bounded(() => service.issueRecordingToken(identity, roomName));
        await bounded(() => onProgress('browser_launch'));
        const launching = browserType.launchServer({ ...(env.CHROMIUM_PATH ? { executablePath: env.CHROMIUM_PATH } : { channel: 'chrome' }), host: '127.0.0.1', headless: true, chromiumSandbox: env.NODE_ENV === 'production', timeout: limits.launch, args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
        // Startup can finish after a manager watchdog/cancellation. Dispose the
        // late worker instead of orphaning a newly launched browser.
        void launching.then(owned => { if (workerSignal.aborted || closing) return closeRecordingBrowser(owned, { force: true, killMs: limits.kill }); }).catch(() => {});
        server = await bounded(() => launching, limits.launch);
        browser = await bounded(() => browserType.connect(server.wsEndpoint(), { timeout: limits.operation }));
        await bounded(() => onProgress('browser_ready'));
        context = await bounded(() => browser.newContext({ permissions: ['local-network-access', 'microphone', 'camera'] }));
        // Permissions expose usable ICE addresses, but capture APIs are blocked:
        // this worker must never open the server computer's microphone/camera.
        await bounded(() => context.addInitScript(() => {
          if (!navigator.mediaDevices) return;
          const blocked = () => Promise.reject(new DOMException('Only remote meeting tracks may be recorded.', 'NotAllowedError'));
          Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: blocked });
          Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { value: blocked });
        }));
        page = await bounded(() => context.newPage());
        let diagnostics = 0;
        const diagnose = value => {
          if (diagnostics++ >= 10) return;
          const text = String(value).split('\n')[0].replace(/([?&](?:access_token|token|authorization)=)[^&#\s'"]+/gi, '$1[redacted]').replaceAll(credential.token, '[redacted]').replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[redacted]').slice(0, 600);
          void Promise.resolve().then(() => onProgress(text)).catch(() => {});
        };
        page.on('websocket', socket => socket.on('socketerror', failure => diagnose(`websocket_error: ${failure}`)));
        const opening = open(outputPath, 'wx', 0o600);
        void opening.then(opened => { if (workerSignal.aborted || closing) return opened.close().catch(() => {}); }).catch(() => {});
        file = await bounded(() => opening, limits.io);
        await bounded(() => chmod(outputPath, 0o600).catch(() => {}), limits.io);
        const upstream = new URL(credential.serverUrl), allowedOrigin = upstream.origin.replace(/^ws/, 'http');
        // The worker never browses user pages or external assets.
        await bounded(() => context.route('**/*', route => {
          const url = new URL(route.request().url());
          if (url.protocol === 'about:' || url.origin === allowedOrigin || url.origin === upstream.origin) return route.continue();
          void Promise.resolve().then(() => onProgress(`blocked_request: ${url.origin}${url.pathname}`)).catch(() => {});
          return route.abort();
        }));
        page.on('requestfailed', request => { void Promise.resolve().then(() => onProgress(`request_failed: ${new URL(request.url()).pathname} ${request.failure()?.errorText || ''}`)).catch(() => {}); });
        await bounded(() => page.exposeFunction('writeTalkRecording', value => {
          if (!acceptingChunks || workerSignal.aborted) throw new Error('Recording storage has closed.');
          if (typeof value !== 'string' || value.length > 12 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error('Recording chunk is invalid.');
          const bytes = Buffer.from(value, 'base64'); written += bytes.length;
          if (written > maxBytes) { notifyFailure('recording_size_limit'); throw new Error('Recording size limit exceeded.'); }
          writeQueue = writeQueue.then(async () => { if (!file) throw new Error('Recording file closed.'); let offset = 0; while (offset < bytes.length) { const result = await file.write(bytes, offset, bytes.length - offset); if (!result.bytesWritten) throw new Error('Recording write failed.'); offset += result.bytesWritten; } });
          // Reserve room for the final encoder flush instead of losing a valid
          // long segment when the hard byte limit is reached.
          if (written >= maxBytes - Math.min(12 * 1024 * 1024, maxBytes / 10)) notifyFailure('recording_size_limit');
          return writeQueue.then(() => true);
        }));
        await bounded(() => page.exposeFunction('failTalkRecording', notifyFailure));
        page.on('crash', () => notifyFailure('recording_worker_failed'));
        browser.on('disconnected', () => { if (!stopping && !closing) notifyFailure('recording_worker_failed'); });
        // Establish the SFU's real address space before replacing the health
        // document. A virtual public page otherwise blocks loopback ICE.
        await bounded(() => page.goto(allowedOrigin, { waitUntil: 'domcontentloaded' }));
        await bounded(() => page.setContent('<!doctype html><title>Talk authorized recording worker</title>'));
        await bounded(() => page.addScriptTag({ content: client }));
        await bounded(() => onProgress('room_connect'));
        await bounded(() => page.evaluate(options => window.startTalkRecorder(options), { url: credential.serverUrl, token: credential.token, mode, allowedIdentities }));
        await bounded(() => onProgress('capture_ready'));
        timer = setTimeout(() => notifyFailure('recording_duration_limit'), maxDurationMs); timer.unref?.();
        return {
          id,
          isRunning: () => !stopped && browser.isConnected(),
          async setAllowed(identities) {
            if (!stopped) try { await bounded(() => page.evaluate(values => window.updateTalkRecordingAllowed(values), identities)); }
            catch (failure) { notifyFailure('recording_worker_failed'); throw failure; }
          },
          stop: () => stopping ||= (async () => {
            stopped = true; clearTimeout(timer);
            try {
              const result = await bounded(() => page.evaluate(() => window.stopTalkRecorder()), limits.flush);
              await bounded(() => writeQueue, limits.io); acceptingChunks = false;
              await bounded(() => file?.sync(), limits.io);
              await bounded(() => file?.close(), limits.io); file = undefined;
              // MediaRecorder emits live WebM without a seek index/duration.
              // Remux locally so private playback and timestamp seeking work.
              const indexed = outputPath + '.indexed.webm';
              try {
                await bounded(() => remuxing = runCommand(env.FFMPEG_PATH || ffmpeg.path, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', outputPath, '-map', '0', '-c', 'copy', indexed], { timeout: limits.remux, maxBuffer: 65536, windowsHide: true, signal: workerSignal, killSignal: 'SIGKILL' }), limits.remux + 1000);
                await bounded(() => rename(indexed, outputPath), limits.io);
              } finally {
                // On Windows cancellation can win the race just before FFmpeg
                // acknowledges SIGKILL. Let its handles close before unlinking
                // the private intermediate, without waiting indefinitely.
                await deadline(() => Promise.resolve(remuxing).catch(() => {}), limits.kill).catch(() => {});
                await deadline(() => unlink(indexed).catch(() => {}), limits.io).catch(() => {});
              }
              const info = await bounded(() => stat(outputPath), limits.io);
              if (!info.size) throw new Error('The recording is empty.');
              return { ...result, path: outputPath, bytes: info.size };
            } finally { await close(); }
          })(),
          abort,
        };
      } catch (failure) {
        // Never retain Playwright call arguments, URLs with tokens, or JWTs.
        const reason = String(failure?.message || 'Worker failed').split('\n')[0].replace(/([?&](?:access_token|token|authorization)=)[^&#\s'"]+/gi, '$1[redacted]').replaceAll(credential?.token || '\u0000', '[redacted]').replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[redacted]').slice(0, 240);
        await deadline(() => onProgress(`failure: ${reason}`), limits.io).catch(() => {});
        stopped = true; stopping = Promise.resolve(); await close(); throw failure;
      }
    },
  };
}
