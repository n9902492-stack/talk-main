// A stable, local palette: each Latin initial has its own hue on every device.
// Accented initials share their base letter; other scripts get a stable fallback.
export function participantTheme(name: string) {
  const initial = Array.from(name.trim())[0] || 'T';
  const letter = initial.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase();
  const index = /^[A-Z]$/.test(letter)
    ? letter.charCodeAt(0) - 65
    : Array.from(initial).reduce((sum, character) => sum + character.codePointAt(0)!, 0) % 26;
  return { key: String.fromCharCode(65 + index), hue: (210 + index * 137) % 360 };
}
