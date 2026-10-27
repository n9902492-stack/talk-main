import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpeg from '@ffmpeg-installer/ffmpeg';
import { createLocalTranscriber } from '../backend/src/recording-transcriber.mjs';
import { hindiSpeechFixture } from './fetch-hindi-speech-fixture.mjs';

// Public human-read speech only. No credentials, meeting audio, cloud speech
// service, generated transcript or synthetic voice is used by this check.
const execute = promisify(execFile);
const directory = path.resolve('artifacts/qa');
await mkdir(directory, { recursive: true });
const requested = process.argv.find(argument => argument.startsWith('--language='))?.split('=')[1] || 'all';
assert.ok(['en', 'hi', 'all'].includes(requested), 'Use --language=en, --language=hi, or --language=all.');
function recognitionQuality(reference, actual) {
  const normalize = value => value.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
  const distance = (left, right) => {
    let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
    for (let i = 0; i < left.length; i++) {
      const next = [i + 1];
      for (let j = 0; j < right.length; j++) next[j + 1] = Math.min(next[j] + 1, previous[j + 1] + 1, previous[j] + (left[i] === right[j] ? 0 : 1));
      previous = next;
    }
    return previous[right.length];
  };
  const expected = normalize(reference), recognized = normalize(actual);
  return { characterErrorRate: distance([...expected], [...recognized]) / [...expected].length, wordErrorRate: distance(expected.split(' '), recognized.split(' ')) / expected.split(' ').length };
}
const sources = [
  {
    language: 'en', filename: 'jfk-transcription-fixture.wav',
    url: 'https://raw.githubusercontent.com/ggml-org/whisper.cpp/v1.9.2/samples/jfk.wav',
    sourcePage: 'https://github.com/ggml-org/whisper.cpp/tree/v1.9.2/samples',
    attribution: 'John F. Kennedy, 1961 inaugural address; official whisper.cpp sample.',
    license: 'Public-domain US federal government speech recording.', limit: 2 * 1024 * 1024,
    reference: 'And so my fellow Americans ask not what your country can do for you, ask what you can do for your country.',
    validate(text, quality) { assert.match(text, /country/i, 'English speech must be recognized, not merely produce a file.'); assert.ok(quality.characterErrorRate <= 0.15 && quality.wordErrorRate <= 0.25, 'English recognition must match the actual reference speech.'); },
  },
  {
    language: 'hi', filename: 'hindi-fleurs-human-sample.wav',
    url: 'https://storage.googleapis.com/xtreme_translations/FLEURS102/hi_in.tar.gz',
    sourcePage: 'https://huggingface.co/datasets/google/fleurs',
    member: 'hi_in/audio/dev/14930148530444438904.wav',
    attribution: 'Google FLEURS, Hindi (hi_in), human-read speech.',
    license: 'CC-BY-4.0',
    limit: 10 * 1024 * 1024,
    reference: 'आम तौर पर सैटेलाइट फोन को मोबाइल फोन के स्थान पर उपयोग नहीं किया जा सकता है, क्योंकि सैटेलाइट फोन से कॉल करने के लिए आपको उपग्रह की रेखा पर घर के बाहर रहना पड़ेगा।',
    validate(text, quality) {
      assert.ok((text.match(/[\u0900-\u097f]/g) || []).length >= 12, 'Human Hindi speech must yield meaningful Devanagari text.');
      // Character/word edit distance measures the complete known utterance,
      // rather than allowing an unrelated Hindi hallucination to pass.
      // Both ceilings also reject the previously tested small model output.
      assert.ok(quality.characterErrorRate <= 0.15 && quality.wordErrorRate <= 0.4, 'Hindi recognition must adequately match the actual FLEURS reference speech.');
    },
  },
].filter(source => requested === 'all' || source.language === requested);

async function cachedFixture(source) {
  if (source.language === 'hi') return hindiSpeechFixture(directory);
  const filename = path.join(directory, source.filename);
  try { if ((await stat(filename)).size > 1000) return filename; } catch { /* Download only a missing public fixture. */ }
  const response = await fetch(source.url, { headers: source.range ? { Range: source.range } : {}, signal: AbortSignal.timeout(45000) });
  if (!response.ok || !response.body) throw new Error(`Public ${source.language} human speech fixture could not be downloaded (${response.status}).`);
  const chunks = []; let length = 0;
  for await (const chunk of response.body) {
    const bytes = Buffer.from(chunk), remaining = source.limit - length;
    chunks.push(bytes.subarray(0, remaining)); length += Math.min(remaining, bytes.length);
    if (length >= source.limit) break;
  }
  assert.ok(length > 1000, 'The public speech sample is empty.');
  await writeFile(filename, Buffer.concat(chunks));
  return filename;
}

const transcriber = createLocalTranscriber({ WHISPER_THREADS: '2' });
assert.ok(transcriber.configured, 'Install the existing local multilingual Whisper executable and model first.');
const evidence = { passed: false, actualLocalWhisper: true, humanSpeechFixtures: true, microphoneHardwareTest: false, paidServices: false, threads: 2, samples: [] };
try {
  // Sequential checks use the backend's two-thread default, never competing jobs.
  for (const source of sources) {
    const input = await cachedFixture(source), normalized = path.join(directory, `real-${source.language}-speech-16k.wav`);
    await execute(ffmpeg.path, ['-nostdin', '-v', 'error', '-y', '-i', input, '-t', '30', '-vn', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', normalized], { timeout: 30000, windowsHide: true, maxBuffer: 65536 });
    const inputBytes = await readFile(normalized), durationSeconds = (inputBytes.length - 44) / (16000 * 2);
    const began = performance.now(), stages = [];
    const result = await transcriber.transcribe({ inputPath: normalized, language: source.language, onProgress: stage => { stages.push({ stage, elapsedMs: Math.round(performance.now() - began) }); } });
    const durationMs = Math.round(performance.now() - began), text = result.segments.map(segment => segment.text).join(' ');
    // Preserve actual model output before assertions so a failed language or
    // quality check remains diagnosable instead of losing its evidence.
    const { validate, ...metadata } = source;
    const sample = { ...metadata, validated: false, quality: recognitionQuality(source.reference, text), normalizedFilename: path.relative(process.cwd(), normalized), sha256: createHash('sha256').update(inputBytes).digest('hex'), audioDurationSeconds: durationSeconds, processingMs: durationMs, realTimeFactor: Number((durationMs / (durationSeconds * 1000)).toFixed(2)), stages, result };
    evidence.samples.push(sample);
    source.validate(text, sample.quality);
    assert.equal(result.language, source.language);
    assert.ok(result.segments.length > 0);
    assert.ok(result.segments.every(segment => segment.speaker === null), 'Mixed speech must not invent a participant identity.');
    assert.ok(result.segments.every((segment, index) => Number.isFinite(segment.start) && segment.start >= 0 && segment.end >= segment.start && segment.end <= durationSeconds + 2 && (index === 0 || segment.start >= result.segments[index - 1].start)), 'Recognized segments need ordered in-range timestamps.');
    sample.validated = true;
    console.log(`PASS real local Whisper ${source.language}: ${result.segments.length} timestamped segment(s), ${durationMs}ms, unknown speakers preserved.`);
  }
  evidence.passed = true;
} catch (failure) {
  evidence.error = failure instanceof Error ? failure.message : 'Local human-speech verification failed.';
  process.exitCode = 1;
  console.error('FAIL real local transcription:', evidence.error);
} finally {
  await writeFile(path.join(directory, requested === 'all' ? 'real-transcription-results.json' : `real-transcription-${requested}-results.json`), JSON.stringify(evidence, null, 2));
}
