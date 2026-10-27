export type AvatarSelection = { kind: 'default' | 'initials' | 'preset' | 'upload'; presetId?: string; imageUrl?: string; version?: string };
export function avatarInitials(name: string) {
  return name.trim().split(/\s+/u).filter(Boolean).slice(0, 2).map(part => Array.from(part)[0]).join('').toLocaleUpperCase() || 'T';
}
// Future renderers can implement this contract; static avatars never acquire media.
// Tracking/lip sync/filters must be explicit, consent-based providers in a later phase.
export interface AvatarRendererCapabilities { animated: boolean; requiresCamera: boolean; requiresMicrophone: boolean }
export const staticAvatarCapabilities: AvatarRendererCapabilities = { animated: false, requiresCamera: false, requiresMicrophone: false };
