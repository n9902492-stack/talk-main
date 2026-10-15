import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';
import ffmpeg from '@ffmpeg-installer/ffmpeg';

// Original, silent broadcast-stage illustration. No external media is used.
// Rebuild from the app root: node scripts/create-broadcast-showcase.mjs
const output = path.resolve('public/reference');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'talk-broadcast-showcase-'));
const width = 1440, height = 600, fps = 24, duration = 14;
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--disable-gpu'] });
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
await page.setContent('<!doctype html><html><body style="margin:0"><canvas width="1440" height="600"></canvas></body></html>');

await page.evaluate(() => {
  const canvas = document.querySelector('canvas');
  const c = canvas.getContext('2d');
  const p = { bg: '#fbf8f2', white: '#fff', ink: '#25232b', muted: '#6a6571', purple: '#7254b5', teal: '#208c82', gold: '#c99a26', line: '#e8e2d9' };
  let bounds = [];
  const ease = n => 1 - Math.pow(1 - Math.max(0, Math.min(1, n)), 3);
  function box(x, y, w, h, radius, fill, stroke) {
    c.beginPath(); c.roundRect(x, y, w, h, radius);
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = 1.5; c.stroke(); }
  }
  function circle(x, y, r, fill) { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fillStyle = fill; c.fill(); }
  function line(x1, y1, x2, y2, color, thickness = 2) { c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.lineWidth = thickness; c.strokeStyle = color; c.stroke(); }
  function text(value, x, y, size = 30, color = p.ink, weight = 400, maxWidth = 1380, align = 'left') {
    c.font = `${weight} ${size}px "Segoe UI", sans-serif`; c.textAlign = align; c.textBaseline = 'top'; c.fillStyle = color;
    const w = c.measureText(value).width;
    if (w > maxWidth + 1) throw new Error(`Text exceeds its box: ${value} (${w} > ${maxWidth})`);
    bounds.push({ value, x: align === 'center' ? x - w / 2 : align === 'right' ? x - w : x, y, width: w, height: size * 1.2 });
    c.fillText(value, x, y);
  }
  function entrance(t, delay, fn) { const k = ease((t - delay) / 0.7); if (!k) return; c.save(); c.globalAlpha = k; c.translate(0, 9 * (1 - k)); fn(); c.restore(); }
  function check(x, y, color) { line(x - 8, y, x - 2, y + 6, color, 3); line(x - 2, y + 6, x + 10, y - 8, color, 3); }
  function host(t) {
    box(1024, 101, 380, 223, 22, '#ece8f5', p.line);
    const bob = Math.sin(t * 0.85) * 2;
    c.save(); c.translate(0, bob);
    circle(1214, 169, 43, '#dfbda1');
    c.beginPath(); c.moveTo(1171, 169); c.bezierCurveTo(1165, 102, 1250, 103, 1255, 158); c.lineTo(1253, 173); c.bezierCurveTo(1237, 154, 1211, 146, 1186, 151); c.lineTo(1180, 175); c.closePath(); c.fillStyle = '#38303f'; c.fill();
    circle(1198, 171, 3, '#38303f'); circle(1228, 171, 3, '#38303f');
    c.beginPath(); c.arc(1214, 181, 12, 0.12, Math.PI - 0.12); c.strokeStyle = '#936553'; c.lineWidth = 2.2; c.stroke();
    box(1202, 203, 24, 31, 6, '#dfbda1');
    c.beginPath(); c.moveTo(1133, 280); c.bezierCurveTo(1134, 224, 1178, 219, 1214, 219); c.bezierCurveTo(1250, 219, 1294, 224, 1295, 280); c.closePath(); c.fillStyle = p.teal; c.fill();
    // Gentle presenter gesture, drawn as a simple illustration.
    const gesture = Math.sin(t * 0.65) * 5;
    line(1266, 251, 1290, 232 + gesture, '#dfbda1', 14); circle(1291, 230 + gesture, 8, '#dfbda1');
    c.restore();
    box(1039, 279, 350, 36, 10, '#fffffff0');
    text('Illustrated host', 1214, 282, 30, p.ink, 650, 330, 'center');
  }
  function shell(t, chapter) {
    c.fillStyle = p.bg; c.fillRect(0, 0, 1440, 600);
    text('talk', 35, 25, 43, p.ink, 750, 100);
    line(144, 28, 144, 69, '#d7d0c5', 1.5);
    text('Studio Broadcast Stage', 170, 29, 38, p.ink, 650, 760);
    box(1111, 26, 293, 47, 13, '#eee8f6');
    text('Broadcast demo', 1257, 32, 30, p.purple, 650, 275, 'center');
    box(35, 101, 958, 399, 24, p.white, p.line);
    circle(69, 134, 6, p.teal);
    text(chapter === 0 ? 'PRESENTATION' : chapter === 1 ? 'LIVE Q&A' : 'WORKSHOP INVITE', 88, 117, 30, p.purple, 650, 860);
    line(60, 165, 965, 165, p.line, 1.5);
    host(t);
    box(1024, 343, 380, 157, 21, p.white, p.line);
    text('Audience chat', 1046, 355, 30, p.ink, 650, 330);
    const chat = t < 4.5 ? 'Great idea!' : t < 9 ? 'How can we start?' : 'See you there!';
    const chatStart = t < 4.5 ? 1.5 : t < 9 ? 4.5 : 9;
    entrance(t, chatStart, () => {
      box(1041, 402, 346, 76, 15, chapter === 1 ? '#eee8f6' : '#e9f3ef');
      circle(1068, 440, 8, chapter === 1 ? p.purple : p.teal);
      text(chat, 1088, 420, 30, p.ink, 500, 290);
    });
    text('Illustrative audience & offer', 37, 533, 30, p.muted, 400, 850);
    text('Presentation → Q&A → Invite', 1400, 533, 30, p.muted, 500, 600, 'right');
    box(0, 596, 1440, 4, 0, '#e8e0d5'); box(0, 596, 1440 * t / 14, 4, 0, p.purple);
  }
  function presentation(t) {
    entrance(t, 0.05, () => {
      text('The future of collaboration', 67, 185, 56, p.ink, 700, 899);
      text('Better together. From anywhere.', 69, 260, 35, p.muted, 400, 890);
    });
    const cards = [['Connect', 'Share a space', p.purple], ['Create', 'Build together', p.teal], ['Decide', 'Move forward', p.gold]];
    cards.forEach(([title, body, color], i) => entrance(t, 0.8 + 0.65 * i, () => {
      const x = 65 + i * 303;
      box(x, 333, 285, 139, 18, `${color}10`, `${color}30`);
      circle(x + 31, 362, 10, color);
      text(title, x + 23, 378, 42, p.ink, 650, 246);
      text(body, x + 23, 432, 30, p.muted, 400, 246);
      box(x + 23, 468, 238 * ease((t - 1.4 - i * 0.6) / 1.4), 3, 1.5, color);
    }));
  }
  function question(t) {
    entrance(t, 0.05, () => {
      text('How do we work better together?', 67, 193, 48, p.ink, 700, 894);
      text('An audience question, answered on stage.', 69, 260, 32, p.muted, 400, 890);
    });
    const answers = ['Set one clear goal.', 'Give everyone a voice.', 'Leave with a next step.'];
    answers.forEach((answer, i) => entrance(t, 0.65 + i * 0.65, () => {
      const y = 320 + i * 51;
      circle(84, y + 20, 19, '#e8f3ee'); check(84, y + 20, p.teal);
      text(answer, 123, y, 35, p.ink, 600, 815);
    }));
  }
  function offer(t) {
    entrance(t, 0.05, () => {
      text('Put the ideas into practice.', 67, 187, 52, p.ink, 700, 892);
      text('Continue with a hands-on workshop.', 69, 259, 34, p.muted, 400, 890);
    });
    entrance(t, 0.55, () => {
      box(66, 329, 896, 142, 20, '#fff4d5', '#ecd39a');
      text('Workshop pass · $99', 90, 348, 43, p.ink, 700, 650);
      text('Sample timed offer', 92, 409, 30, p.muted, 400, 540);
      box(751, 357, 184, 73, 16, p.gold);
      text('Explore', 843, 376, 32, '#251e0f', 650, 169, 'center');
    });
  }
  window.drawBroadcast = t => {
    bounds = [];
    const chapter = t < 5 ? 0 : t < 9 ? 1 : 2;
    shell(t, chapter);
    if (chapter === 0) presentation(t);
    else if (chapter === 1) question(t - 5);
    else offer(t - 9);
    const outside = bounds.filter(b => b.x < 0 || b.y < 0 || b.x + b.width > 1440 || b.y + b.height > 596);
    if (outside.length) throw new Error(`Text outside frame: ${JSON.stringify(outside)}`);
    return { image: canvas.toDataURL('image/jpeg', 0.94).split(',')[1], textBounds: bounds.length };
  };
});

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg.path, args, { windowsHide: true });
    let log = '';
    child.stderr.on('data', chunk => { log = (log + chunk.toString()).slice(-12000); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(log) : reject(new Error(log)));
  });
}

