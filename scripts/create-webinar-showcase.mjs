import { localChrome } from './browser-options.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';
import ffmpeg from '@ffmpeg-installer/ffmpeg';

// Original, silent webinar illustration. All graphics are drawn locally.
// Run from the project root: node scripts/create-webinar-showcase.mjs
const output = path.resolve('frontend/public/reference');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'talk-webinar-showcase-'));
const fps = 24;
const duration = 18;
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ ...localChrome(), headless: true, args: ['--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
await page.setContent('<!doctype html><html><body style="margin:0"><canvas width="1280" height="720"></canvas></body></html>');

await page.evaluate(() => {
  const canvas = document.querySelector('canvas');
  const c = canvas.getContext('2d');
  const palette = { ink: '#24232c', muted: '#716d79', purple: '#7254b5', teal: '#208c82', gold: '#c49a30', bg: '#fbf8f2', white: '#ffffff', line: '#e8e2da' };
  let bounds = [];
  const ease = value => { const p = Math.min(1, Math.max(0, value)); return 1 - Math.pow(1 - p, 3); };
  function box(x, y, w, h, radius, fill, stroke) {
    c.beginPath(); c.roundRect(x, y, w, h, radius);
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = 1.3; c.stroke(); }
  }
  function circle(x, y, r, fill, stroke, width = 2) {
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2);
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = width; c.stroke(); }
  }
  function line(x1, y1, x2, y2, color = palette.line, width = 2) {
    c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.strokeStyle = color; c.lineWidth = width; c.stroke();
  }
  function text(value, x, y, size = 22, color = palette.ink, weight = 400, maxWidth = 1150, align = 'left') {
    c.font = `${weight} ${size}px "Segoe UI", sans-serif`;
    c.fillStyle = color; c.textBaseline = 'top'; c.textAlign = align;
    const width = c.measureText(value).width;
    if (width > maxWidth + 1) throw new Error(`Text exceeds its box: ${value} (${width} > ${maxWidth})`);
    bounds.push({ value, x: align === 'center' ? x - width / 2 : align === 'right' ? x - width : x, y, width, height: size * 1.2 });
    c.fillText(value, x, y);
  }
  function paragraph(value, x, y, width, size = 24, color = palette.muted, weight = 400, spacing = 1.3) {
    c.font = `${weight} ${size}px "Segoe UI", sans-serif`;
    const rows = []; let row = '';
    for (const word of value.split(' ')) {
      const candidate = row ? `${row} ${word}` : word;
      if (c.measureText(candidate).width > width && row) { rows.push(row); row = word; } else row = candidate;
    }
    if (row) rows.push(row);
    rows.forEach((value, index) => text(value, x, y + index * size * spacing, size, color, weight, width));
    return rows.length * size * spacing;
  }
  function entrance(t, delay, callback) {
    const progress = ease((t - delay) / 0.7);
    if (!progress) return;
    c.save(); c.globalAlpha = progress; c.translate(0, 10 * (1 - progress)); callback(); c.restore();
  }
  function speechIcon(x, y, color) {
    box(x - 19, y - 15, 38, 28, 8, undefined, color);
    line(x - 8, y + 13, x - 15, y + 21, color);
    line(x - 15, y + 21, x - 15, y + 11, color);
    [-9, 0, 9].forEach(dx => circle(x + dx, y - 1, 2, color));
  }
  function playIcon(x, y, color) {
    box(x - 21, y - 17, 42, 34, 8, undefined, color);
    c.beginPath(); c.moveTo(x - 5, y - 8); c.lineTo(x + 8, y); c.lineTo(x - 5, y + 8); c.closePath(); c.fillStyle = color; c.fill();
  }
  function presenter(t) {
    box(934, 322, 310, 274, 19, palette.white, palette.line);
    box(948, 336, 282, 193, 13, '#ece8f5');
    // A deliberately illustrated host, rather than simulated actual footage.
    const bob = Math.sin(t * 0.9) * 2;
    c.save(); c.translate(0, bob);
    circle(1089, 398, 44, '#e8c7aa');
    c.beginPath(); c.moveTo(1048, 402); c.bezierCurveTo(1040, 344, 1106, 333, 1131, 376); c.lineTo(1129, 394); c.bezierCurveTo(1112, 383, 1087, 376, 1063, 382); c.closePath(); c.fillStyle = '#3d3447'; c.fill();
    circle(1074, 400, 2.8, '#3d3447'); circle(1103, 400, 2.8, '#3d3447');
    c.beginPath(); c.arc(1089, 410, 11, 0.15, Math.PI - 0.15); c.lineWidth = 2.2; c.strokeStyle = '#8e5d4e'; c.stroke();
    box(1075, 433, 28, 35, 7, '#e8c7aa');
    c.beginPath(); c.moveTo(1018, 529); c.bezierCurveTo(1019, 450, 1063, 447, 1089, 447); c.bezierCurveTo(1115, 447, 1160, 450, 1160, 529); c.closePath(); c.fillStyle = palette.teal; c.fill();
    c.restore();
    box(962, 349, 95, 27, 7, '#ffffffd9');
    text('HOST', 977, 355, 14, palette.purple, 700, 70);
    text('Your webinar host', 953, 547, 23, palette.ink, 650, 270);
    text('Illustrated presenter', 953, 578, 16, palette.muted, 400, 270);
  }
  function shell(t, chapter) {
    c.fillStyle = palette.bg; c.fillRect(0, 0, 1280, 720);
    text('talk', 36, 29, 30, palette.ink, 750, 83);
    line(114, 33, 114, 61, '#d8d0c5', 1.5);
    text('Build an engaged audience', 137, 32, 31, palette.ink, 650, 850);
    box(1091, 31, 153, 32, 10, '#eee8f6');
    text('Webinar demo', 1106, 38, 17, palette.purple, 650, 127);
    box(36, 91, 870, 505, 23, palette.white, palette.line);
    circle(63, 119, 4, palette.teal);
    text(chapter === 0 ? 'LIVE PRESENTATION' : chapter === 1 ? 'AUDIENCE POLL' : 'ON-STAGE Q&A', 77, 110, 16, chapter === 1 ? palette.teal : palette.purple, 700, 800);
    line(60, 142, 881, 142, palette.line, 1);
    box(934, 91, 310, 212, 19, palette.white, palette.line);
    text('TODAY’S AGENDA', 955, 113, 16, palette.muted, 650, 270);
    const agenda = ['Share one useful idea', 'Hear from the audience', 'Answer a real question'];
    agenda.forEach((title, i) => {
      const y = 153 + i * 46;
      if (i === chapter) box(949, y - 4, 280, 39, 10, i === 1 ? '#eaf5f2' : '#eee8f6');
      circle(966, y + 14, 10, i <= chapter ? (i === 1 ? palette.teal : palette.purple) : '#e8e3dc');
      if (i < chapter) { line(962, y + 14, 965, y + 17, '#fff', 1.6); line(965, y + 17, 971, y + 10, '#fff', 1.6); }
      else text(String(i + 1), 966, y + 5, 14, i === chapter ? '#fff' : palette.muted, 600, 20, 'center');
      text(title, 987, y + 3, 18, i === chapter ? palette.ink : palette.muted, i === chapter ? 650 : 400, 234);
    });
    presenter(t);
    box(36, 617, 1208, 62, 16, '#f0ece4');
    const labels = ['Present an idea', 'Invite a response', 'Make it a conversation'];
    const x = [61, 466, 870];
    labels.forEach((label, i) => {
      circle(x[i] + 17, 648, 15, i <= chapter ? (i === 1 ? palette.teal : palette.purple) : '#d6d0c7');
      text(String(i + 1), x[i] + 17, 637, 18, '#fff', 650, 28, 'center');
      text(label, x[i] + 45, 633, 23, i === chapter ? palette.ink : palette.muted, i === chapter ? 650 : 400, 326);
    });
    text('Illustrative webinar experience · silent preview', 37, 693, 14, palette.muted, 400, 1150);
    box(0, 716, 1280, 4, 0, '#e8e0d5'); box(0, 716, 1280 * t / 18, 4, 0, palette.purple);
  }
  function presentation(t) {
    entrance(t, 0.15, () => {
      text('Turn viewers into', 66, 174, 43, palette.ink, 700, 808);
      text('participants.', 66, 228, 43, palette.purple, 700, 808);
      text('A simple structure for your next webinar', 68, 294, 23, palette.muted, 400, 808);
    });
    const cards = [
      ['Ask', 'One focused question', palette.purple, speechIcon],
      ['Show', 'One useful example', palette.teal, playIcon],
      ['Discuss', 'Time for live Q&A', palette.gold, speechIcon],
    ];
    cards.forEach(([title, subtitle, color, icon], i) => entrance(t, 0.8 + i * 0.65, () => {
      const x = 64 + i * 279;
      box(x, 348, 256, 183, 18, `${color}0f`, `${color}38`);
      icon(x + 41, 388, color);
      text(title, x + 24, 432, 30, palette.ink, 650, 207);
      text(subtitle, x + 24, 481, 19, palette.muted, 400, 208);
      box(x + 24, 512, 207 * ease((t - 1.3 - i * 0.65) / 1.6), 4, 2, color);
    }));
    entrance(t, 3.1, () => text('Start with a question people can answer.', 69, 554, 23, palette.ink, 600, 800));
  }
  function poll(t) {
    entrance(t, 0.1, () => {
      text('What would help your', 66, 173, 36, palette.ink, 700, 808);
      text('next webinar?', 66, 219, 36, palette.ink, 700, 808);
      text(t < 2 ? 'Choose the idea that matters most to you.' : 'A quick poll gives everyone a voice.', 68, 274, 23, palette.muted, 400, 805);
    });
    const options = [['Live Q&A', 47, palette.purple], ['Practical examples', 35, palette.teal], ['Downloadable resources', 18, palette.gold]];
    const progress = ease((t - 1.6) / 2.4);
    options.forEach(([label, percent, color], i) => entrance(t, 0.4 + i * 0.22, () => {
      const y = 327 + i * 72;
      box(65, y, 811, 59, 12, '#faf8f4', palette.line);
      box(66, y + 1, 809 * percent / 100 * progress, 57, 11, `${color}25`);
      circle(91, y + 30, 11, palette.white, `${color}60`, 1.4);
      if (progress > 0.02) circle(91, y + 30, 4, color);
      text(label, 116, y + 15, 25, palette.ink, 600, 642);
      if (progress > 0.02) text(`${Math.round(percent * progress)}%`, 852, y + 15, 25, color, 700, 90, 'right');
    }));
    entrance(t, 1.7, () => text('Illustrative results', 68, 555, 17, palette.muted, 400, 390));
    entrance(t, 3.5, () => text('Keep the conversation going →', 875, 549, 21, palette.teal, 600, 450, 'right'));
  }
  function questions(t) {
    entrance(t, 0.1, () => {
      text('Bring audience questions', 66, 174, 36, palette.ink, 700, 808);
      text('onto the stage.', 66, 220, 36, palette.purple, 700, 808);
    });
    entrance(t, 0.55, () => {
      box(65, 285, 811, 94, 16, '#eee8f6');
      speechIcon(100, 331, palette.purple);
      text('AUDIENCE QUESTION', 132, 301, 15, palette.purple, 700, 700);
      text('How do we keep attendees engaged?', 132, 329, 28, palette.ink, 650, 720);
    });
    const answers = ['Ask a focused question.', 'Share one useful example.', 'Leave time for Q&A.'];
    answers.forEach((answer, i) => entrance(t, 1.4 + i * 0.9, () => {
      const y = 401 + i * 50;
      circle(84, y + 17, 13, '#e2f1ec');
      line(78, y + 17, 82, y + 21, palette.teal, 2); line(82, y + 21, 91, y + 11, palette.teal, 2);
      text(answer, 111, y, 27, palette.ink, 600, 754);
    }));
    entrance(t, 4.3, () => text('Useful ideas. Shared in a real conversation.', 69, 560, 22, palette.muted, 500, 800));
  }
  window.drawWebinar = t => {
    bounds = [];
    const chapter = t < 5.5 ? 0 : t < 11 ? 1 : 2;
    shell(t, chapter);
    if (chapter === 0) presentation(t);
    else if (chapter === 1) poll(t - 5.5);
    else questions(t - 11);
    const outside = bounds.filter(b => b.x < 0 || b.y < 0 || b.x + b.width > 1280 || b.y + b.height > 716);
    if (outside.length) throw new Error(`Text outside frame: ${JSON.stringify(outside)}`);
    return { image: canvas.toDataURL('image/jpeg', 0.92).split(',')[1], textBounds: bounds.length };
  };
});

