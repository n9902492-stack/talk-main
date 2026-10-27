import { useEffect, useId, useRef, useState } from 'react';
import type { TrackEvent, LocalVideoTrack } from 'livekit-client';
import { RotateCcw, Upload } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useBackgroundPreference } from '../hooks/useBackgroundPreference';
import { backgroundImage, backgroundPresets } from '../lib/backgroundCatalog';
import { supportsCameraBackgrounds, type BackgroundStatus } from '../lib/cameraBackground';
import { defaultVideoEffects, filterPresets, normalizeVideoEffects, supportsNativeFraming, supportsVideoAppearance, type VideoEffects } from '../lib/videoEffects';
import '../styles/backgrounds.css';

export type VideoSettingsSection = 'backgrounds' | 'appearance' | 'filters' | 'studio';
export const videoSettingsSections: { id: VideoSettingsSection; name: string }[] = [
  { id: 'backgrounds', name: 'Backgrounds' }, { id: 'appearance', name: 'Appearance' },
  { id: 'filters', name: 'Video Filters' }, { id: 'studio', name: 'Studio Effects' },
];

function CameraEffectPreview({ track }: { track: LocalVideoTrack | null }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = video.current; if (!element || !track) return;
    const event = 'trackProcessorUpdate' as TrackEvent.TrackProcessorUpdate;
    const attach = () => { track.attach(element); element.muted = true; void element.play().catch(() => {}); }; attach(); track.on(event, attach);
    return () => { track.off(event, attach); track.detach(element); element.srcObject = null; };
  }, [track]);
  return <div className="talk-background-preview"><video ref={video} autoPlay muted playsInline aria-label="Background effect camera preview" />{!track && <span>Turn on your camera to preview</span>}</div>;
}

// Original vector illustration. These thumbnails illustrate the colour treatment;
// the camera preview above shows the effect on the actual outgoing video.
function FilterThumbnail({ filter }: { filter: VideoEffects['filter'] }) {
  return <span className="talk-filter-thumbnail" style={{ filter: filterPresets.find(item => item.id === filter)?.previewFilter }} aria-hidden="true"><svg viewBox="0 0 160 96" focusable="false"><path fill="#abc9d7" d="M0 0h160v96H0z" /><path fill="#e8ddd0" d="M104 0h56v96h-56z" /><path fill="#eaf1f4" d="M114 9h36v48h-36z" /><path fill="#82a995" d="M5 96V68l18-29 17 27v30z" /><path fill="#487b71" d="M12 96V56l16 17 6 23z" /><path fill="#506c87" d="M43 96q4-35 37-35t37 35z" /><path fill="#ca9b80" d="M68 53h25v22H68z" /><ellipse fill="#e6b497" cx="80" cy="41" rx="23" ry="28" /><path fill="#352f36" d="M57 41q-6-34 21-34 31-1 25 38l-8-23q-15 11-37 8z" /><path fill="#6a4c44" d="M66 40h5m19 0h5" stroke="#6a4c44" strokeWidth="2" strokeLinecap="round" /><path d="M73 54q8 5 15 0" stroke="#a87069" strokeWidth="2" strokeLinecap="round" fill="none" /></svg></span>;
}

const appearanceControls: { key: keyof VideoEffects['appearance']; name: string; min: number; max: number; step: number; unit?: string }[] = [
  { key: 'brightness', name: 'Brightness', min: 50, max: 150, step: 1, unit: '%' },
  { key: 'contrast', name: 'Contrast', min: 50, max: 150, step: 1, unit: '%' },
  { key: 'saturation', name: 'Saturation', min: 0, max: 200, step: 1, unit: '%' },
  { key: 'warmth', name: 'Warmth', min: -50, max: 50, step: 1 },
  { key: 'smoothing', name: 'Skin smoothing', min: 0, max: 30, step: 1, unit: '%' },
];
const studioControls: { key: keyof VideoEffects['studio']; name: string; description: string }[] = [
  { key: 'autoLight', name: 'Automatic lighting enhancement', description: 'Balances exposure using the brightness of your camera frames.' },
  { key: 'lowLight', name: 'Low-light adjustment', description: 'Gently lifts shadow detail in dim surroundings.' },
  { key: 'portraitLight', name: 'Soft portrait lighting', description: 'Adds subtle, centre-weighted lighting. No face tracking.' },
  { key: 'enhance', name: 'Subtle appearance enhancement', description: 'Combines gentle tonal adjustment with subtle, skin-tone-aware softening.' },
  { key: 'autoFrame', name: 'Automatic camera framing', description: 'Uses your browser and camera’s native framing capability, when available.' },
];

