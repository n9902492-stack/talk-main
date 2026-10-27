import test from 'node:test';import assert from 'node:assert/strict';import net from 'node:net';import fs from 'node:fs';import path from 'node:path';import {DatabaseSync} from 'node:sqlite';import nodemailer from 'nodemailer';
import {schedulingTransport} from '../backend/src/scheduling/transport.mjs';
import {createConfirmationSmtpDiagnostics} from '../scripts/confirmation-smtp-diagnostics.mjs';
import {reserveConfirmationAttempt,completeConfirmationAttempt} from '../scripts/confirmation-send-guard.mjs';
const env={SCHEDULING_EMAIL_ENABLED:'true',SCHEDULING_PUBLIC_URL:'https://fixture.invalid',SCHEDULING_EMAIL_LINK_SECRET:Buffer.alloc(32,8).toString('base64url'),SMTP_HOST:'smtp.fixture.invalid',SMTP_USER:'fixture@example.invalid',SMTP_PASSWORD:'NOT_A_REAL_PASSWORD',SMTP_FROM:'fixture@example.invalid'};
const mail={jobId:'synthetic-diagnostics',to:'invitee@example.invalid',subject:'Synthetic local mock only',text:'PRIVATE_BODY_MUST_NOT_APPEAR https://fixture.invalid/#PRIVATE_TOKEN_MUST_NOT_APPEAR',html:'<p>PRIVATE_BODY_MUST_NOT_APPEAR</p>',calendar:'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n'};
async function run(t,behavior,{verify=true}={}){
 const sockets=new Set(),stats={connections:0,auth:0,dataCommands:0,dataCompleted:0,final250:0};
 const server=net.createServer(socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));stats.connections++;if(behavior==='greeting_timeout')return;
  socket.write('220 mock.fixture.invalid ESMTP\r\n');let buffer='',data=false;
  socket.on('data',chunk=>{buffer+=chunk.toString();let at;while((at=buffer.indexOf('\r\n'))>=0){const line=buffer.slice(0,at);buffer=buffer.slice(at+2);
   if(data){if(line!=='.')continue;data=false;stats.dataCompleted++;if(behavior==='drop_after_data'){socket.destroy();return;}if(behavior==='lost_ack')continue;stats.final250++;socket.write('250 2.0.0 Mock accepted PRIVATE_PROVIDER_TEXT\r\n');continue;}
   if(/^EHLO /.test(line))socket.write('250-mock.fixture.invalid\r\n250 AUTH PLAIN\r\n');
   else if(/^AUTH /.test(line)){stats.auth++;socket.write(behavior==='auth_rejected'?'535 5.7.8 Mock authentication rejected\r\n':'235 2.7.0 Mock authenticated\r\n');}
   else if(/^MAIL FROM:/.test(line)){if(behavior==='drop_before_data'){socket.destroy();return;}socket.write('250 2.1.0 Mock sender accepted\r\n');}
   else if(/^RCPT TO:/.test(line))socket.write('250 2.1.5 Mock recipient accepted\r\n');
   else if(line==='DATA'){stats.dataCommands++;data=true;socket.write('354 Continue\r\n');}
   else if(line==='QUIT'){socket.end('221 Mock bye\r\n');}
  }});
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 let smtp;const diagnostics=createConfirmationSmtpDiagnostics();
 const adapter=schedulingTransport(env,{verificationMailer:()=>({configured:true}),createTransport:options=>{
  assert.equal(options.requireTLS,true);assert.equal(options.tls.rejectUnauthorized,true);assert.equal(typeof options.logger.info,'function');
  // Only this loopback mock bypasses TLS and uses fixture credentials. Never
  // copy these settings into the real Gmail adapter or any running runtime.
  const logger=Object.fromEntries(['trace','debug','info','warn','error','fatal'].map(level=>[level,(...args)=>{diagnostics.logger[level](...args);options.logger[level](...args);} ]));
  smtp=nodemailer.createTransport({...options,host:'127.0.0.1',port:server.address().port,requireTLS:false,ignoreTLS:true,pool:false,maxRequeues:0,connectionTimeout:500,greetingTimeout:180,socketTimeout:180,logger,transactionLog:true,debug:false});
  const send=smtp.sendMail.bind(smtp);smtp.sendMail=async value=>{try{const response=await send(value);if(behavior==='post_accept_error')throw new Error('PRIVATE_POST_ACCEPT_ERROR');return response;}catch(e){diagnostics.error(e);throw e;}};return smtp;
 }});
 t.after(async()=>{smtp.close();for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));});
 const directory=fs.mkdtempSync(path.resolve('artifacts/qa/smtp-outcome-test-')),ledger=path.join(directory,'guard.sqlite'),db=new DatabaseSync(ledger);db.exec('CREATE TABLE confirmation_attempt(scope TEXT PRIMARY KEY,fingerprint TEXT,consumed INTEGER,status TEXT)');db.prepare("INSERT INTO confirmation_attempt VALUES ('fixture','review',0,'awaiting_approval')").run();db.close();
 reserveConfirmationAttempt(ledger,'fixture','review');let sentCalls=0,caught;
 try{if(verify){diagnostics.begin('verify');try{await smtp.verify();}catch(e){diagnostics.error(e);throw e;}}
  diagnostics.begin('send');sentCalls++;await adapter.send(mail);completeConfirmationAttempt(ledger,'fixture','smtp_accepted');
 }catch(e){caught=e;completeConfirmationAttempt(ledger,'fixture',sentCalls?'failed_or_acceptance_unknown':'preflight_failed_no_send');}
 assert.throws(()=>reserveConfirmationAttempt(ledger,'fixture','review')); // Never a second send.
 return {stats,diagnostics:diagnostics.snapshot(),caught,sentCalls};
}
test('mock final SMTP 250 is distinguished from envelope 250 and persists accepted evidence',async t=>{const r=await run(t,'accept');assert.equal(r.sentCalls,1);assert.equal(r.stats.dataCompleted,1);assert.equal(r.stats.final250,1);assert.equal(r.diagnostics.classification,'confirmed_smtp_accepted');assert.equal(r.diagnostics.finalSmtpCode,250);assert.equal(r.diagnostics.verifyAuthenticationObserved,true);assert.equal(r.diagnostics.sendAuthenticationObserved,true);});
test('successful authentication followed by a dropped final acknowledgment stays ambiguous and cannot retry',async t=>{const r=await run(t,'lost_ack');assert.equal(r.stats.dataCompleted,1);assert.equal(r.stats.final250,0);assert.equal(r.diagnostics.classification,'unknown_ambiguous');assert.equal(r.diagnostics.error.code,'ETIMEDOUT');assert.equal(r.sentCalls,1);});
test('connection drop after complete DATA is ambiguous and never retried',async t=>{const r=await run(t,'drop_after_data');assert.equal(r.stats.dataCompleted,1);assert.equal(r.diagnostics.classification,'unknown_ambiguous');assert.equal(r.sentCalls,1);});
test('connection drop before DATA is provably not submitted with complete diagnostic coverage',async t=>{const r=await run(t,'drop_before_data');assert.equal(r.stats.dataCommands,0);assert.equal(r.diagnostics.dataCommandObserved,false);assert.equal(r.diagnostics.classification,'confirmed_not_submitted');});
test('greeting timeout prevents submission, with no mock SMTP message attempted',async t=>{const r=await run(t,'greeting_timeout');assert.equal(r.sentCalls,0);assert.equal(r.stats.dataCompleted,0);assert.equal(r.diagnostics.classification,'confirmed_not_submitted');assert.equal(r.diagnostics.error.code,'ETIMEDOUT');assert.equal(r.caught.code,'ETIMEDOUT');});
test('authentication rejection prevents DATA and consumes its one-shot guard',async t=>{const r=await run(t,'auth_rejected');assert.equal(r.sentCalls,0);assert.equal(r.stats.dataCommands,0);assert.equal(r.caught.code,'EAUTH');});
test('a post-acceptance application failure cannot erase an observed final SMTP 250',async t=>{const r=await run(t,'post_accept_error');assert.equal(r.caught,undefined);assert.equal(r.sentCalls,1);assert.equal(r.stats.final250,1);assert.equal(r.diagnostics.classification,'confirmed_smtp_accepted');assert.equal(r.diagnostics.finalSmtpCode,250);});
test('diagnostics discard raw AUTH, addresses, bodies, URLs, errors and provider response text',()=>{const d=createConfirmationSmtpDiagnostics({now:()=>1});d.begin('send');const meta={component:'smtp-connection',sid:'PRIVATE_CONNECTION_ID'};d.logger.debug({...meta,tnx:'client'},'AUTH PLAIN PRIVATE_PASSWORD_B64');d.logger.debug({...meta,tnx:'client'},'MAIL FROM:<private@example.invalid>');d.logger.debug({...meta,tnx:'server'},'250 PRIVATE_PROVIDER_TEXT');d.logger.debug({...meta,tnx:'message'},'PRIVATE_BODY_MUST_NOT_APPEAR https://fixture.invalid/#PRIVATE_TOKEN_MUST_NOT_APPEAR');d.error({code:'ETIMEDOUT',command:'CONN',message:'PRIVATE_PASSWORD_B64',response:'PRIVATE_PROVIDER_TEXT',stack:'PRIVATE_TOKEN_MUST_NOT_APPEAR'});const output=JSON.stringify(d.snapshot());for(const secret of ['PRIVATE_','private@example','https://','stack','response"','sid'])assert.ok(!output.includes(secret));});
