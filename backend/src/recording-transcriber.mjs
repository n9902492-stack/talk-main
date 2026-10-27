import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpeg from '@ffmpeg-installer/ffmpeg';
const execute = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function parseWhisperResult(value, language = 'auto') {
  if (!value || !Array.isArray(value.transcription) || value.transcription.length > 30000) throw new Error('The speech worker returned invalid output.');
  const segments = []; let previous = 0;
  for (const item of value.transcription) {
    const start = Number(item.offsets?.from) / 1000, end = Number(item.offsets?.to) / 1000;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < previous || end < start || end > 7202 || typeof item.text !== 'string' || item.text.length > 10000) throw new Error('The speech worker returned invalid timestamps.');
    previous = start; const text = item.text.replace(/\[_[^\]]*\]/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
    if (text && !/^\[(?:BLANK_AUDIO|SILENCE|MUSIC)\]$/i.test(text)) segments.push({ start, end, text, speaker: null });
  }
  const detected = value.result?.language || language;
  return { language: ['en','hi'].includes(detected) ? detected : 'und', segments };
}
export function createLocalTranscriber(env = {}, { runCommand = execute } = {}) {
  const local = env.NODE_ENV !== 'production';
  const executable = env.WHISPER_EXECUTABLE || (local ? path.join(root, 'data/transcription/bin/whisper-cli.exe') : '');
  const model = env.WHISPER_MODEL_PATH || (local ? path.join(root, 'data/transcription/ggml-base.bin') : '');
  const localEnglishModel = path.join(root, 'data/transcription/ggml-small-q5_1.bin');
  const englishModel = env.WHISPER_ENGLISH_MODEL_PATH || (!env.WHISPER_MODEL_PATH && local && existsSync(localEnglishModel) ? localEnglishModel : model);
  const localHindiModel = path.join(root, 'data/transcription/ggml-medium-q5_0.bin');
  const hindiModel = env.WHISPER_HINDI_MODEL_PATH || (!env.WHISPER_MODEL_PATH && local && existsSync(localHindiModel) ? localHindiModel : model);
  const requestedThreads = Number(env.WHISPER_THREADS || 2);
  const threads = Math.max(1, Math.min(4, os.availableParallelism(), Number.isInteger(requestedThreads) ? requestedThreads : 2));
  const configured = !!(executable && model && existsSync(executable) && existsSync(model));
  return {
    configured, reason: configured ? '' : 'Install the local multilingual Whisper executable and model to enable transcription.',
    async transcribe({ inputPath, language = 'auto', signal, onProgress = () => {} }) {
      if (!configured) throw new Error('Local transcription is not configured.');
      if (!['auto','en','hi'].includes(language)) throw new Error('Choose English, Hindi or automatic language detection.');
      signal?.throwIfAborted();
      const input = await stat(inputPath); if (!input.isFile() || input.size <= 0 || input.size > 536870912) throw new Error('Recording is unavailable or exceeds the processing limit.');
      const directory = await mkdtemp(path.join(os.tmpdir(), 'talk-transcribe-'));
      try {
        const wav = path.join(directory, 'audio.wav'), output = path.join(directory, 'transcript');
        await onProgress('preparing_audio');
        const conversion = runCommand(env.FFMPEG_PATH || ffmpeg.path, ['-nostdin','-hide_banner','-loglevel','error','-y','-i',inputPath,'-vn','-af','aresample=async=1:first_pts=0','-t','7200','-ar','16000','-ac','1','-c:a','pcm_s16le',wav], { timeout: 120000, maxBuffer: 65536, windowsHide: true, signal });
        try { if (conversion.child?.pid) os.setPriority(conversion.child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* Best effort on supported hosts. */ }
        await conversion;
        await onProgress('recognizing');
        let spokenLanguage = language;
        // Detect with the lighter model before choosing a Hindi accuracy model.
        // This avoids running the large model for every English meeting when
        // the host keeps the existing automatic-language option selected.
        if (language === 'auto' && hindiModel !== model) {
          const detection = runCommand(executable, ['-m',model,'-f',wav,'-l','auto','-dl','-t',String(threads)], { timeout: 120000, maxBuffer: 2 * 1024 * 1024, windowsHide: true, signal });
          try { if (detection.child?.pid) os.setPriority(detection.child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* Best effort. */ }
          const diagnostic = await detection;
          const detected = /auto-detected language:\s*([a-z]{2,3})(?:\s|$)/i.exec(String(diagnostic.stderr || '') + '\n' + String(diagnostic.stdout || ''))?.[1];
          if (['en','hi'].includes(detected)) spokenLanguage = detected;
        }
        const selectedModel = spokenLanguage === 'hi' ? hindiModel : spokenLanguage === 'en' ? englishModel : model;
        if (!existsSync(selectedModel)) throw new Error('The configured local language model is unavailable.');
        // The process sees only local files; no recording is sent to an AI API.
        const recognition = runCommand(executable, ['-m',selectedModel,'-f',wav,'-l',spokenLanguage,'-oj','-of',output,'-t',String(threads),'-np'], { timeout: 3600000, maxBuffer: 2 * 1024 * 1024, windowsHide: true, signal });
        try { if (recognition.child?.pid) os.setPriority(recognition.child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* Best effort on supported hosts. */ }
        await recognition;
        const info = await stat(output + '.json'); if (info.size > 12 * 1024 * 1024) throw new Error('Transcript output limit exceeded.');
        return parseWhisperResult(JSON.parse(await readFile(output + '.json','utf8')), spokenLanguage);
      } catch (failure) { if (signal?.aborted) throw new Error('Transcription was cancelled.'); throw new Error('The local speech worker could not transcribe this recording.'); }
      finally { if(path.resolve(directory).startsWith(path.join(path.resolve(os.tmpdir()),'talk-transcribe-')))await rm(directory, { recursive: true, force: true }); }
    },
  };
}
