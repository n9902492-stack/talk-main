// Isolated synthetic booking runtime. Email is disabled by default; only the
// separately approved one-shot guest adapter can send. No production DB loader.
import path from 'node:path';
import {existsSync,readFileSync,mkdirSync,mkdtempSync,writeFileSync,lstatSync,realpathSync,renameSync} from 'node:fs';
import {randomBytes,randomUUID,scryptSync} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {isIP} from 'node:net';
import express from 'express';
import dotenv from 'dotenv';
import {openAuthDatabase} from '../database.mjs';
import {asyncDatabase} from '../async-database.mjs';
import {createAuthApp} from '../auth.mjs';
import {createMeetingService} from '../meetings.mjs';
import {createScheduling,secret} from './service.mjs';
import {createEmailLinks} from './email-links.mjs';
import {isControlledGuestOtpTransport} from './guest-otp-test.mjs';

export const bookingTestPort=3003;
const marker='Talk isolated synthetic booking test v1\n';
const ensure=(ok)=>{if(!ok)throw new Error('Isolated booking test configuration or path is unsafe. Private details withheld.');};
function safePath(root,target){
  const rel=path.relative(root,target);ensure(rel&&!rel.startsWith('..')&&!path.isAbsolute(rel));
  let current=root;for(const part of rel.split(path.sep)){current=path.join(current,part);if(existsSync(current))ensure(!lstatSync(current).isSymbolicLink());}
  if(existsSync(target))ensure(realpathSync(target).startsWith(realpathSync(root)+path.sep));
}
export function bookingTestConfiguration(root,origin=`http://127.0.0.1:${bookingTestPort}`){
  root=path.resolve(root);const local=dotenv.parse(readFileSync(path.join(root,'.env.local')));
  const test=dotenv.parse(readFileSync(path.join(root,'.env.tunnel-test.local')));
  const url=new URL(origin),publicMode=url.protocol==='https:';
  ensure(!url.username&&!url.password&&!url.search&&!url.hash&&url.pathname==='/'&&
    (publicMode?/^[a-z0-9-]+\.trycloudflare\.com$/.test(url.hostname)&&!url.port:url.origin===`http://127.0.0.1:${bookingTestPort}`));
  const emails=(test.TUNNEL_TEST_EMAILS||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
  ensure(emails.length===5&&new Set(emails).size===5&&emails.every(e=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)));
  const links=createEmailLinks({baseUrl:url.origin,secret:local.SCHEDULING_EMAIL_LINK_SECRET});
  const signal=new URL('/api/auth/meeting-signal',url);signal.protocol=publicMode?'wss:':'ws:';
  const livekit={NODE_ENV:publicMode?'production':'development',LIVEKIT_URL:test.LIVEKIT_URL,LIVEKIT_API_KEY:test.LIVEKIT_API_KEY,LIVEKIT_API_SECRET:test.LIVEKIT_API_SECRET,MEETING_SIGNAL_URL:signal.href};
  ensure(/^wss:\/\/[a-z0-9-]+\.livekit\.cloud\/?$/.test(livekit.LIVEKIT_URL||''));
  const frontendPath=path.join(root,'artifacts/qa/booking-link-frontend');safePath(root,frontendPath);ensure(existsSync(path.join(frontendPath,'index.html')));
  const privateValues=[local.SCHEDULING_EMAIL_LINK_SECRET,test.LIVEKIT_API_KEY,test.LIVEKIT_API_SECRET].filter(Boolean);
  function scan(dir){for(const e of readDir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);ensure(!e.isSymbolicLink());if(e.isDirectory())scan(p);else {const bytes=readFileSync(p);ensure(!privateValues.some(v=>bytes.includes(Buffer.from(v))));}}}
  scan(frontendPath);
  return {root,origin:url.origin,publicMode,emails:Object.freeze(emails),links,livekit,frontendPath};
}
import {readdirSync as readDir} from 'node:fs';
export async function prepareBookingTest(config,{now=Date.now()}={}){
  const parent=path.join(config.root,'data/booking-link-test');safePath(config.root,parent);
  ensure(spawnSync('git',['check-ignore','--quiet','--','data/booking-link-test/probe'],{cwd:config.root,windowsHide:true}).status===0);
  mkdirSync(parent,{recursive:true});const directory=mkdtempSync(path.join(parent,'run-'));
  writeFileSync(path.join(directory,'.synthetic-booking-test'),marker,{flag:'wx',mode:0o600});
  const databasePath=path.join(directory,'talk.sqlite'),raw=openAuthDatabase(databasePath),db=asyncDatabase(raw);
  const hostId=randomUUID(),password=secret(),salt=randomBytes(16).toString('hex');
  const passwordHash=`scrypt$32768$8$1$${salt}$${scryptSync(password,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024}).toString('hex')}`;
  try{const scheduling=createScheduling({db,now:()=>now,links:config.links});let booking;
    await db.withContext(async()=>{
      await scheduling.run('INSERT INTO accounts(id,name,email,email_verified,created_at) VALUES (?,?,?,1,?)',hostId,'Synthetic Booking Test Host',config.emails[0],now);
      await scheduling.run("INSERT INTO identities(provider,provider_id,account_id,password_hash,verified_at) VALUES ('password',?,?,?,?)",config.emails[0],hostId,passwordHash,now);
      await scheduling.saveProfile(hostId,{slug:'synthetic-'+hostId,timezone:'Asia/Kolkata',settings:{notice:0},windows:Array.from({length:7},(_,weekday)=>({weekday,start:0,end:1440}))});
      const {event}=await scheduling.createEvent(hostId,{slug:'isolated-test',title:'Synthetic OrbitMeet booking link test',duration:30,capacity:1});
      const start=Math.ceil((now+5*60000)/900000)*900000;
      booking=(await scheduling.book(event.id,{start,name:'Synthetic Test Invitee',email:config.emails[1],timezone:'Asia/Kolkata',credential:secret(),answers:{}})).booking;
      await scheduling.run("UPDATE scheduling_jobs SET status='cancelled',error_code='isolated_test_no_delivery'");
    });
    // Private local fixture credentials: never printed or served by HTTP.
    writeFileSync(path.join(directory,'host-access.private.json'),JSON.stringify({syntheticFixture:true,email:config.emails[0],password}),{flag:'wx',mode:0o600});
    writeFileSync(path.join(directory,'fixture.json'),JSON.stringify({hostId,bookingId:booking.id,meetingId:booking.meetingId}),{flag:'wx',mode:0o600});
    return {directory,databasePath,hostId,bookingId:booking.id,meetingId:booking.meetingId};
  }finally{raw.close();}
}

