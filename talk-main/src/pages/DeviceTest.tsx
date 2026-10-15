import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Video, VideoOff, Mic, MicOff, Volume2, Check, ShieldCheck, Play, Square, Settings2, UserRound } from 'lucide-react';
import { useMediaPreview } from '../hooks/useMediaPreview';

export default function DeviceTest() {
  const media = useMediaPreview();
  const [name, setName] = useState(sessionStorage.getItem('talk-name') || '');
  const [speakerPassed, setSpeakerPassed] = useState(false);
  const [speakerTesting, setSpeakerTesting] = useState(false);
  const [speakerError, setSpeakerError] = useState('');
  const [recording, setRecording] = useState(false);
  const [sample, setSample] = useState('');
  const [recordError, setRecordError] = useState('');
  const recorder = useRef<MediaRecorder | null>(null);
  const sampleRef = useRef('');
  const audioRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speakerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); if (speakerTimerRef.current) clearTimeout(speakerTimerRef.current); if (recorder.current?.state === 'recording') { recorder.current.onstop = null; recorder.current.stop(); } if (sampleRef.current) URL.revokeObjectURL(sampleRef.current); void audioRef.current?.close().catch(() => {}); }, []);
  const speakerTest = async () => {
    setSpeakerError(''); setSpeakerTesting(true);
    try {
      const context = new AudioContext(); audioRef.current = context; await context.resume();
      for (let i = 0; i < 3; i++) { const oscillator = context.createOscillator(); const gain = context.createGain(); oscillator.connect(gain); gain.connect(context.destination); oscillator.frequency.value = [440, 554, 659][i]; const start = context.currentTime + i * 0.35; gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(0.12, start + 0.02); gain.gain.exponentialRampToValueAtTime(0.001, start + 0.25); oscillator.start(start); oscillator.stop(start + 0.3); }
      speakerTimerRef.current = setTimeout(() => { setSpeakerTesting(false); void context.close().catch(() => {}); }, 1300);
    } catch { setSpeakerError('Audio playback is unavailable. Check your browser and output device.'); setSpeakerTesting(false); }
  };
  const record = () => {
    if (recording) { recorder.current?.stop(); if (timerRef.current) clearTimeout(timerRef.current); return; }
    setRecordError('');
    if (!media.stream?.getAudioTracks().length || !media.micOn) { setRecordError('Enable your microphone before recording a test.'); return; }
    if (typeof MediaRecorder === 'undefined') { setRecordError('This browser does not support recording. Use the microphone level meter instead.'); return; }
    try {
      const instance = new MediaRecorder(new MediaStream(media.stream.getAudioTracks())); recorder.current = instance;
      const chunks: BlobPart[] = [];
      instance.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      instance.onstop = () => { if (sampleRef.current) URL.revokeObjectURL(sampleRef.current); const url = URL.createObjectURL(new Blob(chunks, { type: instance.mimeType })); sampleRef.current = url; setSample(url); setRecording(false); };
      instance.start(); setRecording(true); timerRef.current = setTimeout(() => { if (instance.state === 'recording') instance.stop(); }, 5000);
    } catch { setRecordError('Unable to record a sample. Check that your microphone is available.'); }
  };
  const join = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!name.trim()) { event.preventDefault(); nameRef.current?.setCustomValidity('Enter your name to join'); nameRef.current?.reportValidity(); nameRef.current?.setCustomValidity(''); return; }
    sessionStorage.setItem('talk-name', name.trim());
  };
  return <section className="device-page page-width py-12 md:py-16"><a href="/" className="back-link"><ArrowLeft size={16} />Back to home</a>
    <div className="device-heading"><span className="eyebrow">YOUR SPACE. YOUR STAGE.</span><h1>Let’s get you ready.</h1><p>Check your camera and audio before you step into the session.</p></div>
    <div className="device-grid"><div>
      <div className="camera-preview"><video ref={media.videoRef} autoPlay playsInline muted className={media.cameraOn ? 'visible' : 'invisible'} aria-label="Your camera preview" />{!media.cameraOn && <div className="camera-placeholder"><span className="preview-avatar">{name.trim().slice(0, 1).toUpperCase() || <UserRound size={42} />}</span><h3>Your camera is off</h3><p>Enable your camera to see your preview.</p></div>}<div className="preview-name">{name.trim() || 'You'}<span>Preview</span></div><div className="camera-controls"><button aria-label={media.micOn ? 'Mute microphone' : 'Enable microphone'} aria-pressed={media.micOn} onClick={media.toggleMic}>{media.micOn ? <Mic size={21} /> : <MicOff size={21} />}</button><button aria-label={media.cameraOn ? 'Turn camera off' : 'Enable camera'} aria-pressed={media.cameraOn} onClick={media.toggleCamera}>{media.cameraOn ? <Video size={21} /> : <VideoOff size={21} />}</button></div></div>
      <div className="camera-under"><ShieldCheck size={16} /><span>Your preview stays on this device.</span><button onClick={media.stop} disabled={!media.stream}>Stop devices</button></div>
      <label className="field-label mt-6" htmlFor="display-name">Your display name</label><input ref={nameRef} id="display-name" className="form-input" value={name} onChange={event => setName(event.target.value)} placeholder="Enter your name" maxLength={80} required />
    </div><aside className="device-settings"><div className="flex items-center gap-2 mb-6"><Settings2 size={19} /><h2 className="text-lg font-bold">Audio & video settings</h2></div>
      <button className="primary-button w-full justify-center mb-5" disabled={media.busy} onClick={() => void media.enable()}>{media.busy ? 'Connecting devices…' : 'Enable camera & microphone'}</button>
      {media.error && <p role="alert" className="inline-error mb-5">{media.error}</p>}
      <div className="device-setting"><label htmlFor="camera-select"><Video size={17} />Camera<span className={media.cameraOn ? 'device-ok' : ''}>{media.cameraOn ? 'Ready' : 'Off'}</span></label><select id="camera-select" value={media.cameraId} disabled={!media.stream || recording} onChange={event => void media.enable(true, media.micOn, event.target.value, media.micId)}><option value="">Default camera</option>{media.devices.filter(device => device.kind === 'videoinput').map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Camera ${index + 1}`}</option>)}</select></div>
      <div className="device-setting"><label htmlFor="mic-select"><Mic size={17} />Microphone<span className={media.micOn ? 'device-ok' : ''}>{media.micOn ? 'Ready' : 'Off'}</span></label><select id="mic-select" value={media.micId} disabled={!media.stream || recording} onChange={event => void media.enable(media.cameraOn, true, media.cameraId, event.target.value)}><option value="">Default microphone</option>{media.devices.filter(device => device.kind === 'audioinput').map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Microphone ${index + 1}`}</option>)}</select><div className="audio-meter" aria-label="Microphone input level" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(media.micOn ? media.level : 0)}>{Array.from({ length: 24 }, (_, index) => <span key={index} className={media.micOn && media.level > index * 4 ? 'lit' : ''} />)}</div><p className="text-xs text-secondary">Speak a little. The bars move when your microphone picks up sound.</p></div>
      <div className="device-setting"><label><Volume2 size={17} />Speaker<span className={speakerPassed ? 'device-ok' : ''}>{speakerPassed ? 'Checked' : 'Not tested'}</span></label><p className="text-sm text-secondary mb-3">Uses your system’s selected audio output.</p><button className="secondary-button w-full justify-center" disabled={speakerTesting} onClick={() => void speakerTest()}><Volume2 size={16} />{speakerTesting ? 'Playing test sound…' : 'Play test sound'}</button><button className="text-xs underline text-primary mt-3" onClick={() => setSpeakerPassed(true)}><Check size={13} className="inline mr-1" />I can hear the sound</button>{speakerError && <p role="alert" className="inline-error mt-2">{speakerError}</p>}</div>
      <div className="device-setting border-0"><button className="secondary-button w-full justify-center" onClick={record}>{recording ? <Square size={15} /> : <Mic size={15} />}{recording ? 'Stop recording' : 'Record a 5-second mic test'}</button>{recording && <p className="text-xs text-primary mt-2" role="status">Recording… say something into your microphone.</p>}{recordError && <p role="alert" className="inline-error mt-2">{recordError}</p>}{sample && <audio controls src={sample} className="w-full mt-3" aria-label="Play your microphone test" />}</div>
    </aside></div>
    <div className="join-row"><div><h3 className="font-bold">Social Media Marketing Workshop</h3><p className="text-sm text-secondary mt-1">Talk session preview · Join when you’re ready</p></div><a href="/meeting" className="primary-button" onClick={join}>Join session<ArrowRight size={17} /></a></div>
  </section>;
}
