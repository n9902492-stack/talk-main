import { Room, RoomEvent, Track, VideoQuality } from 'livekit-client';

// Finish the processed capture inputs, then wait for MediaRecorder's final
// dataavailable + stop events. Stopping the browser before this settles loses
// the tail of the encoder output (and can leave Chromium's canvas encoder busy).
export async function flushRecorderOutput(recorder, output, { timeoutMs = 20000 } = {}) {
  let deadline, onStop, onError;
  const flushed = recorder.state === 'inactive' ? Promise.resolve() : new Promise((resolve, reject) => {
    onStop = resolve;
    onError = () => reject(new Error('The recording encoder failed while stopping.'));
    recorder.addEventListener('stop', onStop, { once: true });
    recorder.addEventListener('error', onError, { once: true });
    deadline = setTimeout(() => reject(new Error('The recording encoder did not finish in time.')), timeoutMs);
  });
  try {
    // requestData preserves already encoded data; stop produces the final tail.
    if (recorder.state === 'recording') recorder.requestData();
    for (const track of output.getTracks()) track.stop();
    if (recorder.state !== 'inactive') recorder.stop();
    await flushed;
  } finally {
    clearTimeout(deadline);
    if (onStop) recorder.removeEventListener('stop', onStop);
    if (onError) recorder.removeEventListener('error', onError);
    // Also release all generated tracks if requestData/stop threw.
    for (const track of output.getTracks()) if (track.readyState !== 'ended') track.stop();
  }
}

