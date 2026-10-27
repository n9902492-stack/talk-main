import {sqliteMigrationCount} from './helpers/migration-count.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {whiteboardHarness,element,createEdit} from './helpers/whiteboard.mjs';
import {validateElement,boardBounds,whiteboardTextLines} from '../frontend/src/lib/whiteboardModel.js';
async function ready(t,options={}){const h=await whiteboardHarness(options);t.after(h.close);const host=await h.account('Host'+randomUUID()),member=await h.account('Member'+randomUUID());await host.create();await host.join();await member.join();assert.equal((await host.board('/open',{})).status,200);return {...h,host,member};}

test('strict element validation covers all drawing types and rejects executable/oversized/nonfinite input',()=>{
  for(const type of ['pen','highlighter','text','sticky','rectangle','rounded','ellipse','line','arrow','image'])assert.equal(validateElement(element(type)).type,type);
  for(const input of [element('script'),element('text',{text:'x'.repeat(4001)}),element('pen',{points:[NaN,0]}),element('rectangle',{x:Infinity}),element('image',{src:'https://evil.test/'}),element('text',{html:'<script>'}),{...element(),id:'__proto__'},element('rectangle',{stroke:'url(javascript:bad)'})])assert.throws(()=>validateElement(input));
  assert.throws(()=>validateElement({version:44},true));assert.ok(boardBounds([validateElement(element('rectangle',{rotation:45}))]).width>100);
  assert.ok(whiteboardTextLines(validateElement(element('sticky',{width:120,text:'A long private note that wraps into several lines.'}))).length>2);
});
test('whiteboard capability can be disabled without changing authentication or meetings',async t=>{
  const h=await whiteboardHarness({enabled:false});t.after(h.close);const host=await h.account();assert.equal((await host.request('config')).body.whiteboardConfigured,false);assert.equal((await host.board()).status,404);assert.equal((await host.create()).status,201);
});
test('three admitted editors merge distinct objects, incremental reads and duplicate operations are durable',async t=>{
  const {host,member,account,database}=await ready(t);const third=await account();await third.join();
  assert.equal((await member.edit([createEdit(element())])).status,403);
  await host.board('/manage',{action:'default_edit',canEdit:true});
  const objects=[element('rectangle'),element('sticky',{text:'Manager follow-up'}),element('arrow',{points:[0,0,180,90]})];
  const results=await Promise.all([host,member,third].map((person,i)=>person.edit([createEdit(objects[i])])));assert.deepEqual(results.map(r=>r.status),[200,200,200]);
  const snapshot=(await third.board()).body;assert.equal(snapshot.elements.length,3);assert.equal(snapshot.board.revision,3);
  assert.equal((await member.board('?since=0')).body.operations.length,3);
  const body={requestId:randomUUID(),edits:[createEdit(element())]};const first=await host.board('/operations',body),duplicate=await host.board('/operations',body);assert.equal(first.body.revision,duplicate.body.revision);assert.equal(duplicate.body.idempotent,true);
  assert.equal((await member.board('/operations',body)).status,409);assert.equal(database.prepare('SELECT COUNT(*) AS n FROM talk_whiteboard_operations').get().n,4);
});
test('same-object compare-and-swap conflicts and own-undo never overwrite another editor',async t=>{
  const {host,member}=await ready(t);await host.board('/manage',{action:'default_edit',canEdit:true});const e=element();const created=await host.edit([createEdit(e)]);const change={kind:'patch',id:e.id,expectedVersion:created.body.revision,patch:{x:70}};
  const results=await Promise.all([host.edit([change]),member.edit([{...change,patch:{y:90}}])]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  assert.equal((await member.board('/operations',{requestId:randomUUID(),undoRevision:created.body.revision})).status,409);
  const latest=(await member.board()).body.elements[0];await member.edit([{kind:'patch',id:e.id,expectedVersion:latest.version,patch:{text:'Their edit'}}]);
  assert.equal((await host.board('/operations',{requestId:randomUUID(),undoRevision:created.body.revision})).status,409);
  const own=await host.edit([createEdit(element('sticky',{text:'Mine'}))]);const undone=await host.board('/operations',{requestId:randomUUID(),undoRevision:own.body.revision});assert.equal(undone.status,200);
  const redone=await host.board('/operations',{requestId:randomUUID(),undoRevision:undone.body.revision});assert.equal(redone.status,200);assert.equal((await host.board()).body.elements.length,2);
});
test('waiting, removed, cross-meeting and revoked sessions cannot read, edit, export or obtain images',async t=>{
  const {host,member,account}=await ready(t);await host.action('approval_on');const waiting=await account();await waiting.join();
  for(const person of [waiting])for(const suffix of ['', '/export/svg','/images/unknown'])assert.equal((await person.board(suffix)).status,404);
  assert.equal((await waiting.board('/open',{})).status,404);await host.action('admit',waiting.id);assert.equal((await waiting.board()).status,200);
  await host.action('remove',member.id);assert.equal((await member.board()).status,404);assert.equal((await member.edit([createEdit(element())])).status,404);
  const stranger=await account();const created=await stranger.request('meetings',{title:'Independent room',approvalRequired:false});assert.equal(created.status,201);const second=created.body.meeting.id;await stranger.join(second);assert.equal((await stranger.board('/open',{},second)).status,200);assert.equal((await stranger.board()).status,404);assert.equal((await host.board('',undefined,second)).status,404);
  assert.equal((await host.request('logout',{})).status,200);assert.equal((await host.board()).status,401);
});
test('owner lock, per-user overrides, co-host scope and ended-meeting access are backend enforced',async t=>{
  const {host,member,account}=await ready(t);const cohost=await account();await cohost.join();await host.action('cohost_add',cohost.id);
  assert.equal((await cohost.board('/manage',{action:'clear',expectedRevision:0})).status,403);
  assert.equal((await cohost.board('/manage',{action:'permission',accountId:member.id,canEdit:true})).status,200);assert.equal((await member.board()).body.canEdit,true);
  await host.board('/manage',{action:'lock'});assert.equal((await cohost.edit([createEdit(element())])).status,403);assert.equal((await member.edit([createEdit(element())])).status,403);assert.equal((await host.edit([createEdit(element())])).status,200);
  await host.board('/manage',{action:'unlock'});assert.equal((await cohost.edit([createEdit(element())])).status,200);
  await host.action('end');assert.equal((await member.board()).status,404);assert.equal((await cohost.board()).status,200);assert.equal((await host.board()).body.ended,true);
});
test('private uploads are decoded, normalized and meeting-scoped; unsafe payloads and forged images fail',async t=>{
  const {host,member,account}=await ready(t);const png=await sharp({create:{width:64,height:48,channels:4,background:'#2678b7'}}).png().toBuffer();
  assert.equal((await member.request('meetings/talk-workshop/whiteboard/images',png,{raw:true})).status,403);
  const upload=await host.request('meetings/talk-workshop/whiteboard/images',png,{raw:true});assert.equal(upload.status,201);assert.equal(upload.body.width,64);
  const image=await member.board('/images/'+upload.body.id);assert.equal(image.status,200);assert.equal((await sharp(image.body).metadata()).format,'webp');
  const outsider=await account();assert.equal((await outsider.board('/images/'+upload.body.id)).status,404);
  assert.equal((await host.request('meetings/talk-workshop/whiteboard/images',Buffer.from('<svg onload="bad"/>'),{raw:true})).status,400);
  assert.equal((await host.edit([createEdit(element('image',{imageId:randomUUID()}))])).status,400);
  assert.equal((await host.edit([createEdit(element('image',{imageId:upload.body.id}))])).status,200);
  assert.equal((await host.edit([createEdit(element('text',{x:220,y:40,width:280,text:'Talk export evidence'}))])).status,200);
  const svg=await host.board('/export/svg');assert.equal(svg.status,200);assert.match(svg.body.toString(),/data:image\/png;base64/);assert.equal(svg.headers.get('Cache-Control'),'no-store');
  const pngExport=await host.board('/export/png');assert.equal(pngExport.status,200);assert.ok((await sharp(pngExport.body).metadata()).width>0);
  const pixel=await sharp(pngExport.body).extract({left:120,top:90,width:1,height:1}).removeAlpha().raw().toBuffer();assert.ok(pixel[0]<80&&pixel[2]>150,'private uploaded image must appear in actual PNG pixels');
  const pdfExport=await host.board('/export/pdf');assert.equal(pdfExport.status,200);assert.equal(pdfExport.body.subarray(0,5).toString(),'%PDF-');
  mkdirSync('artifacts/qa',{recursive:true});writeFileSync('artifacts/qa/phase10-image-api.png',pngExport.body);writeFileSync('artifacts/qa/phase10-image-api.pdf',pdfExport.body);
});
test('CSRF, origin, malformed input, size and per-account edit rate limits remain enforced',async t=>{
  const {host}=await ready(t);
  const route='meetings/talk-workshop/whiteboard/operations',body={requestId:randomUUID(),edits:[createEdit(element())]};
  assert.equal((await host.request(route,body,{headers:{Origin:'https://evil.test'}})).status,403);
  assert.equal((await host.request(route,body,{headers:{'X-CSRF-Token':'forged'}})).status,403);
  assert.equal((await host.edit([createEdit(element('text',{text:'x'.repeat(4001)}))])).status,400);
  assert.equal((await host.request(route,{...body,large:'x'.repeat(270000)})).status,413);
  let limited=false;for(let i=0;i<125;i++){const result=await host.edit([createEdit(element())]);if(result.status===429){limited=true;break;}assert.equal(result.status,200);}assert.equal(limited,true);
});
test('ephemeral cursors expire and disappear after removal; snapshots restore through a new revision',async t=>{
  const {host,member,advance}=await ready(t);await member.board('/cursor',{x:42,y:75});assert.equal((await host.board()).body.cursors.length,1);advance(8001);assert.equal((await host.board()).body.cursors.length,0);
  for(let i=0;i<25;i++)assert.equal((await host.edit([createEdit(element())])).status,200);
  const snapshots=(await host.board('/snapshots')).body.snapshots;assert.deepEqual(snapshots.map(s=>s.revision),[25,0]);
  await host.board('/manage',{action:'clear',expectedRevision:25});assert.equal((await host.board()).body.elements.length,0);
  assert.equal((await host.board('/manage',{action:'restore',snapshotRevision:25,expectedRevision:26})).status,200);assert.equal((await host.board()).body.elements.length,25);assert.equal((await host.board()).body.board.revision,27);
  await member.board('/cursor',{x:10,y:10});await host.action('remove',member.id);assert.equal((await host.board()).body.cursors.length,0);
});
test('SQLite state survives a fresh server/database; retention deletes private content without touching meeting data',async t=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'talk-board-')),filename=path.join(dir,'test.sqlite');let h=await whiteboardHarness({databasePath:filename});
  t.after(async()=>{await h.close();rmSync(dir,{recursive:true,force:true});});
  let host=await h.account('PersistentHost');await host.create();await host.join();await host.board('/open',{});await host.edit([createEdit(element('sticky',{text:'Persisted privately'}))]);await h.close();
  h=await whiteboardHarness({databasePath:filename});host=await h.account('PersistentHost');assert.equal((await host.board()).body.elements[0].text,'Persisted privately');assert.equal(h.database.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n,sqliteMigrationCount);
  h.advance(31*86400000); // Renew the fixture session at the new clock.
  host=await h.account('PersistentHost');assert.equal((await host.board()).status,404);assert.equal(h.database.prepare('SELECT state_json FROM talk_whiteboards').get().state_json,'{}');assert.equal(h.database.prepare('SELECT COUNT(*) AS n FROM talk_meetings').get().n,1);
});
test('bounded canvas and operation-history quotas reject oversized growth atomically',async t=>{
  const {host,database}=await ready(t);
  for(let i=0;i<60;i++){const result=await host.edit(Array.from({length:20},()=>createEdit(element())));assert.equal(result.status,200);}
  assert.equal((await host.board()).body.elements.length,1200);assert.equal((await host.edit([createEdit(element())])).status,413);assert.equal((await host.board()).body.board.revision,60);
  database.prepare('UPDATE talk_whiteboards SET history_bytes=?').run(32*1024*1024);
  const e=(await host.board()).body.elements[0];assert.equal((await host.edit([{kind:'delete',id:e.id,expectedVersion:e.version}])).status,413);assert.equal((await host.board()).body.elements.length,1200);
});