export default function BackgroundSettings({ track = null, sourceTrack, enabled, status, prejoin = false, section, showTabs = true }: {
  track?: LocalVideoTrack | null; enabled: boolean; status: BackgroundStatus; prejoin?: boolean;
  sourceTrack?: MediaStreamTrack | null; section?: VideoSettingsSection; showTabs?: boolean;
}) {
  const { user, uploadBackground } = useAuth(); const { preference, select } = useBackgroundPreference();
  const descriptionPrefix = useId();
  const [supported, setSupported] = useState<boolean | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [custom, setCustom] = useState('');
  const [selectedSection, setSelectedSection] = useState<VideoSettingsSection>('backgrounds');
  const activeSection = section || selectedSection;
  const effects = normalizeVideoEffects(preference.effects);
  const [canvasSupported] = useState(supportsVideoAppearance);
  const [framingSupported, setFramingSupported] = useState(false);
  useEffect(() => {
    const update = () => {
      const processor = track?.getProcessor() as { getSourceTrack?: () => MediaStreamTrack | undefined } | undefined;
      const camera = sourceTrack === undefined ? processor ? processor.getSourceTrack?.() : track?.mediaStreamTrack : sourceTrack;
      try { setFramingSupported(!!camera && camera.readyState === 'live' && supportsNativeFraming(camera)); }
      catch { setFramingSupported(false); }
    };
    update();
    const changed = 'trackProcessorUpdate' as TrackEvent.TrackProcessorUpdate, restarted = 'restarted' as TrackEvent.Restarted;
    track?.on(changed, update).on(restarted, update);
    return () => { track?.off(changed, update).off(restarted, update); };
  }, [track, sourceTrack, enabled]);
  useEffect(() => { let active = true; void supportsCameraBackgrounds().then(value => { if (active) setSupported(value); }); return () => { active = false; }; }, []);
  useEffect(() => { let active = true; if (user) void fetch('/api/auth/profile/background', { credentials: 'same-origin', cache: 'no-store' }).then(async r => r.ok ? r.json() : null).then(value => { if (active && value?.version) setCustom(value.version); }).catch(() => {}); return () => { active = false; }; }, [user?.id]);
  const chooseEffects = (value: VideoEffects) => select({ ...preference, effects: normalizeVideoEffects(value) });
  const upload = async (file?: File) => {
    if (!file) return; setError('');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 2097152 || !file.size) { setError('Choose a still JPEG, PNG or WebP image under 2 MB.'); return; }
    setBusy(true); try { const saved = await uploadBackground(file); setCustom(saved.version); select({ ...preference, mode: 'custom', customVersion: saved.version }); } catch (failure) { setError(failure instanceof Error ? failure.message : 'The background could not be uploaded.'); } finally { setBusy(false); }
  };
  const title = activeSection === 'backgrounds' ? 'Camera backgrounds' : videoSettingsSections.find(item => item.id === activeSection)!.name;
  return <section className="talk-background-settings" aria-label={activeSection === 'backgrounds' ? 'Camera backgrounds' : title}>
    {showTabs && <div className="talk-settings-tabs talk-effects-tabs" role="group" aria-label="Camera effects sections">{videoSettingsSections.map(item => <button key={item.id} aria-pressed={activeSection === item.id} onClick={() => setSelectedSection(item.id)}>{item.name}</button>)}</div>}
    <h3>{title}</h3><p>{prejoin ? 'See each effect in your existing camera preview.' : 'Your preview and outgoing camera use the same effects.'}</p>
    {!prejoin && <CameraEffectPreview track={enabled ? track : null} />}
    {activeSection === 'backgrounds' && <>
      {supported === false && <p role="status">Background effects are unavailable on this browser or device. None keeps your regular camera working.</p>}
      <div className="talk-background-grid" role="group" aria-label="Background choices">
        <button aria-pressed={preference.mode === 'none'} onClick={() => select({ ...preference, mode: 'none' })}>None</button>
        <button disabled={supported !== true || busy} aria-pressed={preference.mode === 'blur'} onClick={() => select({ ...preference, mode: 'blur' })}><span className="talk-blur-swatch" aria-hidden="true" />Blur</button>
        {backgroundPresets.map(preset => <button key={preset.id} disabled={supported !== true || busy} aria-pressed={preference.mode === 'preset' && preference.presetId === preset.id} onClick={() => select({ ...preference, mode: 'preset', presetId: preset.id })}><img src={preset.src} alt="" />{preset.name}</button>)}
        {custom && <button disabled={supported !== true || busy} aria-pressed={preference.mode === 'custom'} onClick={() => select({ ...preference, mode: 'custom', customVersion: custom })}><img src={backgroundImage({ mode: 'custom', blur: 12, customVersion: custom })} alt="" />Custom</button>}
      </div>
      {preference.mode === 'blur' && <label className="talk-blur-control">Blur strength <output>{preference.blur}</output><input type="range" aria-label="Blur strength" min={4} max={24} step={2} value={preference.blur} onChange={event => select({ ...preference, blur: Number(event.target.value) })} /></label>}
      <label className="talk-background-upload"><Upload size={16} /> {busy ? 'Uploading…' : 'Upload background'}<input aria-label="Upload background image" type="file" accept="image/jpeg,image/png,image/webp" disabled={!user || supported !== true || busy} onChange={event => { void upload(event.target.files?.[0]); event.target.value = ''; }} /></label>
      <p>{user ? 'One private custom background, stored with your Talk account. A new upload replaces it.' : 'Sign in to upload a custom background.'} Still JPEG, PNG or WebP · Up to 2 MB and 10 megapixels.</p>
    </>}
    {activeSection === 'appearance' && <>
      <div className="talk-appearance-controls">{appearanceControls.map(control => <label className="talk-blur-control" key={control.key}>{control.name}<output>{effects.appearance[control.key]}{control.unit}</output><input type="range" aria-label={control.name} min={control.min} max={control.max} step={control.step} value={effects.appearance[control.key]} disabled={!canvasSupported} onChange={event => chooseEffects({ ...effects, appearance: { ...effects.appearance, [control.key]: Number(event.target.value) } })} /></label>)}</div>
      <button className="talk-effects-reset" onClick={() => chooseEffects({ ...effects, appearance: { ...defaultVideoEffects.appearance } })}><RotateCcw size={14} />Reset to Default</button>
      <p>Subtle smoothing uses skin-tone and edge-aware colour processing, without face detection. Warmth adjusts colour temperature from cooler to warmer.</p>
    </>}
    {activeSection === 'filters' && <>
      <div className="talk-background-grid talk-filter-grid" role="group" aria-label="Video filter choices">{filterPresets.map(preset => <button key={preset.id} disabled={!canvasSupported && preset.id !== 'none'} aria-pressed={effects.filter === preset.id} onClick={() => chooseEffects({ ...effects, filter: preset.id })}><FilterThumbnail filter={preset.id} />{preset.name}</button>)}</div>
      <p>Original illustrated thumbnails preview each colour treatment. Use your camera preview to check the result with your lighting.</p>
    </>}
    {activeSection === 'studio' && <>
      <div className="talk-studio-controls">{studioControls.map(control => <label className="talk-studio-option" key={control.key}><input type="checkbox" aria-label={control.name} aria-describedby={`${descriptionPrefix}-${control.key}`} checked={effects.studio[control.key]} disabled={control.key === 'autoFrame' ? !framingSupported : !canvasSupported} onChange={event => chooseEffects({ ...effects, studio: { ...effects.studio, [control.key]: event.target.checked } })} /><span><strong>{control.name}</strong><span id={`${descriptionPrefix}-${control.key}`}>{control.description}</span>{control.key === 'autoFrame' && !framingSupported && <span className="talk-effect-unavailable">Unavailable on this browser or camera.</span>}</span></label>)}</div>
      <p>Lighting and appearance effects use local frame processing, without facial tracking or an AI model. Native automatic framing depends on browser and camera support.</p>
    </>}
    {activeSection !== 'backgrounds' && !canvasSupported && <p role="status">Video processing is unavailable on this browser. Your regular camera remains available.</p>}
    <button className="talk-effects-reset talk-effects-reset-all" onClick={() => select({ mode: 'none', blur: 12 })}><RotateCcw size={14} />Reset All Effects</button>
    <p role="status" data-background-state={status.state}>{enabled || status.state === 'error' || status.state === 'unsupported' ? status.message : 'Selection saved. Turn on your camera to preview.'}</p>{status.processingMs !== undefined && enabled && <p>Processing: about {status.processingMs} ms per frame on this device.</p>}
    {error && <p role="alert" className="talk-background-error">{error}</p>}
    <p>Preferences stay on this browser for your next meeting. Processing happens on your device. Results vary with lighting, movement and device performance.</p>
  </section>;
}
