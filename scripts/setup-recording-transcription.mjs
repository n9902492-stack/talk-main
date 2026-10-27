import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, rename, unlink } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, 'data/transcription');
// Official CPU release, verified against its GitHub release asset digest.
const release = { version:'v1.9.2',name:'whisper-bin-x64.zip',sha256:'49dcc16de826f20bd53d44f947a1ae49dfa81f86cad67a64d80820cb192d674a' };
async function download(url, destination, digest) {
  try {
    const cached = createHash('sha256'); let bytes = 0;
    for await (const chunk of createReadStream(destination)) { cached.update(chunk); bytes += chunk.length; }
    if (cached.digest('hex') === digest) return bytes;
  } catch { /* Install a missing or invalid dependency to a separate file. */ }
  const response = await fetch(url, { signal: AbortSignal.timeout(300000) }); if (!response.ok || !response.body) throw new Error('The local transcription dependency download failed.');
  const pending = destination + '.download', hash = createHash('sha256'); let bytes = 0;
  try {
    await pipeline(Readable.fromWeb(response.body), new Transform({ transform(chunk, _encoding, done) { bytes += chunk.length; if (bytes > 600 * 1024 * 1024) return done(new Error('Local model download limit exceeded.')); hash.update(chunk); done(null, chunk); } }), createWriteStream(pending, { mode: 0o600 }));
    if (hash.digest('hex') !== digest) throw new Error('The local transcription dependency checksum did not match.');
    await rename(pending, destination); return bytes;
  } finally { await unlink(pending).catch(() => {}); }
}
if(process.platform!=='win32'||process.arch!=='x64')throw new Error('This setup helper supports Windows x64. Install whisper.cpp and its multilingual base model manually on other platforms.');
await mkdir(directory,{recursive:true});
const archive=path.join(directory,release.name);
await download(`https://github.com/ggml-org/whisper.cpp/releases/download/${release.version}/${release.name}`,archive,release.sha256);
// The SHA-256 of the model must be pinned here after inspecting the official LFS metadata.
const modelDigest='60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe';
await download('https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',path.join(directory,'ggml-base.bin'),modelDigest);
// The base model's Hindi output failed the actual human-speech quality check.
// Keep the fast English model and install a separate local Hindi accuracy model.
const hindiDigest='19fea4b380c3a618ec4723c3eef2eb785ffba0d0538cf43f8f235e7b3b34220f';
await download('https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium-q5_0.bin',path.join(directory,'ggml-medium-q5_0.bin'),hindiDigest);
const unpack=path.join(directory,'unpacked');
execFileSync('powershell.exe',['-NoProfile','-Command',`Expand-Archive -LiteralPath '${archive.replaceAll("'","''")}' -DestinationPath '${unpack.replaceAll("'","''")}' -Force`],{windowsHide:true,stdio:'ignore'});
async function find(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const item=path.join(dir,entry.name);if(entry.isDirectory()){const nested=await find(item);if(nested)return nested;}else if(entry.name==='whisper-cli.exe')return dir;}}
const bin=await find(unpack);if(!bin)throw new Error('The verified Whisper archive did not contain its CLI.');
const target=path.join(directory,'bin');await mkdir(target,{recursive:true});for(const entry of await readdir(bin)){if(/\.(exe|dll)$/i.test(entry))await writeFile(path.join(target,entry),await readFile(path.join(bin,entry)));}
const licenseDigest='94f29bbed6a22c35b992c5c6ebf0e7c92f13b836b90f36f461c9cf2f0f1d010d';
await writeFile(path.join(directory,'manifest.json'),JSON.stringify({source:'https://github.com/ggml-org/whisper.cpp',release:release.version,archiveSha256:release.sha256,modelSha256:modelDigest,model:'multilingual base',hindiModel:'multilingual medium-q5_0',hindiModelSha256:hindiDigest,license:'MIT',licenseSha256:licenseDigest},null,2));
// A verified offline installation must not fail just because GitHub is briefly
// unavailable. Preserve the pinned license alongside the cached binaries.
await download(`https://raw.githubusercontent.com/ggml-org/whisper.cpp/${release.version}/LICENSE`,path.join(directory,'LICENSE'),licenseDigest);
console.log('Local multilingual Whisper installed and checksums verified. No paid service was enabled.');