function encode(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg.path, args, { windowsHide: true });
    let log = '';
    child.stderr.on('data', chunk => { log = (log + chunk.toString()).slice(-12000); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(log) : reject(new Error(log)));
  });
}

try {
  let textBounds = 0;
  for (let frame = 0; frame < fps * duration; frame++) {
    const result = await page.evaluate(t => window.drawWebinar(t), frame / fps);
    textBounds = Math.max(textBounds, result.textBounds);
    await fs.writeFile(path.join(temporary, `frame-${String(frame).padStart(4, '0')}.jpg`), Buffer.from(result.image, 'base64'));
  }
  const poster = await page.evaluate(t => window.drawWebinar(t), 9.8);
  await fs.writeFile(path.join(output, 'webinar-showcase.jpg'), Buffer.from(poster.image, 'base64'));
  const video = path.join(output, 'webinar-showcase.mp4');
  await encode(['-y', '-framerate', String(fps), '-i', path.join(temporary, 'frame-%04d.jpg'), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', video]);
  const decoded = await encode(['-v', 'error', '-i', video, '-f', 'null', '-']);
  if (decoded.trim()) throw new Error(`Decode warnings: ${decoded}`);
  const metadata = await fs.stat(video);
  console.log(`webinar-showcase: ${duration}s, 1280×720, ${fps}fps, ${metadata.size} bytes; ${textBounds} text bounds checked; MP4 fully decoded`);
} finally {
  await browser.close();
  // Only remove the unique path created by mkdtemp after checking its absolute parent.
  const resolvedTemporary = path.resolve(temporary);
  if (path.dirname(resolvedTemporary) === path.resolve(os.tmpdir()) && path.basename(resolvedTemporary).startsWith('talk-webinar-showcase-')) await fs.rm(resolvedTemporary, { recursive: true, force: true });
}