try {
  let checkedBounds = 0;
  for (let frame = 0; frame < fps * duration; frame++) {
    const result = await page.evaluate(t => window.drawBroadcast(t), frame / fps);
    checkedBounds += result.textBounds;
    await fs.writeFile(path.join(temporary, `frame-${String(frame).padStart(4, '0')}.jpg`), Buffer.from(result.image, 'base64'));
  }
  const poster = await page.evaluate(t => window.drawBroadcast(t), 3.9);
  await fs.writeFile(path.join(output, 'broadcast-showcase.jpg'), Buffer.from(poster.image, 'base64'));
  const video = path.join(output, 'broadcast-showcase.mp4');
  await runFfmpeg(['-y', '-framerate', String(fps), '-i', path.join(temporary, 'frame-%04d.jpg'), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', video]);
  const decodeLog = await runFfmpeg(['-v', 'error', '-i', video, '-f', 'null', '-']);
  if (decodeLog.trim()) throw new Error(`Decode warnings: ${decodeLog}`);
  const file = await fs.stat(video);
  console.log(`broadcast-showcase: ${duration}s, ${width}×${height}, ${fps}fps, H.264/yuv420p, ${file.size} bytes; ${checkedBounds} text bounds checked; MP4 fully decoded`);
} finally {
  await browser.close();
  const resolvedTemporary = path.resolve(temporary);
  if (path.dirname(resolvedTemporary) === path.resolve(os.tmpdir()) && path.basename(resolvedTemporary).startsWith('talk-broadcast-showcase-')) await fs.rm(resolvedTemporary, { recursive: true, force: true });
}
