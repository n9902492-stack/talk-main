// Original Talk illustrations, no external avatar service or tracking requests.
export const avatarStyles = ['Cartoon', 'Professional', '3D style'];
export const avatarPresets = avatarStyles.flatMap((style, group) => ['Sky', 'River', 'Ocean', 'Cloud'].map((name, index) => ({
  id: `talk-${group * 4 + index + 1}`, name: `${name} · ${style}`, style,
  src: `/assets/avatars/talk-${group * 4 + index + 1}.svg`,
})));
