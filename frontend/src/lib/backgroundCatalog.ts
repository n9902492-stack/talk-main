import { hasVideoEffects, normalizeVideoEffects, type VideoEffects } from './videoEffects';
export const backgroundPresets = [
  { id: 'office', name: 'Office', src: '/assets/backgrounds/office.webp' },
  { id: 'nature', name: 'Nature', src: '/assets/backgrounds/nature.webp' },
  { id: 'studio', name: 'Soft studio', src: '/assets/backgrounds/studio.webp' },
  { id: 'coast', name: 'Coast', src: '/assets/backgrounds/coast.webp' },
];
export type BackgroundPreference = { mode: 'none' | 'blur' | 'preset' | 'custom'; blur: number; presetId?: string; customVersion?: string; effects?: VideoEffects };
export const defaultBackground: BackgroundPreference = { mode: 'none', blur: 12 };
export function normalizeBackground(value: unknown): BackgroundPreference {
  if (!value || typeof value !== 'object') return { ...defaultBackground };
  const item = value as Partial<BackgroundPreference>;
  const effects = hasVideoEffects(item.effects) ? { effects: normalizeVideoEffects(item.effects) } : {};
  const blur = Number.isFinite(item.blur) ? Math.max(4, Math.min(24, Math.round(item.blur!))) : 12;
  if (item.mode === 'blur' || item.mode === 'none') return { mode: item.mode, blur, ...effects };
  if (item.mode === 'preset' && backgroundPresets.some(preset => preset.id === item.presetId)) return { mode: 'preset', blur, presetId: item.presetId, ...effects };
  if (item.mode === 'custom' && typeof item.customVersion === 'string' && /^[a-f\d-]{36}$/.test(item.customVersion)) return { mode: 'custom', blur, customVersion: item.customVersion, ...effects };
  return { ...defaultBackground, ...effects };
}
export function hasCameraEffects(preference: BackgroundPreference) { return preference.mode !== 'none' || hasVideoEffects(preference.effects); }
export function backgroundImage(preference: BackgroundPreference) {
  return preference.mode === 'preset' ? backgroundPresets.find(item => item.id === preference.presetId)?.src
    : preference.mode === 'custom' ? `/api/auth/profile/background/image?v=${encodeURIComponent(preference.customVersion || '')}` : undefined;
}
const activePreferences = new Map<string, BackgroundPreference>();
export function readBackground(accountId = 'guest', fromStorage = false): BackgroundPreference {
  if (!fromStorage && activePreferences.has(accountId)) return activePreferences.get(accountId)!;
  try { const preference = normalizeBackground(JSON.parse(localStorage.getItem(`talk-background:${accountId}`) || 'null')); activePreferences.set(accountId,preference); return preference; }
  catch { return activePreferences.get(accountId) || { ...defaultBackground }; }
}
export function saveBackground(accountId: string, value: BackgroundPreference) {
  const preference = normalizeBackground(value);
  activePreferences.set(accountId,preference);
  try { localStorage.setItem(`talk-background:${accountId}`, JSON.stringify(preference)); } catch { /* Active selection still works if browser storage is unavailable. */ }
  window.dispatchEvent(new CustomEvent('talk:background-preference', { detail: { accountId, preference } }));
}
