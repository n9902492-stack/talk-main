import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { expect } from '@playwright/test';
import { localSfu } from './helpers/local-sfu.mjs';
import { meetingHarness, connected, count, stats } from './helpers/live-meeting.mjs';

const sfu = await localSfu();
let h;
try {
  const directory = await fs.mkdtemp(path.resolve('artifacts/qa/participant-theme-'));
  h = await meetingHarness({ livekitConfig: sfu.config, databasePath: path.join(directory, 'fixture.sqlite'), frontendBuild: 'artifacts/qa/participant-theme-build', lowResourceMedia: true });
  const alice = await h.member('ThemeAlice'), nikhil = await h.member('ThemeNikhil', 660);
  const session = await (await alice.context.request.get(h.origin + '/api/auth/session')).json();
  const saved = await alice.context.request.post(h.origin + '/api/auth/profile/avatar', {
    headers: { Origin: h.origin, 'X-CSRF-Token': session.csrfToken }, data: { kind: 'preset', presetId: 'talk-2' },
  });
  assert.equal(saved.status(), 200);
  await h.join(alice.page, 'Alice');
  await h.join(nikhil.page, 'Nikhil');
  await count(alice.page, 2); await count(nikhil.page, 2);
  const tile = (page, local) => page.locator(`.live-participant-tile[data-local="${local}"]`);
  const placeholder = (page, local) => tile(page, local).locator('.live-participant-placeholder');
  await expect(placeholder(alice.page, true)).toHaveAttribute('data-avatar-theme', 'A');
  await expect(placeholder(alice.page, false)).toHaveAttribute('data-avatar-theme', 'N');
  await expect(placeholder(nikhil.page, false)).toHaveAttribute('data-avatar-theme', 'A');
  const background = locator => locator.evaluate(element => getComputedStyle(element).backgroundImage);
  assert.equal(await background(placeholder(alice.page, true)), await background(placeholder(nikhil.page, false)));
  assert.notEqual(await background(placeholder(alice.page, true)), await background(placeholder(alice.page, false)));
  await expect(tile(nikhil.page, false).locator('[data-avatar-preset="talk-2"] img')).toBeVisible();
  assert.equal(await tile(nikhil.page, false).locator('img').evaluate(img => img.complete && img.naturalWidth > 0), true);
  const initialBackground = await background(placeholder(alice.page, false));
  for (const theme of ['Dark', 'Light']) {
    await alice.page.getByRole('button', { name: theme, exact: true }).click();
    assert.equal(await background(placeholder(alice.page, false)), initialBackground);
    const contrast = await placeholder(alice.page, false).evaluate(element => {
      const avatar = element.querySelector('.talk-avatar'), canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1; const ctx = canvas.getContext('2d');
      const luminance = colour => {
        ctx.fillStyle = colour; ctx.fillRect(0, 0, 1, 1);
        const rgb = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).map(c => { c /= 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; });
        return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
      };
      const style = getComputedStyle(avatar);
      return (luminance(style.color) + .05) / (luminance(style.backgroundColor) + .05);
    });
    assert.ok(contrast >= 4.5, `Initial text must have accessible contrast: ${contrast}`);
  }
  await alice.page.screenshot({ path: 'artifacts/qa/participant-theme-desktop.png' });
  await alice.page.getByRole('button', { name: 'Close meeting panel', exact: true }).click();
  await alice.page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await alice.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await alice.page.screenshot({ path: 'artifacts/qa/participant-theme-mobile.png' });
  await alice.page.setViewportSize({ width: 1440, height: 1000 });
  await alice.page.getByRole('button', { name: 'Enable camera', exact: true }).click();
  await expect(tile(nikhil.page, false).locator('video')).not.toHaveClass(/is-hidden/, { timeout: 30000 });
  await expect.poll(async () => (await stats(nikhil.page)).frames, { timeout: 30000 }).toBeGreaterThan(0);
  await expect(placeholder(nikhil.page, false)).toHaveCount(0);
  await alice.page.getByRole('button', { name: 'Turn camera off', exact: true }).click();
  await expect(placeholder(nikhil.page, false)).toHaveAttribute('data-avatar-theme', 'A');
  await connected(alice.page); await connected(nikhil.page);
  assert.deepEqual(h.errors, []);
  await fs.writeFile('artifacts/qa/participant-theme-results.json', JSON.stringify({ passed: true, localTwoBrowserLiveKit: true, matchingRemotePalette: true, differentInitialColours: true, presetPicturePreserved: true, lightAndDarkContrast: true, mobile: true, cameraTransportAndToggle: true }, null, 2));
  console.log('PASS: participant colours match across real local browsers; distinct initials, profile pictures, light/dark contrast, mobile and camera transport/toggling verified. Isolated SQLite/SFU only.');
} finally {
  if (h) await h.close();
  await sfu.stop();
}
