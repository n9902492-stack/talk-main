// Isolated, operator-approved Gmail OTP test. Never used by normal email jobs.
import path from 'node:path';
import {readFileSync,writeFileSync,existsSync,lstatSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import nodemailer from 'nodemailer';
import {createVerificationMailer} from '../mailer.mjs';
import {schedulingEmailSmokeConfiguration} from './email-smoke-test.mjs';

const address='niknikhil.sharma22@gmail.com';
const transports=new WeakSet();
const digest=value=>createHash('sha256').update(value).digest('hex');
const ensure=value=>{if(!value)throw new Error('Controlled guest OTP is unavailable. Private details withheld.');};
const rowSql=`SELECT b.id,b.host_id,b.email,b.version,b.status,b.name,o.meeting_id,o.starts_at,o.ends_at,e.title,o.status AS occurrence_status,m.status AS meeting_status,m.owner_account_id,m.approval_required
 FROM scheduling_bookings b JOIN scheduling_occurrences o ON o.id=b.occurrence_id
 JOIN scheduling_events e ON e.id=o.event_id JOIN talk_meetings m ON m.id=o.meeting_id WHERE b.id=?`;

function paths(config,fixture){
 const parent=path.resolve(config.root,'data/booking-link-test'),directory=path.resolve(fixture.directory);
 const relative=path.relative(parent,directory);
 ensure(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));
 let cursor=parent;ensure(!lstatSync(parent).isSymbolicLink());
 for(const part of relative.split(path.sep)){cursor=path.join(cursor,part);ensure(!lstatSync(cursor).isSymbolicLink());}
 ensure(realpathSync(directory).startsWith(realpathSync(parent)+path.sep));
 ensure(fixture.databasePath===path.join(directory,'talk.sqlite'));
 ensure(readFileSync(path.join(directory,'.synthetic-booking-test'),'utf8')==='Talk isolated synthetic booking test v1\n');
 const files={database:fixture.databasePath,policy:path.join(directory,'guest-otp-policy.private.json'),ledger:path.join(directory,'guest-otp-attempt.sqlite')};
 for(const file of Object.values(files))if(existsSync(file))ensure(!lstatSync(file).isSymbolicLink());
 return files;
}
function binding(config,fixture,env,now){
 const files=paths(config,fixture);
 ensure(config.publicMode&&/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(config.origin));
 ensure(config.emails.length===5&&new Set(config.emails).size===5&&config.emails.includes(address));
 const smtp=schedulingEmailSmokeConfiguration({...env,SCHEDULING_PUBLIC_URL:config.origin});
 ensure((env.SMTP_HOST||'smtp.gmail.com').toLowerCase()==='smtp.gmail.com'&&smtp.sender.toLowerCase()===address&&env.SMTP_USER?.toLowerCase()===address);
 const db=new DatabaseSync(files.database,{readOnly:true});
 try{
  const b=db.prepare(rowSql).get(fixture.bookingId);
  ensure(b&&b.host_id===fixture.hostId&&b.meeting_id===fixture.meetingId&&b.email===address&&b.name==='Synthetic Test Invitee'&&b.title==='Synthetic OrbitMeet booking link test'&&b.status==='confirmed'&&b.ends_at-b.starts_at===1800000&&now<b.ends_at+3600000);
  ensure(b.occurrence_status==='confirmed'&&b.meeting_status==='active'&&b.owner_account_id===fixture.hostId&&b.approval_required===1);
  ensure(db.prepare('SELECT COUNT(*) n FROM accounts').get().n===1);
  ensure(db.prepare("SELECT COUNT(*) n FROM scheduling_jobs WHERE status<>'cancelled'").get().n===0);
  const i=db.prepare('SELECT * FROM scheduling_invitations WHERE booking_id=? AND revoked=0 ORDER BY expires_at DESC LIMIT 1').get(b.id);
  ensure(i&&!i.redeemed_at&&i.expires_at>=b.ends_at+3600000);
  const link=new URL(readFileSync(path.join(fixture.directory,'invitation.private.txt'),'utf8').trim());
  ensure(link.origin===config.origin&&link.searchParams.get('id')===b.id&&config.links.verify(b,link.hash.slice(1),now));
  return {files,b,i,policy:{format:1,bookingId:b.id,invitationId:i.id,meetingId:b.meeting_id,version:b.version,sender:address,recipient:address,subject:'Your Talk verification code',origin:config.origin,startsAt:b.starts_at,endsAt:b.ends_at,joinFrom:b.starts_at-900000,expiresAt:b.ends_at+3600000,configurationIdentity:smtp.configurationIdentity,allowlistIdentity:digest(JSON.stringify([...config.emails].sort()))}};
 }finally{db.close();}
}
function ledger(filename){
 const db=new DatabaseSync(filename);
 db.exec(`PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS guest_otp_attempt (
 scope TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, consumed INTEGER NOT NULL DEFAULT 0 CHECK(consumed IN(0,1)),
 status TEXT NOT NULL, reserved_at INTEGER, completed_at INTEGER, smtp_accepted INTEGER NOT NULL DEFAULT 0)`);
 return db;
}
function identity(policy){return {scope:'talk:phase11:guest-otp:'+policy.bookingId+':'+policy.invitationId,fingerprint:digest(JSON.stringify(policy))};}

