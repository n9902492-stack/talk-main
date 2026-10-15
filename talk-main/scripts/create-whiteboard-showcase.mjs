import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';
import ffmpeg from '@ffmpeg-installer/ffmpeg';

// Original silent collaboration demo, drawn locally without footage or external assets.
// Reproduce from the project root: node scripts/create-whiteboard-showcase.mjs
const WIDTH = 1600, HEIGHT = 640, FPS = 24, DURATION = 15;
const output = path.resolve('public/reference');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'talk-whiteboard-showcase-'));
await fs.mkdir(output, { recursive: true });
let browser;

function encode(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg.path, args, { windowsHide: true });
    let log = '';
    child.stderr.on('data', chunk => { log = (log + chunk.toString()).slice(-18000); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(log) : reject(new Error(log)));
  });
}

try {
  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--disable-gpu'] });
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
  await page.setContent(`<html><body style="margin:0"><canvas width="${WIDTH}" height="${HEIGHT}"></canvas></body></html>`);
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const c = canvas.getContext('2d');
    const p = { bg: '#fbf8f2', ink: '#272827', muted: '#777c75', gold: '#c79817', sage: '#268a76', purple: '#7961c7', pink: '#d36894', line: '#dadccf', white: '#ffffff' };
    let bounds = [];
    const clamp = t => Math.max(0, Math.min(1, t));
    const ease = t => { t = clamp(t); return t * t * (3 - 2 * t); };
    const mix = (a, b, t) => a + (b - a) * t;
    function box(x, y, w, h, fill, radius = 18, stroke = null) {
      c.beginPath(); c.roundRect(x, y, w, h, radius);
      if (fill) { c.fillStyle = fill; c.fill(); }
      if (stroke) { c.strokeStyle = stroke; c.lineWidth = 2; c.stroke(); }
    }
    function circle(x, y, r, fill, stroke = null, width = 2) {
      c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2);
      if (fill) { c.fillStyle = fill; c.fill(); }
      if (stroke) { c.strokeStyle = stroke; c.lineWidth = width; c.stroke(); }
    }
    function text(value, x, y, size = 32, color = p.ink, weight = 500, maxWidth = 1450, align = 'left') {
      c.font = `${weight} ${size}px "Segoe UI", sans-serif`;
      c.textAlign = align; c.textBaseline = 'top'; c.fillStyle = color;
      const width = c.measureText(value).width;
      if (width > maxWidth + 1) throw new Error(`Text exceeds box: ${value} (${width} > ${maxWidth})`);
      const left = align === 'center' ? x - width / 2 : align === 'right' ? x - width : x;
      bounds.push({ value, x: left, y, width, height: size * 1.2 });
      c.fillText(value, x, y);
    }
    function line(x1, y1, x2, y2, color = p.line, width = 3) {
      c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.strokeStyle = color; c.lineWidth = width; c.lineCap = 'round'; c.stroke();
    }
    function check(x, y, color = p.sage, width = 4, progress = 1) {
      const first = clamp(progress * 2), second = clamp(progress * 2 - 1);
      line(x - 13, y, mix(x - 13, x - 3, first), mix(y, y + 9, first), color, width);
      if (second) line(x - 3, y + 9, mix(x - 3, x + 17, second), mix(y + 9, y - 12, second), color, width);
    }
    function connector(x1, y, x2, progress) {
      const f = ease(progress);
      if (!f) return;
      const end = mix(x1, x2, f);
      line(x1, y, end, y, p.sage, 5);
      if (f > 0.9) { line(x2 - 12, y - 9, x2, y, p.sage, 5); line(x2 - 12, y + 9, x2, y, p.sage, 5); }
    }
    function sticky(x, y, w, h, fill, headline, detail, alpha = 1) {
      if (alpha <= 0) return;
      c.save(); c.globalAlpha = alpha;
      c.shadowColor = '#33332212'; c.shadowBlur = 12; c.shadowOffsetY = 5;
      box(x, y, w, h, fill, 9);
      c.shadowBlur = 0; c.shadowOffsetY = 0;
      text(headline, x + 23, y + 20, 32, p.ink, 650, w - 46);
      text(detail, x + 23, y + 65, 30, p.muted, 450, w - 46);
      c.restore();
    }
    const paths = {
      Sarah: [[0, 164, 402], [0.7, 158, 247], [2.0, 158, 247], [3.6, 326, 405], [5.3, 221, 388], [8, 302, 429], [10.4, 305, 489], [12.6, 395, 377], [15, 164, 402]],
      Mateo: [[0, 617, 390], [2, 618, 241], [3.8, 618, 241], [5.2, 735, 273], [7.4, 730, 404], [10, 761, 490], [12, 701, 383], [15, 617, 390]],
      Lin: [[0, 1067, 392], [3.8, 934, 240], [5.6, 934, 240], [6.7, 840, 275], [8.7, 1050, 385], [11, 975, 270], [12.9, 946, 366], [15, 1067, 392]],
      Alex: [[0, 976, 534], [5.9, 950, 497], [6.9, 890, 474], [8.8, 536, 474], [9.8, 539, 474], [11.3, 822, 368], [13, 996, 547], [15, 976, 534]],
    };
    const colors = { Sarah: p.gold, Mateo: p.purple, Lin: p.sage, Alex: p.pink };
    function cursor(name, t) {
      const stops = paths[name];
      const index = stops.findIndex((stop, i) => i < stops.length - 1 && t >= stop[0] && t < stops[i + 1][0]);
      const a = stops[Math.max(0, index)], b = stops[Math.max(0, index) + 1] || a;
      const f = ease((t - a[0]) / Math.max(0.001, b[0] - a[0]));
      const x = mix(a[1], b[1], f), y = mix(a[2], b[2], f), color = colors[name];
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + 2, y + 31); c.lineTo(x + 12, y + 23); c.lineTo(x + 20, y + 37); c.lineTo(x + 27, y + 33); c.lineTo(x + 19, y + 19); c.lineTo(x + 32, y + 18); c.closePath();
      c.fillStyle = color; c.fill(); c.lineWidth = 2; c.strokeStyle = p.white; c.stroke();
      c.font = '600 30px "Segoe UI", sans-serif';
      const labelWidth = c.measureText(name).width + 26;
      const labelX = x > 990 ? x - labelWidth - 7 : x + 29;
      box(labelX, y + 25, labelWidth, 41, color, 9);
      text(name, labelX + 13, y + 27, 30, p.white, 600, labelWidth - 26);
    }
    function pulse(x, y, t, at, color) {
      const f = (t - at) / 0.8;
      if (f <= 0 || f >= 1) return;
      c.save(); c.globalAlpha = 1 - f;
      circle(x, y, 14 + 28 * f, null, color, 4);
      c.restore();
    }
    window.drawWhiteboard = t => {
      bounds = [];
      c.fillStyle = p.bg; c.fillRect(0, 0, 1600, 640);
      c.fillStyle = '#a9aa9329';
      for (let x = 24; x < 1600; x += 32) for (let y = 16; y < 640; y += 32) circle(x, y, 1.4, '#a9aa9329');
      // Existing page labels occupy the top 90px. The lower-right stays clear for its offer card.
      text('Launch & onboarding', 66, 102, 44, p.ink, 700, 860);
      box(1219, 110, 315, 48, '#eee8db', 14);
      text('Whiteboard demo', 1376.5, 114, 30, '#746243', 600, 293, 'center');
      line(64, 171, 1536, 171, '#deded1', 2);

      const columns = [
        { x: 72, name: '01  Idea', tint: '#fff3c8' },
        { x: 447, name: '02  Prototype', tint: '#ece7fb' },
        { x: 822, name: '03  Ready', tint: '#def1e7' },
      ];
      columns.forEach(({ x, name, tint }) => {
        box(x, 197, 318, 192, '#ffffffd9', 20, '#e5e2d8');
        box(x + 14, 207, 290, 45, tint, 11);
        text(name, x + 33, 211, 32, p.ink, 600, 260);
      });
      sticky(93, 267, 276, 99, '#fff0b5', 'Find the spark', 'Gather ideas', ease((t - 0.85) / 0.5));
      sticky(468, 267, 276, 99, '#e6dffd', 'Build together', 'Try a prototype', ease((t - 2.6) / 0.5));
      sticky(843, 267, 276, 99, '#d7eddf', 'Launch as one', 'Ready for release', ease((t - 4.6) / 0.5));
      connector(395, 292, 439, (t - 3.9) / 0.7);
      connector(770, 292, 814, (t - 5.7) / 0.7);

      // Alex visibly drags a contribution into the group's idea bank.
      const drag = ease((t - 6.9) / 1.9);
      const noteX = mix(812, 454, drag);
      sticky(78, 452, 332, 110, '#fff0b5', 'Onboarding flow', 'Keep it simple');
      sticky(noteX, 452, 314, 110, '#f8deea', 'New ideas', 'Make room for all');
      if (t >= 9.8) {
        const vote = ease((t - 9.8) / 0.5);
        c.save(); c.globalAlpha = vote;
        box(340, 464, 49, 46, '#fffdf5', 11);
        text('+1', 364.5, 467, 30, '#957517', 650, 45, 'center');
        c.restore();
      }
      if (t >= 10.6) {
        const completion = ease((t - 10.6) / 0.5);
        circle(1164, 298, 27, '#268a7615', p.sage, 3);
        check(1164, 298, p.sage, 4, completion);
        c.save(); c.globalAlpha = completion;
        text('Approved', 1210, 277, 36, p.sage, 650, 298);
        text('Next: welcome the team', 1163, 329, 30, p.muted, 450, 355);
        c.restore();
      }
      pulse(156, 247, t, 1.1, p.gold);
      pulse(618, 241, t, 2.8, p.purple);
      pulse(934, 240, t, 4.8, p.sage);
      pulse(537, 474, t, 8.8, p.pink);
      pulse(305, 489, t, 10.0, p.gold);
      cursor('Sarah', t); cursor('Mateo', t); cursor('Lin', t); cursor('Alex', t);
      const outside = bounds.filter(b => b.x < 0 || b.y < 90 || b.x + b.width > 1600 || b.y + b.height > 640);
      if (outside.length) throw new Error(`Text outside content-safe frame: ${JSON.stringify(outside)}`);
      const offerOverlap = bounds.filter(b => b.x < 1600 && b.x + b.width > 1100 && b.y < 640 && b.y + b.height > 430);
      if (offerOverlap.length) throw new Error(`Text under the offer: ${JSON.stringify(offerOverlap)}`);
      return { image: canvas.toDataURL('image/jpeg', 0.94).split(',')[1], textBounds: bounds.length };
    };
  });
  let textBounds = 0;
  for (let frame = 0; frame < FPS * DURATION; frame++) {
    const result = await page.evaluate(t => window.drawWhiteboard(t), frame / FPS);
    textBounds = Math.max(textBounds, result.textBounds);
    await fs.writeFile(path.join(temporary, `frame-${String(frame).padStart(4, '0')}.jpg`), Buffer.from(result.image, 'base64'));
  }
  const poster = await page.evaluate(t => window.drawWhiteboard(t), 11.5);
  await fs.writeFile(path.join(output, 'whiteboard-showcase.jpg'), Buffer.from(poster.image, 'base64'));
  const video = path.join(output, 'whiteboard-showcase.mp4');
  await encode(['-y', '-framerate', String(FPS), '-i', path.join(temporary, 'frame-%04d.jpg'), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', video]);
  const decoded = await encode(['-v', 'error', '-i', video, '-f', 'null', '-']);
  if (decoded.trim()) throw new Error(`Decode warnings: ${decoded}`);
  const metadata = await encode(['-hide_banner', '-i', video, '-frames:v', '1', '-f', 'null', '-']);
  if (!/1600x640/.test(metadata) || !/yuv420p/.test(metadata) || !/24 fps/.test(metadata) || !/Duration: 00:00:15\.00/.test(metadata) || /Stream.*Audio:/.test(metadata)) throw new Error(`Unexpected metadata: ${metadata}`);
  console.log(`whiteboard-showcase: ${DURATION}s, ${WIDTH}×${HEIGHT}, ${FPS}fps, H.264/yuv420p, ${(await fs.stat(video)).size} bytes; ${textBounds} text bounds checked on all 360 frames; full MP4 decode and metadata passed`);
} finally {
  if (browser) await browser.close();
  const resolvedTemporary = path.resolve(temporary);
  // Cleanup is limited to the exact unique directory created above.
  if (path.dirname(resolvedTemporary) === path.resolve(os.tmpdir()) && path.basename(resolvedTemporary).startsWith('talk-whiteboard-showcase-')) await fs.rm(resolvedTemporary, { recursive: true, force: true });
}
