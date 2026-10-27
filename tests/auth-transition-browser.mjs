import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import express from 'express';
import { chromium } from '@playwright/test';
import { localChrome } from '../scripts/browser-options.mjs';

const directory = 'artifacts/qa/auth-transition';
let origin = process.env.TALK_TEST_URL;
let server;
if (!origin) {
  const app = express();
  app.use(express.static(path.resolve(process.env.TALK_TEST_FRONTEND_BUILD||'frontend/dist')));
  app.get('*', (_req, res) => res.sendFile(path.resolve(process.env.TALK_TEST_FRONTEND_BUILD||'frontend/dist','index.html')));
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  origin = `http://127.0.0.1:${server.address().port}`;
}
const baseline = process.argv.includes('--baseline');
await fs.mkdir(directory, { recursive: true });
const browser = await chromium.launch({ ...localChrome(), headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
// Visual tests do not sign in to Google or send email/SMS. Authentication flows
// are covered separately by the existing real-backend browser suites.
await context.route('**/api/auth/session', route => route.fulfill({ json: { user: null } }));
await context.route('**/api/auth/config', route => route.fulfill({ json: { configured: true, clientId: 'visual.apps.googleusercontent.com', csrfToken: 'visual', nonce: 'visual' } }));
await context.route('https://accounts.google.com/gsi/client', route => route.fulfill({ contentType: 'text/javascript', body: `window.google={accounts:{id:{initialize(){},disableAutoSelect(){},renderButton(host){const b=document.createElement('button');b.textContent='G';b.type='button';b.style.cssText='width:40px;height:40px;border:1px solid #dadce0;border-radius:50%';b.setAttribute('aria-label','Continue with Google');host.replaceChildren(b)}}}};` }));
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
async function settled() {
  await page.getByText('Use your Google account to continue to Talk.', { exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.waitForFunction(() => {
    if (document.querySelector('.auth-transition-forms[data-changing="true"]')) return false;
    return [...document.querySelectorAll('.auth-transition > .signin-visual, .auth-transition > .auth-transition-forms')].every(element => {
      element.getBoundingClientRect(); // Flush pending measurements before checking transition state.
      return element.getAnimations().every(animation => animation.playState !== 'running' && animation.playState !== 'pending');
    });
  });
}
async function metrics() {
  return page.evaluate(() => {
    const selectors = ['.signin-visual', '.signin-globe', '.signin-visual-copy h2', '.signin-visual-copy > p', '.signin-brand', '.signin-eyebrow', '.signin-card', '.signin-card h1', '.signin-card-description', '.field-label', '.form-input', '.signin-submit', '.auth-phone-option'];
    return Object.fromEntries(selectors.map(selector => {
      const element = [...document.querySelectorAll(selector)].find(el => el.checkVisibility() && getComputedStyle(el).visibility !== 'hidden');
      if (!element) return [selector, null];
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return [selector, { width: rect.width, height: rect.height, x: rect.x, y: rect.y, font: style.font, letterSpacing: style.letterSpacing, color: style.color, background: style.background, border: style.border, padding: style.padding, margin: style.margin }];
    }));
  });
}
try {
  if (baseline) {
    const snapshots = {};
    for (const width of [1440, 900, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const path of ['sign-in', 'sign-up']) {
        await page.goto(`${origin}/${path}`, { waitUntil: 'domcontentloaded' });
        await settled();
        snapshots[`${width}/${path}`] = await metrics();
        await page.screenshot({ path: `${directory}/before-${width}-${path}.png`, fullPage: true });
      }
    }
    await fs.writeFile(`${directory}/baseline.json`, JSON.stringify(snapshots, null, 2));
    console.log('Captured original sign-in/sign-up styles and screenshots at desktop, tablet and mobile widths.');
  } else {
    const checks = [];
    // Explicit shared-theme expectations replace the old independent auth palette.
    for (const { width, height } of [{ width: 1440, height: 900 }, { width: 1366, height: 768 }, { width: 1280, height: 720 }, { width: 900, height: 768 }, { width: 390, height: 844 }, { width: 360, height: 740 }]) {
      await page.setViewportSize({ width, height });
      for (const path of ['sign-in', 'sign-up']) {
        await page.goto(`${origin}/${path}`, { waitUntil: 'domcontentloaded' });
        await settled();
        const after = await metrics();
        await fs.writeFile(`${directory}/styles-${width}x${height}-${path}.json`, JSON.stringify(after, null, 2));
        assert.equal(await page.locator('.auth-transition-forms').evaluate(el => getComputedStyle(el).opacity), '1', 'Active form is fully opaque');
        const theme = await page.evaluate(() => {
          const selectors = ['.signin-visual', '.signin-visual-copy h2', '.signin-visual-copy > p', '.signin-brand', '.signin-eyebrow', '.signin-card', '.signin-card h1', '.signin-card-description', '.form-input', '.signin-submit'];
          return Object.fromEntries(selectors.map(selector => {
            const style = getComputedStyle(document.querySelector(selector));
            return [selector, { color: style.color, background: style.background, backgroundColor:style.backgroundColor,backgroundImage:style.backgroundImage }];
          }));
        });
        for (const [selector, style] of Object.entries(theme)) {
          const colors={'.signin-visual':'rgb(255, 255, 255)','.signin-visual-copy h2':'rgb(255, 255, 255)','.signin-visual-copy > p':'rgb(255, 255, 255)','.signin-brand':'rgb(22, 121, 196)','.signin-eyebrow':'rgb(255, 255, 255)','.signin-card':'rgb(23, 28, 36)','.signin-card h1':'rgb(23, 28, 36)','.signin-card-description':'rgb(102, 112, 133)','.form-input':'rgb(23, 28, 36)','.signin-submit':'rgb(255, 255, 255)'};
          assert.equal(style.color, colors[selector], `${width}x${height}/${path} ${selector} uses the shared theme`);
          if(selector==='.signin-visual')assert.equal(style.backgroundImage,'linear-gradient(100deg, rgb(27, 129, 203), rgb(81, 155, 208) 55%, rgb(136, 191, 226))');
          if(selector==='.signin-card')assert.equal(style.backgroundColor,'rgb(255, 255, 255)');
        }
        const layout = await page.locator('.auth-entry-layout').evaluate(element => {
          const fields = element.querySelector('.auth-entry-fields').getBoundingClientRect();
          const provider = element.querySelector('.auth-entry-providers').getBoundingClientRect();
          const phone = element.querySelector('.auth-phone-option');
          const phoneRect = phone.getBoundingClientRect();
          const phoneIcon = phone.querySelector('svg').getBoundingClientRect();
          const text = [...phone.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
          const range = document.createRange();
          range.selectNodeContents(text);
          const phoneText = range.getBoundingClientRect();
          const form = element.querySelector('form').getBoundingClientRect();
          return { fields: fields.toJSON(), provider: provider.toJSON(), phone: phoneRect.toJSON(), form: form.toJSON(), phoneIcon: phoneIcon.toJSON(), phoneText: phoneText.toJSON(), inputs: [...element.querySelectorAll('.form-input')].map(input => ({ id: input.id, rect: input.getBoundingClientRect().toJSON(), radius: getComputedStyle(input).borderRadius, background: getComputedStyle(input).backgroundColor, bottom: getComputedStyle(input).borderBottomWidth, top: getComputedStyle(input).borderTopWidth })) };
        });
        assert(layout.inputs.every(input => input.radius === '0px' && input.background === 'rgba(0, 0, 0, 0)' && input.bottom === '1px' && input.top === '0px'), `Transparent underlined fields: ${JSON.stringify(layout.inputs)}`);
        assert(layout.provider.x > layout.fields.right, 'Google sign-in stays in the right-hand rail at every tested viewport');
        for (const rect of [layout.form, ...layout.inputs.map(input => input.rect)]) {
          assert(Math.abs(layout.phone.x - rect.x) < 2 && Math.abs(layout.phone.right - rect.right) < 2, 'Phone option aligns with the email form and all field edges');
        }
        assert(Math.abs((layout.phoneIcon.y + layout.phoneIcon.height / 2) - (layout.phoneText.y + layout.phoneText.height / 2)) < 3, 'Phone icon and label are vertically centered together');
        assert(layout.phone.height >= 40, 'Phone option retains a usable touch target');
        assert.equal(await page.getByRole('link', { name: 'Continue with Phone Number', exact: true }).getAttribute('href'), '/phone-sign-in');
        const fit = await page.evaluate(() => ({
          width: innerWidth, height: innerHeight, scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth), scrollHeight: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
          controls: [...document.querySelectorAll('.signin-card, .signin-card h1, .auth-entry-fields, .auth-phone-option, .form-input, .signin-submit, .signin-signup-button, .signin-new-account, .signin-page-footer, .google-signin-host')].filter(element => element.checkVisibility()).map(element => ({ selector: element.id || element.className, ...element.getBoundingClientRect().toJSON() })),
        }));
        assert(fit.scrollWidth <= fit.width + 2 && fit.scrollHeight <= fit.height + 2, `${width}x${height}/${path} fits one screen without document scrolling: ${JSON.stringify(fit)}`);
        for (const control of fit.controls) assert(control.x >= -2 && control.y >= -2 && control.right <= fit.width + 2 && control.bottom <= fit.height + 2, `${width}x${height}/${path} ${control.selector} remains fully within the viewport: ${JSON.stringify(control)}`);
        const visual = after['.signin-visual'], card = after['.signin-card'];
        if (width >= 768) assert(path === 'sign-in' ? visual.x < card.x : card.x < visual.x, 'Expected completed panel positions');
        else assert.equal(await page.locator('.signin-visual').evaluate(element => element.checkVisibility()), false, 'Mobile hides the decorative panel without unmounting its scene');
        assert.equal(await page.locator('.hero-earth-scene').count(), 1, 'Exactly one Earth scene');
        assert.equal(await page.locator('.google-signin').count(), 1, 'Only the visible form owns Google sign-in');
        assert.equal(await page.locator('.auth-transition-view form').count(), 1, 'Only one interactive form is mounted');
        await page.screenshot({ path: `${directory}/after-${width}x${height}-${path}.png`, fullPage: true });
        checks.push(`${width}x${height}/${path}: Talk colors, one-screen fit, phone alignment, underlined fields and Google right rail`);
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${origin}/sign-in`);
    await settled();
    await page.locator('#signin-email').fill('draft@example.com');
    await page.locator('#signin-password').fill('In-memory-only-draft!');
    await page.evaluate(() => {
      window.__talkOriginalScene = document.querySelector('.hero-earth-scene');
      window.__talkOriginalCanvas = document.querySelector('.hero-earth-canvas');
      window.__talkOriginalGlobeHeight = document.querySelector('.signin-globe').getBoundingClientRect().height;
      window.__talkMotionSamples = [];
      window.__talkPathBefore = document.querySelector('.hero-earth-route').getAttribute('d');
      const sample = () => {
        const panel = document.querySelector('.signin-visual');
        window.__talkMotionSamples.push({ x: panel.getBoundingClientRect().x, filter: getComputedStyle(panel).filter, overflow: document.documentElement.scrollWidth > innerWidth + 2, overflowY: document.documentElement.scrollHeight > innerHeight + 2 });
        if (performance.now() - window.__talkMotionStarted < 2500) requestAnimationFrame(sample);
      };
      const start = event => {
        if (!event.target.closest('a[href="/sign-up"]')) return;
        document.removeEventListener('click', start, true);
        window.__talkMotionStarted = performance.now();
        requestAnimationFrame(sample);
      };
      document.addEventListener('click', start, true);
    });
    await page.getByRole('link', { name: 'Sign up', exact: true }).scrollIntoViewIfNeeded();
    const scrollBeforeSwitch = await page.evaluate(() => scrollY);
    await page.getByRole('link', { name: 'Sign up', exact: true }).click();
    await page.waitForURL('**/sign-up');
    await page.waitForTimeout(370);
    await page.screenshot({ path: `${directory}/moving.png` });
    await settled();
    assert.equal(await page.evaluate(() => scrollY), scrollBeforeSwitch, 'Switching forms does not jump to the top');
    const motion = await page.evaluate(() => ({ samples: window.__talkMotionSamples, sameScene: window.__talkOriginalScene === document.querySelector('.hero-earth-scene'), sameCanvas: window.__talkOriginalCanvas === document.querySelector('.hero-earth-canvas'), rotated: window.__talkPathBefore !== document.querySelector('.hero-earth-route').getAttribute('d'), filter: getComputedStyle(document.querySelector('.signin-visual')).filter, focus: document.activeElement?.id }));
    await fs.writeFile(`${directory}/motion-samples.json`, JSON.stringify(motion, null, 2));
    assert(motion.sameScene && motion.sameCanvas && motion.rotated, 'Earth stays mounted and keeps rotating');
    assert(await page.evaluate(() => Math.abs(window.__talkOriginalGlobeHeight - document.querySelector('.signin-globe').getBoundingClientRect().height) < 2), 'Earth retains its size when panels exchange sides');
    assert(motion.samples.some(s => s.filter !== 'none' && s.filter !== 'blur(0px)'), 'Temporary blur during movement');
    assert(motion.samples.some(s => s.x > 30 && s.x < 600), 'Intermediate horizontal positions');
    assert(motion.samples.every(s => !s.overflow), 'No overflow during animation');
    assert(motion.samples.every(s => !s.overflowY), 'No vertical document overflow during animation');
    assert(['none', 'blur(0px)'].includes(motion.filter), 'Sharp at rest');
    assert.equal(motion.focus, 'signup-heading');
    await page.locator('#signup-name').fill('Draft Member');
    await page.locator('.signin-visual-return').getByRole('link', { name: 'Sign in', exact: true }).click();
    await page.waitForURL('**/sign-in');
    await settled();
    assert.equal(await page.locator('#signin-email').inputValue(), 'draft@example.com');
    assert.equal(await page.locator('#signin-password').inputValue(), 'In-memory-only-draft!');
    assert(await page.evaluate(() => window.__talkOriginalCanvas === document.querySelector('.hero-earth-canvas')));
    await page.goBack();
    await settled();
    assert.equal(await page.locator('#signup-name').inputValue(), 'Draft Member');
    await page.goForward();
    await settled();
    assert.equal(new URL(page.url()).pathname, '/sign-in');
    await page.getByRole('link', { name: 'Forgot password?', exact: true }).click();
    await page.waitForURL('**/forgot-password');
    await page.getByRole('heading',{name:'Forgot your password?',exact:true}).waitFor();
    await page.goto(`${origin}/sign-in`);await settled();
    await page.getByRole('link', { name: 'Enter verification code', exact: false }).click();
    await page.waitForURL('**/verify-email');
    await page.goto(`${origin}/sign-up?mode=link`);
    await page.getByRole('heading', { name: 'Add email sign-in.', exact: true }).waitFor();
    checks.push('Reversible slide, temporary blur, continuous Earth rotation, focus, drafts, Back/Forward, verification link and secure linking route');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${origin}/sign-in`);
    await settled();
    await page.getByRole('link', { name: 'Sign up', exact: true }).click();
    await page.waitForURL('**/sign-up');
    assert.equal(await page.locator('.signin-visual').evaluate(el => el.getAnimations().length), 0, 'Reduced motion disables sliding and blur');
    await page.setViewportSize({ width: 390, height: 844 });
    await settled();
    await page.getByRole('link', { name: 'Continue with Phone Number', exact: true }).click();
    await page.waitForURL('**/phone-sign-in');
    await page.getByRole('heading').first().waitFor();
    assert.equal(errors.length, 0, errors.join('\n'));
    checks.push('Reduced motion and mobile phone-auth navigation');
    await fs.writeFile(`${directory}/results.json`, JSON.stringify({ checks, motion: { sameScene: motion.sameScene, sameCanvas: motion.sameCanvas, rotated: motion.rotated, sampledFrames: motion.samples.length }, errors }, null, 2));
    console.log(`Passed ${checks.length} visual/motion/navigation groups. Google SDK and outbound authentication are fixtures in this visual suite.`);
  }
} finally {
  await browser.close();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
