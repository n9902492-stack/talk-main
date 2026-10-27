import {sqliteMigrationCount} from './helpers/migration-count.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createAuthApp } from '../backend/src/auth.mjs';
import { openAuthDatabase } from '../backend/src/database.mjs';
import { normalizeAvatar, normalizeBackgroundImage } from '../backend/src/avatars.mjs';
import { reactionChoices } from '../backend/src/meeting-management.mjs';
import { avatarPresets } from '../frontend/src/lib/avatarCatalog.js';
import { createMeetingService } from '../backend/src/meetings.mjs';

async function harness(database = openAuthDatabase()) {
  const origin='http://localhost:3001';
  const peers=[];
  const meetings=createMeetingService({LIVEKIT_URL:'ws://127.0.0.1:7880',LIVEKIT_API_KEY:'avatar-test-key',LIVEKIT_API_SECRET:'avatar-test-private-key-at-least-32-chars'});
  meetings.admin={listParticipants:async()=>peers,sendData:async()=>{},updateParticipant:async()=>{},removeParticipant:async()=>{},deleteRoom:async()=>{}};
  const app=createAuthApp({clientId:'avatar-test.apps.googleusercontent.com', origins:[origin],database,meetings,verifyCredential:async value=>JSON.parse(value)});
  const server=app.listen(0,'127.0.0.1'); await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}/api/auth/`;
  async function account(name, picture = 'https://lh3.googleusercontent.com/a/avatar-fixture') {
    const jar=new Map(); let csrf='';
    const req=async(route,body,headers={})=>{
      const raw=Buffer.isBuffer(body);
      const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{Cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; '),...(body===undefined?{}:{Origin:origin,'Content-Type':'application/json','X-CSRF-Token':csrf}),...headers},...(body===undefined?{}:{body:raw?body:JSON.stringify(body)})});
      for(const cookie of response.headers.getSetCookie()){const[k,v]=cookie.split(';')[0].split('=');jar.set(k,v);}
      const type=response.headers.get('Content-Type')||'';
      return {status:response.status,body:type.startsWith('image/')?Buffer.from(await response.arrayBuffer()):await response.json(),headers:response.headers};
    };
    const cfg=(await req('config')).body;csrf=cfg.csrfToken;
    const seconds=Math.floor(Date.now()/1000);
    const signed=await req('google',{credential:JSON.stringify({iss:'https://accounts.google.com',aud:cfg.clientId,sub:name,name,picture,email:`${name}@example.test`,email_verified:true,nonce:cfg.nonce,iat:seconds,exp:seconds+3600})});
    assert.equal(signed.status,200);csrf=signed.body.csrfToken;
    assert.equal((await req('google/confirm',{})).status,200);
    return {req,id:signed.body.user.id};
  }
  return {database,account,peers,close:async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));app.locals.closeAuthDatabase();}};
}
const png=()=>sharp({create:{width:800,height:600,channels:3,background:'#66a3d0'}}).png().toBuffer();
test('24 shared reactions and 12 original presets have unique allowlisted identifiers',()=>{
  assert.equal(reactionChoices.length,24);assert.equal(new Set(reactionChoices).size,24);
  assert.equal(avatarPresets.length,12);assert.equal(new Set(avatarPresets.map(a=>a.id)).size,12);
});
test('image validation rejects active/animated/mismatched/oversized/decompression-heavy input; normalizes pixels and strips metadata',async()=>{
  const clean=await normalizeAvatar(await png(),'image/png');const meta=await sharp(Buffer.from(clean,'base64')).metadata();
  assert.equal(meta.format,'webp');assert.equal(meta.width,512);assert.equal(meta.height,512);assert.equal(meta.exif,undefined);
  for(const [bytes,type] of [[Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),'image/png'],[await png(),'image/jpeg'],[Buffer.alloc(2097153),'image/png'],[Buffer.from('GIF89a'),'image/gif'],[Buffer.alloc(0),'image/png']]) await assert.rejects(normalizeAvatar(bytes,type));
  const huge=await sharp({create:{width:4000,height:3000,channels:3,background:'white'}}).png().toBuffer();await assert.rejects(normalizeAvatar(huge,'image/png'));
  const frames=Buffer.alloc(10*20*3,120);frames.fill(230,300);
  const animated=await sharp(frames,{raw:{width:10,height:20,channels:3,pageHeight:10}}).webp({loop:0,delay:[100,100]}).toBuffer();
  assert.ok((await sharp(animated).metadata()).pages>1);await assert.rejects(normalizeAvatar(animated,'image/webp'));
  const multi=await sharp(await png()).joinChannel(Buffer.alloc(800*600,255),{raw:{width:800,height:600,channels:1}}).webp().toBuffer();assert.ok(await normalizeAvatar(multi,'image/webp'));
});
test('profile changes require session, origin, CSRF and valid selections; unrelated accounts cannot read uploads',async t=>{
  const h=await harness();t.after(async()=>{await h.close();h.database.close();});
  const a=await h.account('Owner'),b=await h.account('Stranger');
  assert.equal((await a.req('profile/avatar',{kind:'preset',presetId:'talk-1'},{'X-CSRF-Token':'wrong'})).status,403);
  assert.equal((await a.req('profile/avatar',{kind:'initials'},{Origin:'https://evil.test'})).status,403);
  assert.equal((await a.req('profile/avatar',{kind:'preset',presetId:'../../evil'})).status,400);
  for(const kind of ['default','initials'])assert.equal((await a.req('profile/avatar',{kind})).body.user.avatar.kind,kind);
  const saved=await a.req('profile/avatar',{kind:'preset',presetId:'talk-9'});assert.equal(saved.body.user.avatar.presetId,'talk-9');
  assert.equal((await a.req('session')).body.user.avatar.presetId,'talk-9');
  const image=await a.req('profile/avatar/image',await png(),{'Content-Type':'image/png'});assert.equal(image.status,200);
  const url=image.body.user.avatar.imageUrl.replace('/api/auth/','');
  assert.equal((await b.req(url)).status,404);
  const own=await a.req(url);assert.equal(own.status,200);assert.equal(own.headers.get('X-Content-Type-Options'),'nosniff');assert.equal(own.headers.get('Cache-Control'),'no-store');
  assert.equal((await sharp(own.body).metadata()).format,'webp');
  assert.equal((await a.req('profile/avatar/image',Buffer.from('<svg/>'),{'Content-Type':'image/svg+xml'})).status,400);
  assert.equal((await a.req('profile/avatar/image',Buffer.alloc(2097153),{'Content-Type':'image/png'})).status,413);
  const headers={Cookie:''};assert.equal((await a.req('profile/avatar',{kind:'default'},headers)).status,401);
});
test('avatar data survives SQLite reopening independently of Google profile pictures',async()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'talk-avatar-'));const file=path.join(directory,'auth.sqlite');
  let database=openAuthDatabase(file),h=await harness(database);
  try{
    const a=await h.account('Persistent');const result=await a.req('profile/avatar/image',await png(),{'Content-Type':'image/png'});assert.equal(result.status,200);
    await h.close();database.close();database=openAuthDatabase(file);h=await harness(database);
    const again=await h.account('Persistent','https://lh3.googleusercontent.com/a/changed-google-picture');const session=(await again.req('session')).body;
    assert.equal(session.user.id,a.id);assert.equal(session.user.avatar.kind,'upload');
    assert.equal(session.user.picture,'https://lh3.googleusercontent.com/a/changed-google-picture');
    assert.equal((await again.req(session.user.avatar.imageUrl.replace('/api/auth/',''))).status,200);
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n,sqliteMigrationCount);
  }finally{await h.close();database.close();rmSync(directory,{recursive:true,force:true});}
});
test('avatar updates are rate limited per account',async t=>{
  const h=await harness();t.after(async()=>{await h.close();h.database.close();});const a=await h.account('Rate');
  for(let i=0;i<20;i++)assert.equal((await a.req('profile/avatar',{kind:'initials'})).status,200);
  const limited=await a.req('profile/avatar',{kind:'default'});assert.equal(limited.status,429);assert.ok(Number(limited.headers.get('Retry-After'))>0);
});
test('custom backgrounds validate and normalize still images, remain private, replace old images and survive database reopening',async()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'talk-background-'));const file=path.join(directory,'auth.sqlite');
  let database=openAuthDatabase(file),h=await harness(database);
  try{
    const owner=await h.account('BackgroundOwner'),stranger=await h.account('BackgroundStranger');
    assert.equal((await owner.req('profile/background')).body.version,null);
    assert.equal((await owner.req('profile/background/image',await png(),{'Content-Type':'image/png','X-CSRF-Token':'invalid'})).status,403);
    assert.equal((await owner.req('profile/background/image',Buffer.from('<svg/>'),{'Content-Type':'image/png'})).status,400);
    assert.equal((await owner.req('profile/background/image',Buffer.alloc(2097153),{'Content-Type':'image/png'})).status,413);
    const first=await owner.req('profile/background/image',await png(),{'Content-Type':'image/png'});assert.equal(first.status,200);
    assert.equal((await stranger.req(first.body.imageUrl.replace('/api/auth/',''))).status,404);
    const bytes=(await owner.req(first.body.imageUrl.replace('/api/auth/',''))).body;const meta=await sharp(bytes).metadata();
    assert.equal(meta.format,'webp');assert.equal(meta.width,800);assert.equal(meta.height,600);assert.equal(meta.exif,undefined);
    const second=await owner.req('profile/background/image',await png(),{'Content-Type':'image/png'});assert.notEqual(second.body.version,first.body.version);
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM account_backgrounds').get().n,1);
    await h.close();database.close();database=openAuthDatabase(file);h=await harness(database);const again=await h.account('BackgroundOwner');
    assert.equal((await again.req('profile/background')).body.version,second.body.version);assert.equal((await again.req('profile/background/image')).status,200);
    assert.equal((await again.req('profile/background',undefined,{Cookie:''})).status,401);
    const large=await sharp({create:{width:3000,height:2000,channels:3,background:'blue'}}).png().toBuffer();
    const resized=await sharp(Buffer.from(await normalizeBackgroundImage(large,'image/png'),'base64')).metadata();assert.ok(resized.width<=1920&&resized.height<=1080);
  }finally{await h.close();database.close();rmSync(directory,{recursive:true,force:true});}
});
test('uploaded avatars and profile descriptors are visible only after admission and revoked on removal or meeting end',async t=>{
  const h=await harness();t.after(async()=>{await h.close();h.database.close();});const host=await h.account('Host'),guest=await h.account('Guest');
  const saved=await host.req('profile/avatar/image',await png(),{'Content-Type':'image/png'});const image=saved.body.user.avatar.imageUrl.replace('/api/auth/','');
  assert.equal((await host.req('meetings/talk-workshop/create',{})).status,201);
  const owner=await host.req('meetings/talk-workshop/token',{displayName:'Host'});h.peers.push({identity:owner.body.identity});
  assert.equal((await guest.req('meetings/talk-workshop/token',{displayName:'Guest'})).status,202);
  assert.equal((await guest.req(image)).status,404);assert.deepEqual((await guest.req('meetings/talk-workshop/state')).body.members,[]);
  assert.equal((await host.req('meetings/talk-workshop/actions',{action:'admit',target:guest.id})).status,200);
  assert.equal((await guest.req(image)).status,200);const state=(await guest.req('meetings/talk-workshop/state')).body;
  assert.equal(state.members[0].avatar.kind,'upload');assert.equal(state.members[0].avatar.imageUrl,saved.body.user.avatar.imageUrl);
  assert.equal((await host.req('meetings/talk-workshop/actions',{action:'remove',target:guest.id})).status,200);assert.equal((await guest.req(image)).status,404);
  assert.equal((await host.req('meetings/talk-workshop/actions',{action:'end'})).status,200);assert.equal((await guest.req(image)).status,404);
});
