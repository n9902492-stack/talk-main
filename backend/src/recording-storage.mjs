import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, rename, stat, unlink, chmod, lstat, readdir } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const validId = value => typeof value === 'string' && /^[a-f\d-]{36}$/.test(value);

/** Files are never mounted as static content. Cloud reads are proxied after authorization. */
export function createRecordingStorage(env = {}, { bucket: suppliedBucket } = {}) {
  const directory = path.resolve(root, env.RECORDING_LOCAL_PATH || 'data/recordings');
  const cloud = env.RECORDING_STORAGE === 'gcs';
  const bucketName = env.RECORDING_GCS_BUCKET;
  if (env.NODE_ENV === 'production' && !cloud && env.RECORDING_DURABLE_VOLUME !== 'true') throw new Error('Production recordings require private object storage or an explicitly configured durable volume.');
  if (cloud && (!bucketName || !/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(bucketName))) throw new Error('A private recording bucket must be configured.');
  const file = (id, suffix = '.webm') => { if (!validId(id)) throw new Error('Invalid recording key.'); return path.join(directory, id + suffix); };
  const keyId = key => { const id = typeof key === 'string' && /^recordings\/[a-f\d-]{36}\.webm$/.test(key) ? key.slice(11, -5) : ''; if (!validId(id)) throw new Error('Invalid recording key.'); return id; };
  const prepare = () => mkdir(directory, { recursive: true, mode: 0o700 });
  const ensureRegular = async filename => { const info = await lstat(filename); if (!info.isFile() || info.isSymbolicLink()) throw new Error('Recording is unavailable.'); return info; };
  const localCopy = (id, attemptId) => {
    if (attemptId !== undefined && !validId(attemptId)) throw new Error('Invalid transcription attempt.');
    return file(id, (attemptId ? '.' + attemptId : '') + '.transcribe.webm');
  };
  const discardCopy = async filename => unlink(filename).catch(error => { if (error.code !== 'ENOENT') throw error; });
  const discardCopies = async id => {
    const entries = await readdir(directory).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
    const pattern = new RegExp('^' + id + '(?:\\.[a-f\\d-]{36})?\\.transcribe\\.webm$');
    for (const entry of entries) if (pattern.test(entry)) await discardCopy(path.join(directory, entry));
  };
  let bucket = suppliedBucket;
  const getBucket = async () => { if (!bucket) { const { Storage } = await import('@google-cloud/storage'); bucket = new Storage().bucket(bucketName); } return bucket; };
  return {
    kind: cloud ? 'gcs' : 'local',
    keyFor(id) { file(id); return `recordings/${id}.webm`; },
    async allocate(id) { await prepare(); return file(id, '.partial.webm'); },
    async commit(id, result) {
      await prepare(); const source = file(id, '.partial.webm');
      if (path.resolve(result.path) !== source) throw new Error('Recording output path is invalid.');
      const info = await ensureRegular(source); if (!info.size || info.size > 536870912) throw new Error('Recording size limit exceeded.');
      const key = `recordings/${id}.webm`;
      if (cloud) {
        const target = await getBucket();
        // Uniform private access + public-access prevention are deployment prerequisites.
        const [metadata] = await target.getMetadata();
        if (metadata.iamConfiguration?.uniformBucketLevelAccess?.enabled !== true || metadata.iamConfiguration?.publicAccessPrevention !== 'enforced') throw new Error('Recording bucket must enforce private uniform access.');
        await target.upload(source, { destination: key, resumable: true, metadata: { contentType: result.mimeType, cacheControl: 'private, no-store' }, preconditionOpts: { ifGenerationMatch: 0 } });
        // A manager deadline may already have removed the local partial file
        // while this acknowledged upload was finishing. Preserve the success
        // result so the manager can durably delete the late private object.
        await unlink(source).catch(error => { if (error.code !== 'ENOENT') throw error; });
      } else { await rename(source, file(id)); await chmod(file(id), 0o600).catch(() => {}); }
      return { key, mimeType: result.mimeType, bytes: info.size };
    },
    async open(key, range = {}) {
      const id = keyId(key);
      if (cloud) { const object = (await getBucket()).file(key); const [meta] = await object.getMetadata(); return { totalBytes: Number(meta.size), stream: object.createReadStream(range), mimeType: meta.contentType || 'video/webm' }; }
      const info = await ensureRegular(file(id)); return { totalBytes: info.size, stream: createReadStream(file(id), range), mimeType: 'video/webm' };
    },
    async size(key) { if (cloud) { const [meta] = await (await getBucket()).file(key).getMetadata(); return Number(meta.size); } return (await ensureRegular(file(keyId(key)))).size; },
    async localPath(key, { attemptId, signal } = {}) {
      const id = keyId(key); signal?.throwIfAborted();
      if (!cloud) { await ensureRegular(file(id)); return file(id); }
      await prepare(); const dest = localCopy(id, attemptId); let source, output, ownsCopy=false;
      try {
        const target = await getBucket(); signal?.throwIfAborted();
        source = target.file(key).createReadStream(); output = createWriteStream(dest, { flags: 'wx', mode: 0o600 }); output.once('open',()=>{ownsCopy=true;});
        let bytes = 0;
        const limit = new Transform({ transform(chunk, _encoding, callback) { bytes += chunk.length; callback(bytes > 536870912 ? new Error('Recording exceeds the processing limit.') : null, chunk); } });
        // pipeline destroys the GCS request and file writer on AbortSignal. A
        // per-attempt path means a stale worker never deletes a retry's input.
        await pipeline(source, limit, output, { signal });
        signal?.throwIfAborted(); await ensureRegular(dest); return dest;
      } catch (failure) {
        source?.destroy(); output?.destroy();
        if(ownsCopy)await discardCopy(dest).catch(() => {}); throw failure;
      }
    },
    async releaseLocal(key, { attemptId } = {}) { if (cloud) await discardCopy(localCopy(keyId(key), attemptId)); },
    async remove(key) { const id = keyId(key); if (cloud) await (await getBucket()).file(key).delete({ ignoreNotFound: true }); else await unlink(file(id)).catch(error => { if (error.code !== 'ENOENT') throw error; }); await unlink(file(id, '.partial.webm')).catch(() => {}); await discardCopies(id); },
    async discard(outputPath) { const filename = path.resolve(outputPath); if (path.dirname(filename) !== directory || !/^[a-f\d-]{36}\.partial\.webm$/.test(path.basename(filename))) throw new Error('Invalid temporary recording path.'); await unlink(filename).catch(error => { if (error.code !== 'ENOENT') throw error; }); },
    async exists(key) { try { if (cloud) return (await (await getBucket()).file(key).exists())[0]; await stat(file(keyId(key))); return true; } catch { return false; } },
  };
}
