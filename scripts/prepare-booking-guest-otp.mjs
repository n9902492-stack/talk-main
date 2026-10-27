// Preparation ONLY. No SMTP connection, code generation or public runtime reload.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import dotenv from 'dotenv';
import {bookingTestConfiguration} from '../backend/src/scheduling/booking-link-test.mjs';
import {prepareGuestOtpTest} from '../backend/src/scheduling/guest-otp-test.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
try{
 if(process.argv.length!==2)throw 0;
 const state=JSON.parse(fs.readFileSync(path.join(root,'data/booking-link-test/public-tunnel.json')));
 if(!state.running||!state.connected)throw 0;
 const config=bookingTestConfiguration(root,state.origin),directory=path.join(root,'data/booking-link-test/run-k4g1R9');
 const fixture={...JSON.parse(fs.readFileSync(path.join(directory,'fixture.json'))),directory,databasePath:path.join(directory,'talk.sqlite')};
 const env=dotenv.parse(fs.readFileSync(path.join(root,'.env.local')));
 const result=prepareGuestOtpTest({config,fixture,env});
 fs.writeFileSync(path.join(root,'artifacts/qa/phase11-guest-otp-preparation.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify(result));
}catch{console.error('Guest OTP preparation stopped safely. Private details withheld.');process.exitCode=1;}
