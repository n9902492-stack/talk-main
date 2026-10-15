import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';
import ffmpeg from '@ffmpeg-installer/ffmpeg';

// Original, silent teaching videos. No downloaded assets or screen recordings.
// Run from the project root: node scripts/create-social-workshop-videos.mjs
const output = path.resolve('public/reference/social-workshop');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'talk-workshop-'));
const fps = 24;
const duration = 12;
const topics = [
  { name: 'introduction', title: 'A simple plan for social media', subtitle: 'Decide what matters. Publish something useful. Learn and repeat.', takeaway: 'Start with one outcome. Make every post serve it.' },
  { name: 'platforms', title: 'Choose the channels that fit', subtitle: 'Use these three questions before opening another account.', takeaway: 'Choose 1–2 channels you can maintain well.' },
  { name: 'content', title: 'Make every post worth the pause', subtitle: 'A strong post connects a clear hook, useful value, and a next step.', takeaway: 'Give people something helpful before asking them to act.' },
  { name: 'advertising', title: 'Run a focused advertising test', subtitle: 'One goal. One audience. Two creative ideas to compare.', takeaway: 'Keep the offer, audience, and budget comparable. Change one idea.' },
  { name: 'measurement', title: 'Measure progress, then adjust', subtitle: 'Connect visibility and engagement to the action you care about.', takeaway: 'Compare trends over the same period. Use the result to choose a next step.' },
];

await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
await page.setContent('<!doctype html><html><body style="margin:0"><canvas id="film" width="1280" height="720"></canvas></body></html>');

