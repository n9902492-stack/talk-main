export type VideoEffects = {
  filter: 'none' | 'black-white' | 'warm' | 'cool' | 'vintage' | 'cinematic' | 'soft-glow' | 'high-contrast' | 'natural';
  appearance: { brightness: number; contrast: number; saturation: number; warmth: number; smoothing: number };
  studio: { autoLight: boolean; lowLight: boolean; portraitLight: boolean; enhance: boolean; autoFrame: boolean };
};
export const defaultVideoEffects: VideoEffects = {
  filter: 'none', appearance: { brightness: 100, contrast: 100, saturation: 100, warmth: 0, smoothing: 0 },
  studio: { autoLight: false, lowLight: false, portraitLight: false, enhance: false, autoFrame: false },
};
export const filterPresets: { id: VideoEffects['filter']; name: string; previewFilter: string }[] = [
  { id: 'none', name: 'None', previewFilter: 'none' },
  { id: 'black-white', name: 'Black & White', previewFilter: 'grayscale(1)' },
  { id: 'warm', name: 'Warm', previewFilter: 'sepia(.25) saturate(1.15)' },
  { id: 'cool', name: 'Cool', previewFilter: 'hue-rotate(12deg) saturate(.9)' },
  { id: 'vintage', name: 'Vintage', previewFilter: 'sepia(.35) contrast(.9)' },
  { id: 'cinematic', name: 'Cinematic', previewFilter: 'contrast(1.15) saturate(.8)' },
  { id: 'soft-glow', name: 'Soft Glow', previewFilter: 'brightness(1.08) contrast(.92)' },
  { id: 'high-contrast', name: 'High Contrast', previewFilter: 'contrast(1.35)' },
  { id: 'natural', name: 'Natural', previewFilter: 'saturate(1.08) contrast(1.03)' },
];
export function normalizeVideoEffects(value: unknown): VideoEffects {
  const result: VideoEffects = { ...defaultVideoEffects, appearance: { ...defaultVideoEffects.appearance }, studio: { ...defaultVideoEffects.studio } };
  if (!value || typeof value !== 'object') return result;
  const item = value as Partial<VideoEffects>;
  if (filterPresets.some(preset => preset.id === item.filter)) result.filter = item.filter!;
  for (const [key, min, max] of [['brightness', 50, 150], ['contrast', 50, 150], ['saturation', 0, 200], ['warmth', -50, 50], ['smoothing', 0, 30]] as const) {
    const number = item.appearance?.[key];
    if (typeof number === 'number' && Number.isFinite(number)) result.appearance[key] = Math.round(Math.max(min, Math.min(max, number)));
  }
  for (const key of Object.keys(result.studio) as (keyof VideoEffects['studio'])[]) result.studio[key] = item.studio?.[key] === true;
  return result;
}
export function hasVideoEffects(value: unknown) { return JSON.stringify(normalizeVideoEffects(value)) !== JSON.stringify(defaultVideoEffects); }
export function supportsVideoAppearance() {
  if (typeof window === 'undefined' || !window.isSecureContext || typeof OffscreenCanvas === 'undefined' || typeof VideoFrame === 'undefined') return false;
  const gl = new OffscreenCanvas(2, 2).getContext('webgl2');
  const supported = !!gl; gl?.getExtension('WEBGL_lose_context')?.loseContext(); return supported;
}
type FramingConstraints = MediaTrackConstraints & { faceFraming?: boolean; autoFraming?: boolean };
export function supportsNativeFraming(track?: MediaStreamTrack) {
  if (typeof navigator === 'undefined') return false;
  const supported = navigator.mediaDevices?.getSupportedConstraints() as Record<string, boolean> | undefined;
  const capabilities = track?.getCapabilities?.() as Record<string, unknown> | undefined;
  return ['faceFraming', 'autoFraming'].some(key => supported?.[key] && Array.isArray(capabilities?.[key]) && (capabilities[key] as boolean[]).includes(true));
}
export async function applyNativeFraming(track: MediaStreamTrack, enabled: boolean) {
  const capabilities = (track.getCapabilities?.() || {}) as Record<string, unknown>;
  const supported = (navigator.mediaDevices.getSupportedConstraints?.() || {}) as Record<string, boolean>;
  const key = ['faceFraming', 'autoFraming'].find(key => supported[key] && Array.isArray(capabilities[key]) && (capabilities[key] as boolean[]).includes(true));
  if (!key) { if (enabled) throw new Error('Automatic camera framing is not supported by this camera.'); return; }
  await track.applyConstraints({ ...track.getConstraints(), [key]: enabled } as FramingConstraints);
  if (enabled && (track.getSettings() as Record<string, unknown>)[key] !== true) throw new Error('The camera could not enable automatic framing.');
}
