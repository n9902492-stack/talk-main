import { recordingClientBundle } from '../backend/src/recording-client-bundle.mjs';
await recordingClientBundle({ prepare: true });
console.log('Recording client prepared locally. No credentials, meeting data or external requests were used.');
