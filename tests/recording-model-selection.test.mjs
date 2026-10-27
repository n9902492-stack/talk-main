import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createLocalTranscriber } from '../backend/src/recording-transcriber.mjs';

// Command-boundary fixtures verify routing/cancellation, not speech accuracy.
// Actual English/Hindi recognition has separate public-human-speech evidence.
async function fixture(t, { detected = 'hi', cancelDetection = false, missingHindi = false, englishOverride = false } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'talk-asr-model-test-'));
  t.after(async () => { if (path.resolve(directory).startsWith(path.join(path.resolve(os.tmpdir()), 'talk-asr-model-test-'))) await fs.rm(directory, { recursive: true, force: true }); });
  const executable = path.join(directory, 'fixture-whisper'), base = path.join(directory, 'base-model'), hindi = path.join(directory, 'hindi-model'), input = path.join(directory, 'input.webm');
  for (const filename of [executable, base, input, ...(missingHindi ? [] : [hindi])]) await fs.writeFile(filename, 'ISOLATED COMMAND FIXTURE');
  const english = path.join(directory,'english-accuracy-model');if(englishOverride)await fs.writeFile(english,'ENGLISH ACCURACY MODEL FIXTURE');
  const calls = [], controller = new AbortController();
  const worker = createLocalTranscriber({ NODE_ENV: 'production', FFMPEG_PATH: 'fixture-ffmpeg', WHISPER_EXECUTABLE: executable, WHISPER_MODEL_PATH: base, WHISPER_HINDI_MODEL_PATH: hindi, WHISPER_THREADS: '2', ...(englishOverride?{WHISPER_ENGLISH_MODEL_PATH:english}:{}) }, { runCommand: (command, args, options) => {
    calls.push({ command, args, options });
    return (async () => {
      if (command === 'fixture-ffmpeg') { await fs.writeFile(args.at(-1), 'NORMALIZED AUDIO FIXTURE'); return {}; }
      if (args.includes('-dl')) {
        if (cancelDetection) { queueMicrotask(() => controller.abort()); await new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new Error('fixture cancelled')), { once: true })); }
        return { stderr: `whisper_full_with_state: auto-detected language: ${detected} (p = 0.98)`, stdout: '' };
      }
      const language = args[args.indexOf('-l') + 1];
      await fs.writeFile(args[args.indexOf('-of') + 1] + '.json', JSON.stringify({ result: { language }, transcription: [{ offsets: { from: 0, to: 1000 }, text: language === 'hi' ? 'हिंदी परीक्षण' : 'English fixture' }] }));
      return {};
    })();
  } });
  return { worker, input, base, hindi, english, calls, controller, recognize: language => worker.transcribe({ inputPath: input, language, signal: controller.signal }) };
}

test('English accuracy override preserves timing preparation and never translates speech',async t=>{
  const h=await fixture(t,{englishOverride:true});await h.recognize('en');
  assert.equal(h.calls[1].args[h.calls[1].args.indexOf('-m')+1],h.english);
  assert.ok(h.calls[0].args.includes('aresample=async=1:first_pts=0'));
  assert.ok(!h.calls[1].args.includes('-tr')&&!h.calls[1].args.includes('--translate'));
});

test('explicit English respects the global model override without an extra language-detection pass', async t => {
  const h = await fixture(t), result = await h.recognize('en');
  assert.equal(result.language, 'en'); assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].args[h.calls[1].args.indexOf('-m') + 1], h.base);
  assert.ok(!h.calls[1].args.includes('--prompt'));
});
test('explicit Hindi selects the accuracy model and preserves honest speaker attribution', async t => {
  const h = await fixture(t), result = await h.recognize('hi');
  assert.equal(result.language, 'hi'); assert.equal(result.segments[0].speaker, null);
  assert.equal(h.calls.length, 2); assert.equal(h.calls[1].args[h.calls[1].args.indexOf('-m') + 1], h.hindi);
  assert.equal(h.calls[1].options.signal, h.controller.signal);
});
for (const detected of ['en', 'hi']) test(`automatic ${detected} detection selects the appropriate model without transcribing with the wrong model first`, async t => {
  const h = await fixture(t, { detected }), result = await h.recognize('auto');
  assert.equal(result.language, detected); assert.equal(h.calls.length, 3);
  assert.ok(h.calls[1].args.includes('-dl'));
  assert.equal(h.calls[1].args[h.calls[1].args.indexOf('-m') + 1], h.base);
  const args = h.calls[2].args;
  assert.equal(args[args.indexOf('-m') + 1], detected === 'hi' ? h.hindi : h.base);
  assert.equal(args[args.indexOf('-l') + 1], detected);
});
test('cancelling automatic detection prevents recognition and removes the private normalized copy', async t => {
  const h = await fixture(t, { cancelDetection: true });
  await assert.rejects(h.recognize('auto'), /cancelled/);
  assert.equal(h.calls.length, 2);
  await assert.rejects(fs.stat(path.dirname(h.calls[0].args.at(-1))), { code: 'ENOENT' });
});
test('an explicitly missing Hindi model fails with a sanitized error instead of silently falling back', async t => {
  const h = await fixture(t, { missingHindi: true });
  await assert.rejects(h.recognize('hi'), error => /could not transcribe/.test(error.message) && !error.message.includes(h.hindi));
  assert.equal(h.calls.length, 1);
});