// Runs only in a server-controlled browser. No host microphone or display capture.
if (typeof window !== 'undefined') window.startTalkRecorder = async ({ url, token, mode, allowedIdentities }) => {
  let allowed = new Set(allowedIdentities), stopped = false, stopping, bytes = 0;
  // A headless silent sink uses a software timer. Interactive-size render
  // quanta can be shorter than Windows' timer resolution, causing the audio
  // sample clock to lag wall-clock video and leaving holes in WebM audio.
  // Buffer for continuous playback instead of interactive device monitoring.
  // The silent sink still prevents meeting audio reaching physical speakers.
  const audio = new AudioContext({ sampleRate: 48000, latencyHint: 0.1, sinkId: { type: 'none' } }); await audio.resume();
  // Dedicated subscriber transport is required for a read-only token. Use the
  // same silent AudioContext for LiveKit playout and the recording mixer.
  const room = new Room({ adaptiveStream: false, dynacast: false, singlePeerConnection: false, webAudioMix: { audioContext: audio } });
  const destination = audio.createMediaStreamDestination();
  // Keep overlapping voices from clipping the mixed recording.
  const mixer = audio.createDynamicsCompressor();
  mixer.threshold.value = -3; mixer.knee.value = 3; mixer.ratio.value = 12;
  mixer.attack.value = 0.003; mixer.release.value = 0.2; mixer.connect(destination);
  const sources = new Map(), videos = new Map(), audioElements = new Map();
  const choices = new WeakMap();
  let captureAudioStart, captureWallStart;
  const diagnostics = () => ({ audioState: audio.state, audioClock: audio.currentTime,
    audioElapsedMs: Math.round((audio.currentTime - captureAudioStart) * 1000),
    captureElapsedMs: Math.round(performance.now() - captureWallStart),
    audioBaseLatencyMs: Math.round(audio.baseLatency * 1000),
    encoding: { width: 1280, height: 720, frameRate: 15, videoBitsPerSecond: 4500000, audioBitsPerSecond: 128000 },
    audioSources: sources.size, videoSources: videos.size, videoDimensions: [...videos.values()].map(v => ({ width: v.element.videoWidth, height: v.element.videoHeight })), allowed: allowed.size, publications: [...room.remoteParticipants.values()].flatMap(person => [...person.trackPublications.values()].map(pub => ({ kind: pub.kind, allowed: allowed.has(person.identity), subscribed: pub.isSubscribed, enabled: pub.track?.mediaStreamTrack?.enabled, muted: pub.track?.mediaStreamTrack?.muted, publishedMuted: pub.isMuted }))) });
  const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
  const context = canvas.getContext('2d', { alpha: false });
  // Keep a silent track alive even when everyone is muted.
  const silence = audio.createOscillator(), zero = audio.createGain(); zero.gain.value = 0;
  silence.connect(zero).connect(destination); silence.start();
  const detach = sid => { sources.get(sid)?.disconnect(); sources.delete(sid); const playback = audioElements.get(sid); if (playback) { playback.track.detach(playback.element); playback.element.pause(); playback.element.srcObject = null; playback.element.remove(); audioElements.delete(sid); } const video = videos.get(sid)?.element; if (video) { video.pause(); video.srcObject = null; } videos.delete(sid); };
  const subscribe = (publication, participant) => {
    if (stopped) return;
    const permitted = allowed.has(participant.identity) && (mode === 'video' || publication.kind === Track.Kind.Audio);
    if (permitted && publication.kind === Track.Kind.Video) publication.setVideoQuality(VideoQuality.HIGH);
    if (choices.get(publication) !== permitted) { choices.set(publication, permitted); publication.setSubscribed(permitted); }
  };
  room.on(RoomEvent.TrackPublished, subscribe);
  room.on(RoomEvent.ParticipantConnected, person => person.trackPublications.forEach(pub => subscribe(pub, person)));
  room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
    if (!allowed.has(participant.identity) || stopped) { publication.setSubscribed(false); return; }
    if (track.kind === Track.Kind.Audio) {
      if (sources.has(publication.trackSid)) return;
      // Attach through LiveKit so Chromium starts the remote audio renderer.
      // Web Audio sends playout to the silent sink, never to physical speakers.
      const element = track.attach(); element.autoplay = true; element.hidden = true; document.body.append(element); void element.play().catch(() => {});
      audioElements.set(publication.trackSid, { element, track });
      const source = audio.createMediaStreamSource(new MediaStream([track.mediaStreamTrack])); source.connect(mixer); sources.set(publication.trackSid, source);
    }
    else if (mode === 'video') { const element = document.createElement('video'); element.autoplay = true; element.muted = true; element.playsInline = true; element.srcObject = new MediaStream([track.mediaStreamTrack]); void element.play().catch(() => {}); videos.set(publication.trackSid, { element, name: participant.name || 'Participant', share: publication.source === Track.Source.ScreenShare }); }
  });
  room.on(RoomEvent.TrackUnsubscribed, (_track, pub) => detach(pub.trackSid));
  room.on(RoomEvent.ParticipantDisconnected, person => person.trackPublications.forEach(pub => detach(pub.trackSid)));
  // A subscribe-only participant must request its allowed tracks while the
  // initial subscriber peer connection is being negotiated, not after connect.
  const subscribeKnown = () => room.remoteParticipants.forEach(person => person.trackPublications.forEach(pub => subscribe(pub, person)));
  room.on(RoomEvent.SignalConnected, subscribeKnown);
  const subscribing = setInterval(subscribeKnown, 100);
  try { await room.connect(url, token, { autoSubscribe: false, maxRetries: 1, websocketTimeout: 12000, peerConnectionTimeout: 15000 }); }
  finally { clearInterval(subscribing); }
  room.remoteParticipants.forEach(person => person.trackPublications.forEach(pub => subscribe(pub, person)));
  const warmupDeadline = performance.now() + 5000;
  while (performance.now() < warmupDeadline) {
    const expected = [...room.remoteParticipants.values()].filter(person => allowed.has(person.identity)).flatMap(person => [...person.trackPublications.values()]).filter(pub => !pub.isMuted && (mode === 'video' || pub.kind === Track.Kind.Audio));
    const ready = expected.every(pub => pub.kind === Track.Kind.Audio ? audioElements.get(pub.trackSid)?.element.readyState >= 2 : videos.get(pub.trackSid)?.element.readyState >= 2 && videos.get(pub.trackSid)?.element.videoWidth >= Math.min(1280, pub.dimensions?.width || 1));
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const draw = () => {
    context.fillStyle = '#171c24'; context.fillRect(0, 0, 1280, 720);
    const all = [...videos.values()], visible = all.some(v => v.share) ? [...all.filter(v => v.share), ...all.filter(v => !v.share)].slice(0, 32) : all.slice(0, 32);
    const cols = Math.ceil(Math.sqrt(Math.max(1, visible.length))), rows = Math.ceil(Math.max(1, visible.length) / cols);
    visible.forEach((item, index) => {
      const width = 1280 / cols, height = 720 / rows, x = index % cols * width, y = Math.floor(index / cols) * height;
      const video = item.element;
      if (video.readyState >= 2) { const scale = Math.min((width - 12) / video.videoWidth, (height - 12) / video.videoHeight); const w = video.videoWidth * scale, h = video.videoHeight * scale; context.drawImage(video, x + (width - w) / 2, y + (height - h) / 2, w, h); }
      context.fillStyle = '#171c24dd'; context.fillRect(x + 8, y + height - 40, Math.min(width - 16, 280), 32);
      context.fillStyle = '#ffffff'; context.font = '20px sans-serif'; context.fillText(item.name.slice(0, 60), x + 16, y + height - 17, Math.min(width - 32, 264));
    });
    context.fillStyle = '#171c24dd'; context.fillRect(1044, 8, 228, 28);
    context.fillStyle = '#ffffff'; context.font = '14px sans-serif'; context.fillText('Talk · Meeting recording', 1056, 27);
  };
  draw(); const ticker = mode === 'video' ? setInterval(draw, 1000 / 15) : undefined;
  const videoStream = mode === 'video' ? canvas.captureStream(15) : null;
  const output = new MediaStream([...destination.stream.getAudioTracks(), ...(videoStream?.getVideoTracks() || [])]);
  const mimeType = mode === 'video' ? 'video/webm;codecs=vp8,opus' : 'audio/webm;codecs=opus';
  if (!MediaRecorder.isTypeSupported(mimeType)) throw new Error('Recording encoding is unavailable.');
  const recorder = new MediaRecorder(output, { mimeType, videoBitsPerSecond: 4500000, audioBitsPerSecond: 128000 });
  let pending = Promise.resolve(), transportFailure;
  recorder.ondataavailable = event => { if (event.data.size) pending = pending.then(async () => { const buffer = new Uint8Array(await event.data.arrayBuffer()); bytes += buffer.length; let binary = ''; for (let i = 0; i < buffer.length; i += 8192) binary += String.fromCharCode(...buffer.subarray(i, i + 8192)); await window.writeTalkRecording(btoa(binary)); }).catch(() => { transportFailure = true; void window.failTalkRecording('storage_failed'); }); };
  const started = performance.now();
  captureAudioStart = audio.currentTime; captureWallStart = started;
  room.on(RoomEvent.Disconnected, () => { if (!stopped) void window.failTalkRecording('recorder_disconnected'); });
  room.on(RoomEvent.Reconnecting, () => { if (!stopped) void window.failTalkRecording('recorder_disconnected'); });
  recorder.onerror = () => void window.failTalkRecording('encoder_failed');
  recorder.start(1000);
  window.updateTalkRecordingAllowed = identities => {
    allowed = new Set(identities);
    room.remoteParticipants.forEach(person => person.trackPublications.forEach(pub => { if (!allowed.has(person.identity)) detach(pub.trackSid); subscribe(pub, person); }));
  };
  window.stopTalkRecorder = () => stopping ||= (async () => {
    const captureDiagnostics = diagnostics();
    stopped = true; clearInterval(ticker);
    const finished = performance.now();
    try {
      await flushRecorderOutput(recorder, output);
      // onstop runs after final dataavailable, so pending includes the final
      // bridge write as well as every earlier chunk.
      await pending;
    } finally {
      room.remoteParticipants.forEach(person => person.trackPublications.forEach(pub => detach(pub.trackSid)));
      silence.stop(); output.getTracks().forEach(track => track.stop());
      let cleanupDeadline;
      try { await Promise.race([Promise.allSettled([room.disconnect(), audio.close()]), new Promise(resolve => { cleanupDeadline = setTimeout(resolve, 3000); })]); }
      finally { clearTimeout(cleanupDeadline); }
    }
    if (transportFailure) throw new Error('Recording could not be stored.');
    return { bytes, mimeType: mode === 'audio' ? 'audio/webm' : 'video/webm', durationMs: Math.round(finished - started), diagnostics: captureDiagnostics };
  })();
  return { mimeType: mode === 'audio' ? 'audio/webm' : 'video/webm' };
};