// Refresh only a marked, idle synthetic fixture. Old rows and prior manifests
// remain intact. A private idempotency intent prevents duplicate refreshes.
export async function refreshBookingTest(config,fixture,{now=Date.now()}={}){
  safePath(config.root,fixture.directory);
  ensure(path.relative(path.join(config.root,'data/booking-link-test'),fixture.directory).startsWith('run-'));
  ensure(fixture.databasePath===path.join(fixture.directory,'talk.sqlite')&&readFileSync(path.join(fixture.directory,'.synthetic-booking-test'),'utf8')===marker);
  const raw=openAuthDatabase(fixture.databasePath),db=asyncDatabase(raw),intentFile=path.join(fixture.directory,'future-email-refresh.private.json');
  try{
    ensure(raw.prepare('SELECT COUNT(*) n FROM accounts').get().n===1);
    for(const table of ['talk_meeting_connections','scheduling_guest_connections'])ensure(raw.prepare(`SELECT COUNT(*) n FROM ${table} WHERE revoked=0 AND expires_at>?`).get(now).n===0);
    const previous=raw.prepare('SELECT b.*,o.event_id FROM scheduling_bookings b JOIN scheduling_occurrences o ON o.id=b.occurrence_id WHERE b.id=?').get(fixture.bookingId);
    ensure(previous?.host_id===fixture.hostId&&config.emails.includes(previous.email)&&previous.name==='Synthetic Test Invitee');
    const service=createScheduling({db,now:()=>now,links:config.links});let booking,intent;
    await db.withContext(async()=>{
      if(existsSync(intentFile))intent=JSON.parse(readFileSync(intentFile,'utf8'));
      else{
        const from=Math.ceil((now+150*60000)/900000)*900000;
        const available=await service.slots(previous.event_id,{from,to:from+86400000,timezone:'Asia/Kolkata'});
        const slot=available.slots.find(s=>s.start>=now+120*60000);ensure(slot);
        intent={previousBookingId:fixture.bookingId,eventId:previous.event_id,start:slot.start,credential:secret(),createdAt:now};
        writeFileSync(intentFile,JSON.stringify(intent),{flag:'wx',mode:0o600});
      }
      ensure(intent.eventId===previous.event_id);
      booking=(await service.book(intent.eventId,{start:intent.start,name:'Synthetic Test Invitee',email:previous.email,timezone:'Asia/Kolkata',credential:intent.credential,answers:{}})).booking;
      await service.run("UPDATE scheduling_jobs SET status='cancelled',error_code='isolated_test_no_delivery',lease_until=NULL");
    });
    const next={hostId:fixture.hostId,bookingId:booking.id,meetingId:booking.meetingId};
    const history=path.join(fixture.directory,`fixture.previous-${intent.previousBookingId}.json`);
    if(!existsSync(history))writeFileSync(history,JSON.stringify({hostId:fixture.hostId,bookingId:intent.previousBookingId,meetingId:fixture.meetingId}),{flag:'wx',mode:0o600});
    const temporary=path.join(fixture.directory,'fixture.next.json');
    writeFileSync(temporary,JSON.stringify(next),{mode:0o600});renameSync(temporary,path.join(fixture.directory,'fixture.json'));
    return {...next,databasePath:fixture.databasePath,directory:fixture.directory,start:booking.start,end:booking.end};
  }finally{raw.close();}
}
export function createBookingTestApp(config,fixture,{meetings,localMockMailbox,controlledOtpTransport,now=Date.now}={}){
  ensure(!config.publicMode||!localMockMailbox);
  ensure(!controlledOtpTransport||(config.publicMode&&!localMockMailbox&&isControlledGuestOtpTransport(controlledOtpTransport)));
  const reliabilityFixture=existsSync(path.join(fixture.directory,'.synthetic-smtp-reliability'));
  const relative=path.relative(path.join(config.root,reliabilityFixture?'data/smtp-reliability-test':'data/booking-link-test'),fixture.directory);
  ensure(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));
  safePath(config.root,fixture.directory);
  const confirmationFixture=existsSync(path.join(fixture.directory,'.synthetic-confirmation-flow'));
  ensure(reliabilityFixture?readFileSync(path.join(fixture.directory,'.synthetic-smtp-reliability'),'utf8')==='Talk isolated SMTP reliability fixture v1\n':confirmationFixture?readFileSync(path.join(fixture.directory,'.synthetic-confirmation-flow'),'utf8')==='Talk isolated confirmation preparation v1\n':readFileSync(path.join(fixture.directory,'.synthetic-booking-test'),'utf8')===marker);
  ensure(fixture.databasePath===path.join(fixture.directory,'talk.sqlite'));
  const raw=openAuthDatabase(fixture.databasePath);
  ensure(raw.prepare('SELECT COUNT(*) n FROM accounts').get().n===1&&raw.prepare('SELECT COUNT(*) n FROM scheduling_bookings').get().n>=1);
  const seeded=raw.prepare('SELECT b.host_id,b.email,o.meeting_id FROM scheduling_bookings b JOIN scheduling_occurrences o ON o.id=b.occurrence_id WHERE b.id=?').get(fixture.bookingId);
  ensure(seeded?.host_id===fixture.hostId&&seeded.meeting_id===fixture.meetingId&&config.emails.includes(seeded.email));
  const expectedTitle=reliabilityFixture?'SMTP Reliability Test':confirmationFixture?'Talk Booking Confirmation Test':'Synthetic OrbitMeet booking link test';
  const expectedGuest=reliabilityFixture?'Synthetic Reliability Guest':'Synthetic Test Invitee';
  ensure(raw.prepare("SELECT COUNT(*) n FROM scheduling_bookings b JOIN scheduling_occurrences o ON o.id=b.occurrence_id JOIN scheduling_events e ON e.id=o.event_id WHERE b.host_id<>? OR b.email<>? OR b.name<>? OR e.title<>?").get(fixture.hostId,seeded.email,expectedGuest,expectedTitle).n===0);
  if(confirmationFixture||reliabilityFixture){
    ensure(raw.prepare('SELECT COUNT(*) n FROM scheduling_bookings').get().n===1);
    const account=raw.prepare('SELECT name,email,email_verified FROM accounts WHERE id=?').get(fixture.hostId);
    ensure(account?.name===(reliabilityFixture?'Talk Synthetic Reliability Host':'Synthetic Talk Host')&&account.email_verified===1&&config.emails.includes(account.email));
    ensure(raw.prepare("SELECT COUNT(*) n FROM scheduling_jobs WHERE status<>'cancelled' AND NOT (booking_id=? AND kind='confirmation:invitee' AND status='queued' AND attempts=0)").get(fixture.bookingId).n===0);
    ensure(!controlledOtpTransport); // This approval permits no live OTP adapter.
  }
  const service=meetings||createMeetingService(config.livekit);ensure(service.configured);
  const transport=controlledOtpTransport||(localMockMailbox?{sendCode:async mail=>{localMockMailbox.push(mail);}}:null);
  const auth=createAuthApp({database:raw,origins:[config.origin],secureCookies:config.publicMode,trustedProxyCidrs:config.publicMode?'127.0.0.1/32':'',now,
    mailer:{configured:false},meetings:service,scheduling:{links:config.links,transport},recordings:{configured:false},assistant:false,whiteboards:false,whiteboardIntelligence:false});
  const app=express();app.disable('x-powered-by');
  // Cookies have no port isolation. Prefix both directions so localhost:3003
  // cannot overwrite sessions belonging to the development or WebRTC runtime.
  const isolateCookies=req=>{req.headers.cookie=String(req.headers.cookie||'').split(';').map(v=>v.trim())
    .filter(v=>/^bookingtest_talk_[a-z_]+=/.test(v)).map(v=>v.replace(/^bookingtest_/, '')).join('; ');};
  app.use((req,res,next)=>{
    isolateCookies(req);const set=res.setHeader.bind(res);
    res.setHeader=(name,value)=>set(name,name.toLowerCase()==='set-cookie'?
      (Array.isArray(value)?value:[value]).map(v=>String(v).replace(/^(talk_[a-z_]+)=/,'bookingtest_$1=')):value);
    next();
  });
  const valid=req=>req.headers.host===new URL(config.origin).host&&(config.publicMode?req.headers['x-forwarded-proto']==='https'&&isIP(String(req.headers['cf-connecting-ip']||'')):!req.headers['x-forwarded-proto']&&!req.headers['cf-connecting-ip']);
  const deny=(res,status=404)=>res.status(status).set('Cache-Control','no-store').json({error:'isolated_booking_test_restricted'});
  const base='/api/auth/scheduling',book=`${base}/booking/${fixture.bookingId}`,guest=`${base}/guest/meetings/${fixture.meetingId}`,host=`/api/auth/meetings/${fixture.meetingId}`;
  const get=new Set(['/healthz','/api/auth/config','/api/auth/session','/api/auth/email/config','/api/auth/phone/config',`${base}/form`,guest,guest+'/state',host,host+'/state',host+'/recording-state']);
  const post=new Set(['/api/auth/email/login','/api/auth/email/resume','/api/auth/logout',book+'/detail',book+'/calendar',book+'/code',book+'/redeem',guest+'/token',guest+'/actions',host+'/token',host+'/actions']);
  app.use((req,res,next)=>{
    res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Cross-Origin-Resource-Policy':'same-origin','Permissions-Policy':'camera=(self), microphone=(self), display-capture=(self)'});
    if(!valid(req))return deny(res,403);
    delete req.headers['x-forwarded-for'];delete req.headers.forwarded;delete req.headers['x-forwarded-host'];
    if(config.publicMode){req.headers['x-forwarded-for']=req.headers['cf-connecting-ip'];res.set('Strict-Transport-Security','max-age=86400');}
    let p;try{p=decodeURIComponent(req.path);}catch{return deny(res,400);}
    if(p!==req.path||p.includes('\\')||p.includes('\0')||p.split('/').some(x=>x.startsWith('.')))return deny(res);
    if(p==='/healthz'&&req.method==='GET')return res.json({ready:true,isolatedBookingTest:true,email:false,guestOtpDelivery:controlledOtpTransport?.deliveryEnabled===true,ai:false,recording:false,sms:false});
    if(p.startsWith('/api')&&!(req.method==='GET'?get.has(p):req.method==='POST'&&post.has(p)))return deny(res);
    next();
  });
  app.post(['/api/auth/email/login','/api/auth/email/resume'],express.json({limit:'16kb'}),(req,res,next)=>{
    if(typeof req.body?.email!=='string'||!config.emails.includes(req.body.email.trim().toLowerCase()))return deny(res,403);next();
  });
  app.use((req,res,next)=>{
    if(req.method==='POST'&&req.path===book+'/detail'){
      const json=res.json.bind(res);
      res.json=value=>json(value?.booking&&!controlledOtpTransport?.deliveryEnabled&&!localMockMailbox?
        {...value,emailEnabled:false,booking:{...value.booking,event:{...value.booking.event,emailEnabled:false}}}:value);
    }
    next();
  });
  app.use(auth);
  app.use('/api',(_req,res)=>deny(res));
  const pages=new Set(['/','/sign-in','/booking-confirmation','/device-test','/meeting']);
  app.use((req,res,next)=>{
    if(!['GET','HEAD'].includes(req.method))return deny(res);
    if(pages.has(req.path))return res.sendFile(path.join(config.frontendPath,'index.html'));
    if(!/\.map$/i.test(req.path)&&/^\/(?:assets|vendor|fonts)\//.test(req.path))return next();
    return deny(res);
  });
  app.use(express.static(config.frontendPath,{dotfiles:'deny',index:false,redirect:false}));
  app.use((_req,res)=>deny(res));app.use((_err,_req,res,_next)=>deny(res,400));
  let closed=false;
  return {app,raw,auth,attach(server){
    server.on('upgrade',(req,socket)=>{let p;try{p=new URL(req.url,'http://localhost').pathname;}catch{p='';}
      if(!valid(req)||req.headers.origin!==config.origin||!['/api/auth/meeting-signal/rtc','/api/auth/meeting-signal/rtc/v1'].includes(p)){
        req.url='/__blocked_upgrade';socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      }else isolateCookies(req);});auth.locals.attachMeetingGateway(server);
  },close:async()=>{if(closed)return;closed=true;await auth.locals.closeAuthDatabase();raw.close();}};
}