await page.evaluate(() => {
  const canvas = document.querySelector('canvas');
  const c = canvas.getContext('2d');
  const colors = { ink: '#24232c', muted: '#666473', purple: '#6b55b4', teal: '#208c82', gold: '#c49930', bg: '#fbf8f2', line: '#e6e0d7', white: '#ffffff' };
  let bounds = [];
  const ease = value => { const n = Math.max(0, Math.min(1, value)); return 1 - Math.pow(1 - n, 3); };
  function rect(x, y, w, h, radius, fill, stroke) {
    c.beginPath(); c.roundRect(x, y, w, h, radius);
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = 1.5; c.stroke(); }
  }
  function line(x1, y1, x2, y2, color = colors.line, thickness = 2) {
    c.strokeStyle = color; c.lineWidth = thickness; c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
  }
  function text(value, x, y, size = 22, color = colors.ink, weight = 400, maxWidth = 1100, align = 'left') {
    c.font = `${weight} ${size}px "Segoe UI", sans-serif`;
    c.fillStyle = color; c.textBaseline = 'top'; c.textAlign = align;
    const w = c.measureText(value).width;
    if (w > maxWidth + 1) throw new Error(`Text exceeds its box: ${value} (${w} > ${maxWidth})`);
    const left = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    bounds.push({ value, x: left, y, width: w, height: size * 1.25 });
    c.fillText(value, x, y);
  }
  function paragraph(value, x, y, width, size = 22, color = colors.muted, weight = 400, gap = 1.4) {
    c.font = `${weight} ${size}px "Segoe UI", sans-serif`;
    const words = value.split(' '); const rows = []; let row = '';
    for (const word of words) {
      const candidate = row ? `${row} ${word}` : word;
      if (c.measureText(candidate).width > width && row) { rows.push(row); row = word; } else row = candidate;
    }
    if (row) rows.push(row);
    rows.forEach((value, i) => text(value, x, y + i * size * gap, size, color, weight, width));
    return rows.length * size * gap;
  }
  function circle(x, y, r, fill, stroke, thickness = 2) {
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2);
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = thickness; c.stroke(); }
  }
  function arrow(x1, y, x2, color = colors.purple, progress = 1) {
    const x = x1 + (x2 - x1) * progress;
    line(x1, y, x, y, color, 3);
    if (progress > 0.94) { line(x - 9, y - 6, x, y, color, 3); line(x - 9, y + 6, x, y, color, 3); }
  }
  function entrance(t, delay, callback) {
    const a = ease((t - delay) / 0.65);
    if (a === 0) return;
    c.save(); c.globalAlpha = a; c.translate(0, (1 - a) * 14); callback(); c.restore();
  }
  function top(topic, index, t) {
    c.fillStyle = colors.bg; c.fillRect(0, 0, 1280, 720);
    for (let i = 0; i < 9; i++) { circle(890 + i * 45, 34 + Math.sin(t * 0.6 + i) * 6, 3, i % 2 ? '#ede7dd' : '#e4ddd1'); }
    text('talk', 54, 35, 28, colors.ink, 750, 80);
    line(127, 38, 127, 65, '#d7d0c6', 1.5);
    text('SOCIAL MEDIA MARKETING', 147, 43, 16, colors.purple, 700, 490);
    text(`${String(index + 1).padStart(2, '0')} / 05`, 1226, 43, 16, colors.muted, 600, 100, 'right');
    text(topic.title, 54, 101, 45, colors.ink, 700, 1172);
    text(topic.subtitle, 56, 164, 23, colors.muted, 400, 1170);
    rect(54, 597, 1172, 69, 18, '#ece7f5');
    circle(87, 631, 14, colors.purple);
    line(80, 631, 85, 636, '#ffffff', 2.5); line(85, 636, 94, 626, '#ffffff', 2.5);
    text(topic.takeaway, 115, 616, topic.name === 'measurement' ? 23 : 24, colors.ink, 600, 1080);
    text('Workshop visual guide', 55, 684, 14, colors.muted, 400, 450);
    text('Silent demo · practical concepts', 1225, 684, 14, colors.muted, 400, 450, 'right');
    rect(0, 715, 1280, 5, 0, '#e8e1d7'); rect(0, 715, 1280 * Math.min(t / 12, 1), 5, 0, colors.purple);
  }
  function intro(t) {
    const cards = [
      ['Goal', 'Pick one result', 'For example: more useful conversations with customers.', colors.purple],
      ['Audience', 'Know who you help', 'Name their question, need, or problem.', colors.teal],
      ['Content', 'Make it useful', 'Share an answer, a tip, or a real example.', colors.gold],
      ['Learn', 'Review and repeat', 'Use responses and results to improve the next post.', colors.purple],
    ];
    const focus = Math.min(3, Math.floor(Math.max(0, t - 2.5) / 2.2));
    cards.forEach(([title, heading, body, color], index) => {
      const x = 54 + index * 298;
      entrance(t, 0.25 + index * 0.65, () => {
        rect(x, 237, 278, 303, 22, colors.white, focus === index ? color : colors.line);
        rect(x + 22, 260, 47, 42, 12, `${color}17`);
        text(String(index + 1).padStart(2, '0'), x + 45, 267, 23, color, 700, 40, 'center');
        text(title, x + 22, 328, 31, colors.ink, 700, 233);
        text(heading, x + 22, 377, 20, color, 650, 233);
        paragraph(body, x + 22, 415, 232, 21);
        rect(x + 22, 517, 234 * (focus >= index ? 1 : 0.2), 5, 3, color);
      });
      if (index < 3) entrance(t, 0.8 + index * 0.65, () => arrow(x + 281, 351, x + 293, colors.purple, ease((t - 0.8 - index * 0.65) / 0.7)));
    });
    entrance(t, 3.2, () => {
      text('The learning loop', 644, 558, 18, colors.muted, 500, 600, 'center');
      const p = ((t - 3.2) % 4) / 4;
      const x = 1090 - p * 900;
      line(199, 583, 1090, 583, '#ded5ed', 2); circle(x, 583, 5, colors.purple);
    });
  }
  function platforms(t) {
    const cards = [
      ['Audience', 'Where do your customers already look for helpful information?', colors.purple],
      ['Content format', 'Can you make the videos, images, or writing this channel needs?', colors.teal],
      ['Team capacity', 'Can you publish, reply, and review results consistently?', colors.gold],
    ];
    cards.forEach(([heading, body, color], index) => {
      const x = 54 + index * 400;
      entrance(t, 0.2 + index * 0.6, () => {
        rect(x, 236, 372, 301, 22, colors.white, colors.line);
        if (index === 0) {
          [30, 20, 9].forEach(r => circle(x + 57, 294, r, undefined, color, 2.2));
          circle(x + 57 + Math.cos(t) * 20, 294 + Math.sin(t) * 20, 4, color);
        } else if (index === 1) {
          for (let j = 0; j < 3; j++) { rect(x + 26 + j * 25, 270 + Math.sin(t * 1.3 + j) * 3, 20, 46, 5, `${color}23`, color); }
        } else {
          for (let j = 0; j < 4; j++) { rect(x + 27 + j * 22, 317 - (j + 1) * 10, 15, (j + 1) * 10, 3, j < (Math.floor(t) % 4 + 1) ? color : `${color}35`); }
        }
        text(heading, x + 26, 343, 29, colors.ink, 700, 320);
        paragraph(body, x + 26, 391, 318, 23);
      });
    });
    entrance(t, 2.4, () => text('Audience fit  +  Format fit  +  Sustainable effort', 640, 556, 24, colors.purple, 600, 1100, 'center'));
  }
  function content(t) {
    const steps = [
      ['01', 'Hook', 'Name a specific problem.', colors.purple],
      ['02', 'Value', 'Give a useful answer.', colors.teal],
      ['03', 'Next step', 'Make the action clear.', colors.gold],
    ];
    steps.forEach(([num, heading, body, color], index) => entrance(t, index * 0.55 + 0.25, () => {
      const y = 238 + index * 104;
      rect(54, y, 453, 88, 17, colors.white, colors.line);
      circle(92, y + 42, 22, `${color}1c`);
      text(num, 92, y + 28, 20, color, 700, 42, 'center');
      text(heading, 131, y + 15, 25, colors.ink, 650, 337);
      text(body, 131, y + 52, 20, colors.muted, 400, 337);
    }));
    entrance(t, 0.65, () => {
      rect(538, 238, 688, 323, 23, colors.white, colors.line);
      rect(563, 258, 174, 32, 9, '#eeebf6');
      text('EXAMPLE POST', 581, 266, 15, colors.purple, 700, 150);
      entrance(t, 1.6, () => {
        paragraph('Running out of ideas for your next post?', 563, 316, 627, 32, colors.ink, 700, 1.25);
        rect(553, 311, 5, 86, 3, colors.purple);
      });
      entrance(t, 3.1, () => {
        paragraph('Turn one customer question into a short, helpful answer. Add a concrete example.', 563, 408, 614, 23, colors.muted, 400, 1.35);
        rect(553, 406, 5, 68, 3, colors.teal);
      });
      entrance(t, 4.8, () => {
        rect(560, 504, 475, 37, 10, '#f8efd6');
        text('Save this idea for your next planning session.', 575, 514, 19, '#785817', 600, 445);
      });
    });
  }
  function advertising(t) {
    entrance(t, 0.25, () => {
      rect(54, 230, 1172, 59, 15, '#eeebf6');
      text('Goal: useful enquiries', 77, 249, 23, colors.purple, 650, 510);
      line(562, 244, 562, 276, '#d5cce8', 1.5);
      text('Audience: people with the need you solve', 591, 249, 23, colors.ink, 500, 609);
    });
    const progress = ease((t - 3.2) / 3.2);
    const cards = [
      ['Creative A', 'Show a helpful tip', 'Lead with an answer to a common question.', colors.purple, 12],
      ['Creative B', 'Show a clear example', 'Make the benefit easy to understand.', colors.teal, 18],
    ];
    cards.forEach(([heading, idea, detail, color, result], index) => entrance(t, 0.85 + index * 0.5, () => {
      const x = 54 + index * 600;
      rect(x, 313, 572, 253, 22, colors.white, colors.line);
      text(heading, x + 25, 334, 18, color, 700, 523);
      text(idea, x + 25, 369, 29, colors.ink, 700, 523);
      paragraph(detail, x + 25, 415, 519, 21);
      text('Example enquiries', x + 25, 480, 18, colors.muted, 500, 523);
      rect(x + 25, 518, 459, 17, 9, `${color}19`);
      rect(x + 25, 518, 459 * result / 20 * progress, 17, 9, color);
      text(String(Math.round(result * progress)), x + 521, 512, 24, color, 700, 45, 'center');
    }));
    entrance(t, 2.2, () => text('EXAMPLE DATA · Same time period and budget', 641, 577, 14, colors.muted, 600, 1100, 'center'));
  }
  function measurement(t) {
    const stats = [
      ['Reach', 'People who saw it', colors.purple, '1,200'],
      ['Engagement', 'People who interacted', colors.teal, '84'],
      ['Actions', 'Useful next steps', colors.gold, '18'],
    ];
    stats.forEach(([heading, detail, color, value], index) => entrance(t, index * 0.45 + 0.2, () => {
      const x = 54 + index * 400;
      rect(x, 230, 372, 128, 19, colors.white, colors.line);
      text(heading, x + 22, 248, 22, colors.ink, 650, 320);
      text(value, x + 347, 246, 30, color, 700, 140, 'right');
      text(detail, x + 22, 302, 20, colors.muted, 400, 329);
    }));
    entrance(t, 1.2, () => {
      rect(54, 377, 1172, 193, 21, colors.white, colors.line);
      text('Useful next steps, week by week', 79, 395, 21, colors.ink, 600, 620);
      rect(1046, 392, 153, 29, 7, '#f8efd6');
      text('EXAMPLE DATA', 1122, 399, 13, '#795919', 700, 139, 'center');
      const yBase = 537;
      const values = [8, 11, 14, 18];
      for (let i = 0; i < 3; i++) line(94, 445 + i * 44, 1191, 445 + i * 44, '#efebe4', 1);
      values.forEach((value, index) => {
        const x = 168 + index * 270;
        const a = ease((t - 1.4 - index * 0.65) / 1.6);
        const h = value / 18 * 94 * a;
        rect(x, yBase - h, 88, h, 7, index === 3 ? colors.teal : '#9885ca');
        if (a > 0.8) text(String(Math.round(value * a)), x + 44, yBase - h - 24, 17, colors.ink, 650, 75, 'center');
        text(`Week ${index + 1}`, x + 44, 547, 15, colors.muted, 500, 90, 'center');
      });
    });
  }
  window.drawWorkshop = (topic, index, t) => {
    bounds = []; top(topic, index, t);
    ({ introduction: intro, platforms, content, advertising, measurement }[topic.name])(t);
    const outside = bounds.filter(b => b.x < 0 || b.y < 0 || b.x + b.width > 1280 || b.y + b.height > 713);
    if (outside.length) throw new Error(`Text out of frame: ${JSON.stringify(outside)}`);
    return { image: canvas.toDataURL('image/jpeg', 0.91).split(',')[1], textBounds: bounds.length };
  };
});

