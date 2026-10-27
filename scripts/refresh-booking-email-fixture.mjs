// Synthetic data refresh only; never sends, verifies SMTP or starts a tunnel.
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {bookingTestConfiguration,refreshBookingTest} from '../backend/src/scheduling/booking-link-test.mjs';
const directory=path.resolve('data/booking-link-test/run-k4g1R9');
try{
 if(process.argv.length!==3||process.argv[2]!=='--approved-refresh')throw 0;
 const state=JSON.parse(fs.readFileSync('data/booking-link-test/public-tunnel.json'));
 if(!state.running||!state.connected||state.origin!=='https://latin-candle-answers-hampshire.trycloudflare.com')throw 0;
 const response=await fetch(state.origin+'/healthz',{signal:AbortSignal.timeout(15000)});const health=await response.json();
 if(response.status!==200||!health.isolatedBookingTest||['email','ai','sms','recording'].some(k=>health[k]!==false))throw 0;
 const ledger=new DatabaseSync('artifacts/qa/phase11-gmail-first-attempt.sqlite',{readOnly:true});
 try{if(ledger.prepare('SELECT consumed FROM email_smoke_attempts WHERE scope=?').get('talk:phase11:gmail:first-confirmation:v1')?.consumed)throw 0;}finally{ledger.close();}
 const config=bookingTestConfiguration(process.cwd(),state.origin);
 const previous={...JSON.parse(fs.readFileSync(path.join(directory,'fixture.json'))),directory,databasePath:path.join(directory,'talk.sqlite')};
 const next=await refreshBookingTest(config,previous);
 const report={origin:state.origin,database:path.relative(process.cwd(),next.databasePath),bookingId:next.bookingId,startsAt:next.start,endsAt:next.end,linkExpiresAt:next.end+3600000,timezone:'Asia/Kolkata',oldBookingPreserved:true,emailSent:false,tunnelRestarted:false};
 fs.writeFileSync('artifacts/qa/future-booking-refresh.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
}catch{console.error('Future synthetic booking refresh stopped safely. Check live tunnel, idle fixture, available slots and unused email attempt. No email sent.');process.exitCode=1;}
