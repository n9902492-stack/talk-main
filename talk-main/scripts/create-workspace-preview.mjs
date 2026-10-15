import ffmpeg from '@ffmpeg-installer/ffmpeg';
import { execFileSync } from 'node:child_process';

const source = 'public/reference/session-recording.mp4';
const crop = 'crop=1600:792:144:94,scale=1000:-2';
// The screen recording contains a second, fixed pointer over the embedded demo.
// Repair only its 18x26 region; the larger moving demonstration pointer remains.
const removeFixedPointer = 'delogo=x=632:y=289:w=18:h=26';
// While the member table is visible, the same role appears two rows above.
// Copy that small area back so interpolation does not smear the Member label.
const cleanedVideo = [
  `[0:v]${crop},fps=24,format=yuv444p,split=2[base][roleSource]`,
  `[base]${removeFixedPointer}[clean]`,
  '[roleSource]crop=18:26:632:190[rolePatch]',
  "[clean][rolePatch]overlay=x=632:y=289:format=yuv444:enable='gte(t,46/24)*lt(t,76/24)',format=yuv420p[preview]",
].join(';');
// The recorded workspace naming and custom-branding walkthrough.
execFileSync(ffmpeg.path, ['-hide_banner', '-loglevel', 'error', '-y',
  '-ss', '204.5', '-i', source, '-t', '7.5', '-filter_complex', cleanedVideo, '-map', '[preview]',
  '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
  '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
  'public/reference/workspaces-preview.mp4']);
execFileSync(ffmpeg.path, ['-hide_banner', '-loglevel', 'error', '-y',
  '-ss', '210', '-i', source, '-vf', `${crop},${removeFixedPointer}`, '-frames:v', '1',
  'public/reference/workspaces-poster.jpg']);
console.log('Created the workspace branding preview and poster with the fixed pointer removed.');
