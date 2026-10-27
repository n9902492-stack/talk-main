import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import path from 'node:path';

// Read only the leading archive members, never the full multi-GB dataset.
// Extract one explicitly named, publicly licensed human speech clip to a fixed
// QA path; no tar paths are used as local filesystem destinations.
export async function hindiSpeechFixture(directory) {
  const filename = path.join(directory, 'hindi-fleurs-human-sample.wav');
  const expectedHash = '3ae8b03f94c2cd17fb44d242a6eb0642bbf3497f689669b6773a9831d6a0cc09';
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  try { if (hash(await readFile(filename)) === expectedHash) return filename; } catch { /* Download missing fixture. */ }
  await mkdir(directory, { recursive: true });
  const url = 'https://storage.googleapis.com/xtreme_translations/FLEURS102/hi_in.tar.gz';
  const target = 'hi_in/audio/dev/14930148530444438904.wav';
  const controller = new AbortController(), deadline = setTimeout(() => controller.abort(), 45000);
  let input, decoded;
  try {
    const response = await fetch(url, { headers: { Range: 'bytes=0-10485759' }, signal: controller.signal });
    if (!response.ok || !response.body) throw new Error('Public FLEURS Hindi speech fixture is unavailable.');
    input = Readable.fromWeb(response.body); decoded = createGunzip();
    let compressed = 0;
    input.on('data', chunk => { compressed += chunk.length; if (compressed > 10 * 1024 * 1024) controller.abort(); });
    input.on('error', failure => decoded.destroy(failure)); input.pipe(decoded);
    let buffer = Buffer.alloc(0), offset = 0, referenceTranscript = '';
    for await (const chunk of decoded) {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > 4 * 1024 * 1024) throw new Error('Public speech extraction limit exceeded.');
      while (buffer.length >= offset + 512) {
        const header = buffer.subarray(offset, offset + 512);
        const name = header.subarray(0, 100).toString('utf8').split('\0')[0];
        const sizeText = header.subarray(124, 136).toString('ascii').replace(/\0/g, '').trim();
        if (!name || !/^[0-7]+$/.test(sizeText)) throw new Error('Public speech archive header is invalid.');
        const size = Number.parseInt(sizeText, 8);
        if (size > 2 * 1024 * 1024) throw new Error('Unexpected public speech archive member.');
        const end = offset + 512 + size;
        if (buffer.length < end) break;
        const bytes = buffer.subarray(offset + 512, end);
        if (name === 'hi_in/dev.tsv') {
          referenceTranscript = bytes.toString('utf8').split('\n').find(line => line.split('\t')[1] === path.posix.basename(target))?.split('\t')[2] || '';
        }
        if (name === target) {
          if (hash(bytes) !== expectedHash) throw new Error('Public speech fixture checksum changed.');
          await writeFile(filename, bytes);
          await writeFile(path.join(directory, 'hindi-fleurs-source.json'), JSON.stringify({ sourceUrl: url, member: target, sourcePage: 'https://huggingface.co/datasets/google/fleurs', attribution: 'Google FLEURS, Hindi (hi_in), human-read speech', license: 'CC-BY-4.0', sha256: expectedHash, bytesReadFromArchive: compressed, referenceTranscript }, null, 2));
          return filename;
        }
        offset = end + ((512 - size % 512) % 512);
      }
    }
    throw new Error('The bounded Hindi speech fixture was not found.');
  } finally { clearTimeout(deadline); controller.abort(); input?.destroy(); decoded?.destroy(); }
}
