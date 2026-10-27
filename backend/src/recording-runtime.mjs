import { createRecordingStorage } from './recording-storage.mjs';
import { createBrowserRecorder } from './recording-recorder.mjs';
import { createLocalTranscriber } from './recording-transcriber.mjs';

export function createRecordingRuntime({ env = {}, service } = {}) {
  try {
    const storage = createRecordingStorage(env), recorder = createBrowserRecorder({ env, service }), transcriber = createLocalTranscriber(env);
    const enabled = env.RECORDING_PROVIDER !== 'disabled';
    return { configured: enabled && recorder.configured, name: 'Talk server recording', pauseSupported: false, transcriptionDelayMs: 15000,
      reason: !enabled ? 'Recording is disabled by the backend configuration.' : !recorder.configured ? 'Configure a server recording worker before starting capture.' : '', storage, recorder, transcriber };
  } catch { return { configured: false, name: 'Talk server recording', pauseSupported: false, reason: 'Private recording storage or the server recording worker is not configured.' }; }
}
