import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import dotenv from 'dotenv';
import {createControlledGuestOtpTransport} from '../backend/src/scheduling/guest-otp-test.mjs';
import {bookingTestConfiguration,prepareBookingTest,createBookingTestApp,bookingTestPort} from '../backend/src/scheduling/booking-link-test.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
let runtime,server;
try{
  const value=key=>{const i=args.indexOf(key);return i<0?undefined:args[i+1];};
  const known=new Set(['--prepare','--start','--fixture','--origin','--approved-public-origin','--approved-one-guest-otp']);
  for(let i=0;i<args.length;i++){if(!known.has(args[i]))throw 0;if(['--fixture','--origin'].includes(args[i]))i++;}
  if(args.includes('--prepare')===args.includes('--start'))throw 0;
  if(args.includes('--approved-one-guest-otp')&&!args.includes('--start'))throw 0;
  if(value('--origin')&&!args.includes('--approved-public-origin'))throw 0;
  const config=bookingTestConfiguration(root,value('--origin'));
  // Scoped to this process; never write the development .env files.
  if(config.publicMode)process.env.SCHEDULING_PUBLIC_URL=config.origin;
  if(args.includes('--prepare')){
    if(config.publicMode)throw 0;
    const fixture=await prepareBookingTest(config);
    console.log(JSON.stringify({prepared:true,directory:path.relative(root,fixture.directory),port:bookingTestPort,publicAccess:false,email:false}));
  }else{
    if(!value('--fixture'))throw 0;
    const directory=path.resolve(root,value('--fixture'));
    // Runtime checks confinement and the synthetic marker before opening DB.
    const fixture={...JSON.parse(readFileSync(path.join(directory,'fixture.json'),'utf8')),directory,databasePath:path.join(directory,'talk.sqlite')};
    // Never supplied during preparation. A later explicitly approved, isolated
    // launch may arm this one-booking adapter; normal email jobs stay disabled.
    const controlledOtpTransport=args.includes('--approved-one-guest-otp')?
      createControlledGuestOtpTransport({config,fixture,env:dotenv.parse(readFileSync(path.join(root,'.env.local'))),approved:true}):undefined;
    runtime=createBookingTestApp(config,fixture,{controlledOtpTransport});
    const db=new DatabaseSync(fixture.databasePath,{readOnly:true});let b;
    try{b=db.prepare('SELECT b.id,b.version,b.status,o.ends_at FROM scheduling_bookings b JOIN scheduling_occurrences o ON o.id=b.occurrence_id WHERE b.id=?').get(fixture.bookingId);}finally{db.close();}
    writeFileSync(path.join(directory,'invitation.private.txt'),config.links.inviteeUrl(b)+'\n',{mode:0o600});
    server=createServer(runtime.app);runtime.attach(server);
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(bookingTestPort,'127.0.0.1',resolve);});
    console.log(JSON.stringify({ready:true,listener:`127.0.0.1:${bookingTestPort}`,origin:config.origin,email:false,controlledGuestOtp:Boolean(controlledOtpTransport),publicTunnelStarted:false}));
    const stop=async()=>{server.closeAllConnections();server.close();await runtime.close();};
    process.once('SIGTERM',()=>void stop());process.once('SIGINT',()=>void stop());
  }
}catch{
  server?.closeAllConnections();server?.close();await runtime?.close().catch(()=>{});
  console.error('Isolated booking test stopped safely. Check configuration, fixture, build and port. Private details withheld.');process.exitCode=1;
}
