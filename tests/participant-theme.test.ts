import test from 'node:test';
import assert from 'node:assert/strict';
import { participantTheme } from '../frontend/src/lib/participantTheme';

test('A–Z receive distinct stable participant colours, independent of case and whitespace', () => {
  const themes = Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ', letter => {
    const theme = participantTheme(`${letter} Person`);
    assert.equal(theme.key, letter);
    assert.deepEqual(participantTheme(`  ${letter.toLowerCase()} Other Name  `), theme);
    assert.ok(theme.hue >= 0 && theme.hue < 360);
    return theme.hue;
  });
  assert.equal(new Set(themes).size, 26);
});

test('Accented, Unicode and empty names get a safe deterministic theme', () => {
  assert.deepEqual(participantTheme('Éva'), participantTheme('Eva'));
  assert.deepEqual(participantTheme(''), participantTheme('Talk member'));
  for (const name of ['निखिल', '张伟', '🙂 Guest', '123']) {
    assert.deepEqual(participantTheme(name), participantTheme(name));
    assert.match(participantTheme(name).key, /^[A-Z]$/);
  }
});
