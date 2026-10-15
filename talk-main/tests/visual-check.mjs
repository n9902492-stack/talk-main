import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
await fs.mkdir('artifacts/qa', { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  const page = await browser.newPage();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    for (const [route, name] of [['/', 'landing'], ['/webinars', 'webinar'], ['/device-test', 'device-test'], ['/meeting', 'meeting']]) {
      await page.goto('http://localhost:3001' + route, { waitUntil: 'domcontentloaded' });
      await page.locator(route === '/' ? '#feature-tabs button' : route === '/webinars' ? '.speakers-section' : route === '/device-test' ? '.camera-preview' : '.room-stage').first().waitFor();
      await page.evaluate(async () => { const images = Array.from(document.images); images.forEach(image => image.loading = 'eager'); await Promise.allSettled(images.map(image => image.decode())); await document.fonts.ready; });
      await page.screenshot({ path: `artifacts/qa/${name}-${width}-viewport.png` });
      if (route === '/') await page.screenshot({ path: `artifacts/qa/${name}-${width}-full.png`, fullPage: true });
      const out = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, width: innerWidth, outside: [...document.querySelectorAll('body *')].map(element => ({ tag: element.tagName, class: element.className?.toString().slice(0, 120), rect: element.getBoundingClientRect(), text: element.textContent?.trim().slice(0, 75) })).filter(item => item.rect.right > innerWidth + 2 && item.rect.width > 20 && item.rect.height > 1).map(({rect,...item}) => ({...item, left:rect.left, right:rect.right, width:rect.width})).slice(0, 20), images: [...document.images].filter(image => !image.naturalWidth).map(image => image.src) }));
      console.log(name, width, JSON.stringify(out));
    }
  }
} finally { await browser.close(); }
