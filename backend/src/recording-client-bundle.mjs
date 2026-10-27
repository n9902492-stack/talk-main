import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const source = new URL('./recorder-client.mjs', import.meta.url);
const directory = fileURLToPath(new URL('../dist/recording/', import.meta.url));
// Include the installed SDK and build settings in freshness checks. A stale
// bundle must never silently run different consent/subscription logic.
const fingerprint = async () => createHash('sha256').update(await readFile(source))
  .update(await readFile(new URL('../package.json', import.meta.url)))
  .update(await readFile(new URL('../../package-lock.json', import.meta.url)))
  .update('browser-iife-minify-v1').digest('hex');

export async function recordingClientBundle({ prepare = false, compile = build, cacheDirectory = directory } = {}) {
  const hash = await fingerprint(), filename = path.join(cacheDirectory, `${hash}.js`);
  try {
    const code = await readFile(filename, 'utf8');
    const digest = (await readFile(filename + '.sha256', 'utf8')).trim();
    if (createHash('sha256').update(code).digest('hex') === digest) return code;
  } catch { /* A missing bundle can still be built by unrestricted runtimes. */ }
  let code;
  try {
    code = (await compile({ entryPoints: [fileURLToPath(source)], bundle: true, write: false,
      platform: 'browser', format: 'iife', minify: true, logLevel: 'silent' })).outputFiles[0].text;
  } catch {
    const failure = new Error('The recording client could not be prepared. Run npm run recording:prepare in a normal local terminal, then retry recording.');
    failure.code = 'recording_bundle_failed'; throw failure;
  }
  if (prepare) {
    await mkdir(cacheDirectory, { recursive: true });
    // Hash-addressed files avoid replacing a bundle used by a running worker.
    await writeFile(filename + '.tmp', code, { mode: 0o600 });
    await rename(filename + '.tmp', filename);
    await writeFile(filename + '.sha256', createHash('sha256').update(code).digest('hex'), { mode: 0o600 });
  }
  return code;
}