/** Offline only: no OTP is generated, no SMTP factory/connection is invoked. */
export function prepareGuestOtpTest({config,fixture,env,now=Date.now()}){
 const {files,policy,i}=binding(config,fixture,env,now),{scope,fingerprint}=identity(policy);
 ensure(!i.proof_hash&&i.attempts===0);
 if(existsSync(files.policy))ensure(readFileSync(files.policy,'utf8')===JSON.stringify(policy));
 else writeFileSync(files.policy,JSON.stringify(policy),{flag:'wx',mode:0o600});
 const db=ledger(files.ledger);
 try{
  db.prepare("INSERT OR IGNORE INTO guest_otp_attempt(scope,fingerprint,status) VALUES (?,?,'prepared')").run(scope,fingerprint);
  const r=db.prepare('SELECT * FROM guest_otp_attempt WHERE scope=?').get(scope);ensure(r.fingerprint===fingerprint);
  return {prepared:true,realDeliveryEnabled:false,attemptsConsumed:r.consumed,sender:address,recipient:address,subject:policy.subject,joinFrom:policy.joinFrom,expiresAt:policy.expiresAt};
 }finally{db.close();}
}
export const isControlledGuestOtpTransport=value=>transports.has(value);

/** Future activation requires separate explicit approval; defaults closed. */
export function createControlledGuestOtpTransport({config,fixture,env,approved=false,now=Date.now,createTransport=nodemailer.createTransport}){
 ensure(approved===true);
 const first=binding(config,fixture,env,now()),saved=readFileSync(first.files.policy,'utf8');
 ensure(saved===JSON.stringify(first.policy));
 const {scope,fingerprint}=identity(first.policy);
 let armed=true;
 function current(context){
  const checked=binding(config,fixture,env,now());
  ensure(JSON.stringify(checked.policy)===saved&&now()>=checked.policy.joinFrom&&now()<=checked.policy.expiresAt);
  ensure(context.bookingId===checked.b.id&&context.invitationId===checked.i.id&&context.to===address);
  return checked;
 }
 const adapter={
  get deliveryEnabled(){if(!armed)return false;const db=ledger(first.files.ledger);try{return db.prepare('SELECT consumed=0 AND fingerprint=? AS allowed FROM guest_otp_attempt WHERE scope=?').get(fingerprint,scope)?.allowed===1;}finally{db.close();}},
  disableDelivery(){armed=false;},
  async canSendCode(context){try{if(!armed)return false;current(context);return adapter.deliveryEnabled;}catch{return false;}},
  async sendCode(mail){
   ensure(armed);
   const checked=current(mail),expiry=new Date(mail.expiresAt).getTime();
   ensure(/^\d{6}$/.test(mail.code)&&expiry===checked.i.proof_expires_at&&expiry>now()&&expiry<=now()+300000&&checked.i.proof_hash===digest(checked.i.id+':'+mail.code));
   const db=ledger(first.files.ledger);
   try{
    // Atomic commit BEFORE any SMTP operation. Failure/crash/unknown stays consumed.
    ensure(db.prepare("UPDATE guest_otp_attempt SET consumed=1,status='reserved',reserved_at=? WHERE scope=? AND fingerprint=? AND consumed=0").run(now(),scope,fingerprint).changes===1);
    armed=false;
    let calls=0;
    const mailer=createVerificationMailer(env,{createTransport:options=>{
     const smtp=createTransport({...options,pool:false,maxRequeues:0});
     return {sendMail:async message=>{
      ensure(++calls===1&&message.to.address===address&&message.from.address.toLowerCase()===address&&message.subject===checked.policy.subject&&!message.cc&&!message.bcc);
      try{return await smtp.sendMail(message);}finally{smtp.close?.();}
     }};
    }});
    try{
     await mailer.sendVerification({to:address,code:mail.code,expiresAt:mail.expiresAt});
     db.prepare("UPDATE guest_otp_attempt SET status='accepted',smtp_accepted=1,completed_at=? WHERE scope=?").run(now(),scope);
    }catch{
     db.prepare("UPDATE guest_otp_attempt SET status='failed_or_unknown',completed_at=? WHERE scope=?").run(now(),scope);
     // Invalidate an undelivered/ambiguous proof, without allowing a resend.
     const isolated=new DatabaseSync(first.files.database);
     try{isolated.prepare('UPDATE scheduling_invitations SET proof_hash=NULL WHERE id=? AND proof_hash=?').run(checked.i.id,digest(checked.i.id+':'+mail.code));}finally{isolated.close();}
     ensure(false);
    }
   }finally{db.close();}
  }
 };
 transports.add(adapter);return Object.freeze(adapter);
}
