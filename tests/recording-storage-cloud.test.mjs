import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import { PassThrough, Readable } from 'node:stream';
import { createRecordingStorage } from '../backend/src/recording-storage.mjs';

async function harness(t,createStream) {
  const directory=path.resolve('artifacts/qa/cloud-storage-'+randomUUID()),deleted=[];
  const bucket={file:key=>({createReadStream:()=>createStream(key),delete:async()=>{deleted.push(key);}})};
  const storage=createRecordingStorage({RECORDING_STORAGE:'gcs',RECORDING_GCS_BUCKET:'unit-fixture-private-bucket',RECORDING_LOCAL_PATH:directory},{bucket});
  t.after(async()=>{if(directory.startsWith(path.resolve('artifacts/qa')+path.sep))await fs.rm(directory,{recursive:true,force:true});});
  return{storage,directory,deleted};
}
async function wait(predicate){for(let i=0;i<100;i++){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,5));}assert.fail('Cloud adapter fixture did not reach the expected state.');}

test('cloud transcription downloads use separate private paths and release only their exact attempt',async t=>{
  const h=await harness(t,()=>Readable.from(['PRIVATE MEDIA FIXTURE'])),id=randomUUID(),key=h.storage.keyFor(id),first=randomUUID(),second=randomUUID();
  const a=await h.storage.localPath(key,{attemptId:first}),b=await h.storage.localPath(key,{attemptId:second});
  assert.notEqual(a,b);assert.equal(await fs.readFile(a,'utf8'),'PRIVATE MEDIA FIXTURE');
  await h.storage.releaseLocal(key,{attemptId:first});await assert.rejects(fs.stat(a));assert.equal((await fs.stat(b)).isFile(),true);
  await h.storage.releaseLocal(key,{attemptId:second});assert.deepEqual(await fs.readdir(h.directory),[]);
});

test('aborting a streamed cloud download destroys its request and removes its partial attempt copy',async t=>{
  const source=new PassThrough(),h=await harness(t,()=>source),key=h.storage.keyFor(randomUUID()),controller=new AbortController();
  const downloading=h.storage.localPath(key,{attemptId:randomUUID(),signal:controller.signal});
  // Attach the rejection observer before triggering cancellation.
  const rejected=assert.rejects(downloading);source.write('PARTIAL PRIVATE FIXTURE');
  await wait(async()=>{try{return(await fs.readdir(h.directory)).length===1;}catch{return false;}});
  controller.abort();await rejected;assert.equal(source.destroyed,true);assert.deepEqual(await fs.readdir(h.directory),[]);
});

test('a duplicate attempt never deletes an already-owned transcription input',async t=>{
  const h=await harness(t,()=>Readable.from(['FIRST PRIVATE INPUT'])),key=h.storage.keyFor(randomUUID()),attemptId=randomUUID();
  const existing=await h.storage.localPath(key,{attemptId});
  await assert.rejects(h.storage.localPath(key,{attemptId}));assert.equal(await fs.readFile(existing,'utf8'),'FIRST PRIVATE INPUT');
});

test('deletion removes all attempt copies for that recording while preserving another recording cache',async t=>{
  const h=await harness(t,()=>Readable.from(['PRIVATE MEDIA FIXTURE'])),key=h.storage.keyFor(randomUUID()),otherKey=h.storage.keyFor(randomUUID());
  await h.storage.localPath(key,{attemptId:randomUUID()});await h.storage.localPath(key,{attemptId:randomUUID()});
  const other=await h.storage.localPath(otherKey,{attemptId:randomUUID()});await h.storage.remove(key);
  assert.deepEqual(await fs.readdir(h.directory),[path.basename(other)]);assert.deepEqual(h.deleted,[key]);
});

test('cloud attempt identifiers cannot escape private storage and pre-aborted downloads make no request',async t=>{
  let requests=0;const h=await harness(t,()=>{requests++;return Readable.from(['fixture']);}),key=h.storage.keyFor(randomUUID());
  await assert.rejects(h.storage.localPath(key,{attemptId:'../../.env.local'}));await assert.rejects(h.storage.releaseLocal(key,{attemptId:'../../.env.local'}));
  const controller=new AbortController();controller.abort();await assert.rejects(h.storage.localPath(key,{attemptId:randomUUID(),signal:controller.signal}));assert.equal(requests,0);
});

test('an acknowledged cloud upload still returns its private key after concurrent partial-file cleanup',async t=>{
  const directory=path.resolve('artifacts/qa/cloud-upload-'+randomUUID()),id=randomUUID();let uploaded=false;
  t.after(async()=>{if(directory.startsWith(path.resolve('artifacts/qa')+path.sep))await fs.rm(directory,{recursive:true,force:true});});
  const bucket={getMetadata:async()=>[{iamConfiguration:{uniformBucketLevelAccess:{enabled:true},publicAccessPrevention:'enforced'}}],upload:async source=>{uploaded=true;await fs.unlink(source);}};
  const storage=createRecordingStorage({RECORDING_STORAGE:'gcs',RECORDING_GCS_BUCKET:'unit-fixture-private-bucket',RECORDING_LOCAL_PATH:directory},{bucket});
  const output=await storage.allocate(id);await fs.writeFile(output,'UNIT MEDIA FIXTURE');
  const result=await storage.commit(id,{path:output,mimeType:'audio/webm'});assert.equal(uploaded,true);assert.equal(result.key,storage.keyFor(id));assert.ok(result.bytes>0);
});
