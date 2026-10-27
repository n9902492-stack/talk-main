import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {resetHarness} from './helpers/password-reset.mjs';

test('code then new password resets only the verified password identity; code hashes and session revocation are enforced',async t=>{
  const h=await resetHarness();t.after(h.close);const existing=await h.verified(),other=h.client();await other.post('email/login',{email:'member@example.test',password:h.password});const user=h.client();
  const requested=await user.reset('request',{email:' MEMBER@example.test '});assert.equal(requested.status,202);await h.flush();
  const row=h.database.prepare('SELECT * FROM password_reset_challenges').get();assert.match(row.code_hash,/^scrypt\$/);assert.ok(!JSON.stringify(row).includes(h.code()));
  assert.equal((await user.reset('complete',{password:'new long password',confirmPassword:'new long password'})).status,403);
  assert.equal((await user.reset('verify',{code:h.code()})).status,200);assert.equal(h.database.prepare('SELECT code_hash FROM password_reset_challenges').get().code_hash,null);
  assert.equal((await user.reset('complete',{password:'short',confirmPassword:'short'})).status,400);
  assert.equal((await user.reset('complete',{password:'new long password',confirmPassword:'different password'})).status,400);
  assert.equal((await user.reset('complete',{password:'new long password',confirmPassword:'new long password'})).status,200);
  assert.equal((await existing.request('session')).body.user,null);assert.equal((await other.request('session')).body.user,null);assert.equal((await user.request('session')).body.user,null);
  assert.equal((await user.post('email/login',{email:'member@example.test',password:h.password})).status,401);
  assert.equal((await user.post('email/login',{email:'member@example.test',password:'new long password'})).status,200);
  assert.equal((await user.reset('verify',{code:h.code()})).status,403);
});
test('unknown, Google-only and unverified accounts have the same public response and cannot acquire a password',async t=>{
  const h=await resetHarness();t.after(h.close);await h.verified();
  const google=h.client(),cfg=(await google.request('config')).body,seconds=Math.floor(h.now()/1000);
  await google.post('google',{credential:JSON.stringify({iss:'https://accounts.google.com',aud:cfg.clientId,sub:'google-only',name:'Google',email:'google@example.test',email_verified:true,nonce:cfg.nonce,iat:seconds,exp:seconds+3600})});
  const unverified=h.client();await unverified.post('email/signup',{name:'Unverified',email:'pending@example.test',password:h.password});
  const results=[];for(const email of ['member@example.test','absent@example.test','google@example.test','pending@example.test']){const c=h.client(),response=await c.reset('request',{email});results.push(response);await h.flush();if(email!=='member@example.test')assert.equal((await c.reset('verify',{code:String(100000+results.length+2)})).status,400);}
  assert.ok(results.every(r=>r.status===202&&r.body.message===results[0].body.message));assert.equal(h.delivered.filter(m=>m.purpose==='password-reset').length,1);assert.equal(h.database.prepare("SELECT COUNT(*) AS n FROM identities WHERE provider='password' AND provider_id='google@example.test'").get().n,0);
});
test('five incorrect attempts, expiry, resend cooldown and old-code invalidation',async t=>{
  const h=await resetHarness();t.after(h.close);await h.verified();const user=h.client();await user.reset('request',{email:'member@example.test'});await h.flush();const old=h.code();
  assert.equal((await user.reset('resend')).status,429);for(let i=0;i<5;i++){const response=await user.reset('verify',{code:'999999'});assert.equal(response.status,i===4?429:400);}
  assert.equal((await user.reset('verify',{code:old})).status,429);h.advance(60001);assert.equal((await user.reset('resend')).status,202);await h.flush();assert.equal((await user.reset('verify',{code:old})).status,400);
  h.advance(300001);assert.equal((await user.reset('verify',{code:h.code()})).status,410);assert.equal((await user.reset('resend')).status,202);await h.flush();assert.equal((await user.reset('verify',{code:h.code()})).status,200);
});
test('hostile origins, CSRF, challenge substitution and cross-flow signup codes are rejected',async t=>{
  const h=await resetHarness();t.after(h.close);await h.verified();const user=h.client(),stranger=h.client();
  assert.equal((await user.post('email/password-reset/request',{email:'member@example.test'},'config',{Origin:'https://evil.test'})).status,403);
  assert.equal((await user.post('email/password-reset/request',{email:'member@example.test'},'config',{'X-CSRF-Token':'forged'})).status,403);
  await user.reset('request',{email:'member@example.test'});await h.flush();assert.equal((await stranger.reset('verify',{code:h.code()})).status,403);
  assert.equal((await user.reset('verify',{code:h.delivered.find(m=>m.purpose!=='password-reset').code})).status,400);
  assert.equal((await user.post('email/verify',{code:h.code()},'email/verification')).status,403);
});
test('delivery failure stays generic and is recoverable; per-email and per-IP limits protect SMTP',async t=>{
  const h=await resetHarness();t.after(h.close);await h.verified();const user=h.client();h.failDelivery(true);const response=await user.reset('request',{email:'member@example.test'});assert.equal(response.status,202);await h.flush();assert.equal(h.code(),undefined);assert.equal((await user.request('email/password-reset')).body.reset.verified,false);
  h.failDelivery(false);h.advance(60001);await user.reset('resend');await h.flush();assert.ok(h.code());
  for(let i=0;i<3;i++){h.advance(60001);assert.equal((await user.reset('resend')).status,202);await h.flush();}h.advance(60001);assert.equal((await user.reset('resend')).status,429);
  for(let i=0;i<25;i++){const c=h.client();await c.reset('request',{email:`unknown-${i}@example.test`});}assert.equal((await h.client().reset('request',{email:'last@example.test'})).status,429);
});
test('Firebase Hosting encrypted cookies carry reset state securely',async t=>{
  const h=await resetHarness({hosting:true,origin:'https://talk.example.test'});t.after(h.close);await h.verified();const user=h.client(),start=await user.reset('request',{email:'member@example.test'});assert.ok(start.cookies.some(c=>c.startsWith('__session=')&&c.includes('Secure')&&c.includes('HttpOnly')));assert.ok(!start.cookies.some(c=>c.startsWith('talk_password_reset=')));await h.flush();assert.equal((await user.reset('verify',{code:h.code()})).status,200);assert.equal((await user.reset('complete',{password:'new hosting password',confirmPassword:'new hosting password'})).status,200);
});
test('a verified reset grant persists across a fresh SQLite server',async t=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'talk-password-reset-')),file=path.join(dir,'auth.sqlite');let h=await resetHarness({databasePath:file});t.after(async()=>{await h.close();rmSync(dir,{recursive:true,force:true});});await h.verified();const user=h.client();await user.reset('request',{email:'member@example.test'});await h.flush();await user.reset('verify',{code:h.code()});const cookies=[...user.jar];await h.close();h=await resetHarness({databasePath:file});const restored=h.client();for(const [k,v] of cookies)restored.jar.set(k,v);assert.equal((await restored.request('email/password-reset')).body.reset.verified,true);assert.equal((await restored.reset('complete',{password:'restored password',confirmPassword:'restored password'})).status,200);
});

