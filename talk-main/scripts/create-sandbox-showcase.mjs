import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';
import ffmpeg from '@ffmpeg-installer/ffmpeg';

// Locally drawn, silent product sandbox demo. No external footage or assets.
// Reproduce from the project root: node scripts/create-sandbox-showcase.mjs
const WIDTH = 1440, HEIGHT = 600, FPS = 24, DURATION = 14;
const output = path.resolve('public/reference');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'talk-sandbox-showcase-'));
await fs.mkdir(output, { recursive: true });
let browser;

function encode(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg.path, args, { windowsHide: true });
    let log = '';
    child.stderr.on('data', chunk => { log = (log + chunk.toString()).slice(-14000); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(log) : reject(new Error(log)));
  });
}

try {
  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--disable-gpu'] });
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
  await page.setContent('<!doctype html><html><body style="margin:0"><canvas width="1440" height="600"></canvas></body></html>');
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const c = canvas.getContext('2d');
    const p = { bg: '#faf7f2', ink: '#232428', muted: '#76716c', line: '#e8e2da', white: '#ffffff', purple: '#7657b8', teal: '#188b79', gold: '#d3a118' };
    let bounds = [];
    const clamp = t => Math.max(0, Math.min(1, t));
    const ease = t => { t = clamp(t); return t * t * (3 - 2 * t); };
    function box(x, y, w, h, fill, radius = 16, stroke = null) {
      c.beginPath(); c.roundRect(x, y, Math.max(w, 0.1), h, radius);
      if (fill) { c.fillStyle = fill; c.fill(); }
      if (stroke) { c.strokeStyle = stroke; c.lineWidth = 2; c.stroke(); }
    }
    function line(x1, y1, x2, y2, color = p.line, width = 2) {
      c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.strokeStyle = color; c.lineWidth = width; c.stroke();
    }
    function circle(x, y, r, fill, stroke = null, width = 2) {
      c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2);
      if (fill) { c.fillStyle = fill; c.fill(); }
      if (stroke) { c.strokeStyle = stroke; c.lineWidth = width; c.stroke(); }
    }
    function text(value, x, y, size = 32, color = p.ink, weight = 400, maxWidth = 1300, align = 'left') {
      c.font = `${weight} ${size}px "Segoe UI", sans-serif`;
      c.textAlign = align; c.textBaseline = 'top'; c.fillStyle = color;
      const width = c.measureText(value).width;
      if (width > maxWidth + 1) throw new Error(`Text exceeds box: ${value} (${width} > ${maxWidth})`);
      const left = align === 'center' ? x - width / 2 : align === 'right' ? x - width : x;
      bounds.push({ value, x: left, y, width, height: size * 1.2 });
      c.fillText(value, x, y);
    }
    function check(x, y, color = p.white, width = 3) {
      line(x - 8, y, x - 2, y + 6, color, width); line(x - 2, y + 6, x + 11, y - 8, color, width);
    }
    const pointerStops = [
      [0, 650, 526], [0.9, 406, 441], [1.7, 406, 441],
      [2.7, 412, 247], [5.9, 412, 247], [6.7, 260, 358],
      [7.25, 260, 358], [8.15, 1043, 337], [8.75, 1043, 337],
      [9.6, 542, 359], [10.25, 542, 359], [11.2, 1190, 443], [14, 1190, 443],
    ];
    function pointer(t) {
      const index = pointerStops.findIndex((stop, i) => i < pointerStops.length - 1 && t >= stop[0] && t < pointerStops[i + 1][0]);
      const a = pointerStops[Math.max(0, index)], b = pointerStops[Math.max(0, index) + 1] || a;
      const f = ease((t - a[0]) / Math.max(0.001, b[0] - a[0]));
      const x = a[1] + (b[1] - a[1]) * f, y = a[2] + (b[2] - a[2]) * f;
      for (const event of [1.45, 6.95, 8.45, 10.0]) {
        const pulse = (t - event) / 0.6;
        if (pulse > 0 && pulse < 1) {
          c.save(); c.globalAlpha = 1 - pulse;
          circle(x, y, 12 + pulse * 30, null, p.purple, 3); c.restore();
        }
      }
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + 3, y + 34); c.lineTo(x + 12, y + 24); c.lineTo(x + 20, y + 39); c.lineTo(x + 28, y + 35); c.lineTo(x + 20, y + 20); c.lineTo(x + 34, y + 18); c.closePath();
      c.fillStyle = p.purple; c.fill(); c.strokeStyle = p.white; c.lineWidth = 2.5; c.stroke();
      // Raise the label during colour selection so it never obscures the handoff status.
      const labelY = t >= 6.25 && t < 7.8 ? y - 53 : y + 30;
      box(x + 32, labelY, 109, 43, p.purple, 10);
      text('Guest', x + 86.5, labelY + 3, 30, p.white, 600, 96, 'center');
    }
    window.drawSandbox = t => {
      bounds = [];
      const granted = t >= 1.45, named = t >= 3.0, colored = t >= 6.95, review = t >= 8.45, applied = t >= 10.0;
      const theme = colored ? p.purple : p.gold;
      const title = t < 1.45 ? 'Explore a hands-on sandbox' : t < 3 ? 'Control granted. Your turn.' : t < 6.5 ? 'Give your project a name' : t < 8 ? 'Choose your brand colour' : t < 10.7 ? 'Make the workflow your own' : 'Ready. Made by you.';
      const target = 'Launch workspace';
      const count = Math.floor(clamp((t - 3) / 2.3) * target.length);
      const name = named ? target.slice(0, count) : 'Untitled project';
      c.fillStyle = p.bg; c.fillRect(0, 0, 1440, 600);
      text(title, 40, 26, 46, p.ink, 700, 1100);
      box(1177, 29, 223, 48, '#eee8f5', 12);
      text('Sandbox demo', 1288.5, 34, 30, p.purple, 600, 211, 'center');

      box(40, 105, 660, 380, p.white, 25, p.line);
      box(726, 105, 674, 380, p.white, 25, p.line);
      text('Workspace settings', 68, 122, 42, p.ink, 650, 603);
      line(68, 174, 672, 174);
      text('Project name', 68, 184, 30, p.muted, 500, 604);
      box(68, 221, 604, 59, named && !applied ? '#fbf9ff' : '#fcfaf7', 12, named && !applied ? p.purple : p.line);
      text(name || ' ', 88, 231, 36, p.ink, 600, 560);
      if (named && t < 6.1 && Math.floor(t * 2.6) % 2 === 0) {
        c.font = '600 36px "Segoe UI", sans-serif';
        const x = 88 + c.measureText(name).width + 4;
        line(x, 234, x, 266, p.purple, 2);
      }
      text('Brand colour', 68, 299, 30, p.muted, 500, 330);
      const colors = [p.gold, '#232428', p.purple, p.teal];
      colors.forEach((color, i) => {
        const x = 102 + i * 79;
        const selected = i === (colored ? 2 : 0);
        if (selected) circle(x, 358, 29, null, `${color}69`, 4);
        circle(x, 358, 22, color);
        if (selected) check(x, 358);
      });
      const applyProgress = ease((t - 10) / 0.45);
      const applyColor = applied ? p.teal : granted ? p.ink : '#aaa59e';
      box(417, 327, 255, 64, applyColor, 14);
      text(applied ? 'Applied ✓' : 'Apply changes', 544.5, 342, 30, p.white, 600, 233, 'center');
      box(68, 416, 604, 46, granted ? '#e4f4ef' : '#eee8f5', 12);
      if (granted) {
        circle(96, 439, 15, p.teal); check(96, 439, p.white, 2.5);
        text('Control granted — try it', 125, 419, 30, p.teal, 600, 513);
      } else text('Request control', 370, 419, 30, p.purple, 600, 550, 'center');

      text('PROJECT PREVIEW', 754, 129, 30, p.muted, 600, 618);
      circle(779, 216, 24, theme);
      text('L', 779, 194, 34, p.white, 650, 45, 'center');
      text(name || 'Your workspace', 819, 186, 42, p.ink, 700, 550);
      text(colored ? 'Your colour. Your identity.' : 'Updates as you explore.', 755, 246, 30, p.muted, 400, 616);
      line(754, 289, 1372, 289);
      const steps = ['Draft', 'Review', 'Ready'];
      steps.forEach((label, i) => {
        const x = 755 + i * 208;
        const active = applied ? i === 2 : review ? i === 1 : i === 0;
        box(x, 313, 186, 55, active ? `${theme}1c` : '#f6f3ee', 12, active ? `${theme}70` : null);
        text(label, x + 93, 321, 32, active ? theme : p.muted, active ? 650 : 400, 170, 'center');
        if (i < 2) text('›', x + 196, 320, 32, p.muted, 500, 20, 'center');
      });
      if (applied) {
        c.save(); c.globalAlpha = applyProgress;
        box(754, 403, 618, 58, '#e4f4ef', 12);
        circle(787, 432, 16, p.teal); check(787, 432);
        text('Your workspace is ready', 819, 412, 32, p.teal, 650, 534);
        c.restore();
      } else {
        circle(777, 432, 9, theme);
        text(review ? 'Review selected. Apply to save.' : 'Try a change in the preview.', 799, 412, 30, p.muted, 500, 569);
      }

      // Lower breathing room keeps native playback controls clear of the demo UI.
      box(40, 553, 1360, 4, '#e8e1d7', 2);
      box(40, 553, 1360 * clamp(t / 14), 4, p.purple, 2);
      pointer(t);
      const outside = bounds.filter(b => b.x < 0 || b.y < 0 || b.x + b.width > 1440 || b.y + b.height > 600);
      if (outside.length) throw new Error(`Text outside frame: ${JSON.stringify(outside)}`);
      return { image: canvas.toDataURL('image/jpeg', 0.94).split(',')[1], textBounds: bounds.length };
    };
  });
  let textBounds = 0;
  for (let frame = 0; frame < FPS * DURATION; frame++) {
    const result = await page.evaluate(t => window.drawSandbox(t), frame / FPS);
    textBounds = Math.max(textBounds, result.textBounds);
    await fs.writeFile(path.join(temporary, `frame-${String(frame).padStart(4, '0')}.jpg`), Buffer.from(result.image, 'base64'));
  }
  const poster = await page.evaluate(t => window.drawSandbox(t), 7.25);
  await fs.writeFile(path.join(output, 'sandbox-showcase.jpg'), Buffer.from(poster.image, 'base64'));
  const video = path.join(output, 'sandbox-showcase.mp4');
  await encode(['-y', '-framerate', String(FPS), '-i', path.join(temporary, 'frame-%04d.jpg'), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', video]);
  const decoded = await encode(['-v', 'error', '-i', video, '-f', 'null', '-']);
  if (decoded.trim()) throw new Error(`Decode warnings: ${decoded}`);
  console.log(`sandbox-showcase: ${DURATION}s, ${WIDTH}×${HEIGHT}, ${FPS}fps, ${(await fs.stat(video)).size} bytes; ${textBounds} text bounds checked; full MP4 decode passed`);
} finally {
  if (browser) await browser.close();
  const resolvedTemporary = path.resolve(temporary);
  // Cleanup is limited to the exact unique directory created above.
  if (path.dirname(resolvedTemporary) === path.resolve(os.tmpdir()) && path.basename(resolvedTemporary).startsWith('talk-sandbox-showcase-')) {
    await fs.rm(resolvedTemporary, { recursive: true, force: true });
  }
}