function encode(args) {
  return new Promise((resolve, reject) => {
    const process = spawn(ffmpeg.path, args, { windowsHide: true });
    let error = '';
    process.stderr.on('data', chunk => { error = (error + chunk.toString()).slice(-10000); });
    process.on('error', reject);
    process.on('close', code => code === 0 ? resolve(error) : reject(new Error(error)));
  });
}

try {
  for (const [index, topic] of topics.entries()) {
    const selected = process.argv.find(argument => argument.startsWith('--only='))?.slice(7);
    if (selected && selected !== topic.name) continue;
    const frames = path.join(temporary, topic.name);
    await fs.mkdir(frames);
    let textBounds = 0;
    for (let frame = 0; frame < fps * duration; frame++) {
      const result = await page.evaluate(({ topic, index, t }) => window.drawWorkshop(topic, index, t), { topic, index, t: frame / fps });
      textBounds = Math.max(textBounds, result.textBounds);
      await fs.writeFile(path.join(frames, `frame-${String(frame).padStart(4, '0')}.jpg`), Buffer.from(result.image, 'base64'));
    }
    const poster = await page.evaluate(({ topic, index }) => window.drawWorkshop(topic, index, 8.5), { topic, index });
    await fs.writeFile(path.join(output, `${topic.name}.jpg`), Buffer.from(poster.image, 'base64'));
    await encode(['-y', '-framerate', String(fps), '-i', path.join(frames, 'frame-%04d.jpg'), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', path.join(output, `${topic.name}.mp4`)]);
    const metadata = await fs.stat(path.join(output, `${topic.name}.mp4`));
    console.log(`${topic.name}: ${duration}s, 1280×720, ${fps}fps, ${metadata.size} bytes; ${textBounds} text bounds checked`);
    // Remove only our uniquely created temporary frame directory.
    if (path.dirname(path.resolve(frames)) !== path.resolve(temporary)) throw new Error('Unexpected temporary frame directory');
    await fs.rm(frames, { recursive: true });
  }
} finally {
  await browser.close();
  // This exact path was returned by mkdtemp and remains inside the OS temporary directory.
  if (path.dirname(temporary) === os.tmpdir() && path.basename(temporary).startsWith('talk-workshop-')) await fs.rm(temporary, { recursive: true, force: true });
}