test('concurrent completion is single-use and a newer reset invalidates an older verified grant',async t=>{
  const h=await resetHarness();t.after(h.close);await h.verified();const older=h.client(),newer=h.client();
  await older.reset('request',{email:'member@example.test'});await h.flush();await older.reset('verify',{code:h.code()});h.advance(60001);
  await newer.reset('request',{email:'member@example.test'});await h.flush();
  assert.equal((await older.reset('complete',{password:'old grant password',confirmPassword:'old grant password'})).status,403);
  await newer.reset('verify',{code:h.code()});
  const responses=await Promise.all([newer.reset('complete',{password:'new grant password',confirmPassword:'new grant password'}),newer.reset('complete',{password:'new grant password',confirmPassword:'new grant password'})]);
  assert.equal(responses.filter(r=>r.status===200).length,1);assert.ok(responses.some(r=>[403,409].includes(r.status)));
});

test('a stale worker claim recovers after restart and rotates its single-use code',async t=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'talk-reset-worker-')),file=path.join(dir,'auth.sqlite');let h=await resetHarness({databasePath:file});
  t.after(async()=>{await h.close();rmSync(dir,{recursive:true,force:true});});await h.verified();const user=h.client();await user.reset('request',{email:'member@example.test'});await h.flush();const old=h.code(),cookies=[...user.jar];
  h.database.prepare("UPDATE password_reset_challenges SET state='sending',deliveries=1,claimed_at=?").run(Date.now()-100000);await h.close();h=await resetHarness({databasePath:file});await h.flush();
  const restored=h.client();for(const [k,v] of cookies)restored.jar.set(k,v);assert.ok(h.code());
  assert.equal((await restored.reset('verify',{code:old})).status,400);assert.equal((await restored.reset('verify',{code:h.code()})).status,200);
});
