// Read-only health checks. Never starts a runtime, tunnel, SMTP or calendar client.
import fs from 'node:fs';
import {request} from 'node:http';
const state=JSON.parse(fs.readFileSync('data/booking-link-test/confirmation-public-tunnel.json','utf8'));
const origin=new URL(state.origin);
if(origin.protocol!=='https:'||!/^[-a-z0-9]+\.trycloudflare\.com$/.test(origin.hostname)||origin.pathname!=='/'||origin.search||origin.hash)throw Error('Invalid isolated origin.');
const checks=[['main','http://127.0.0.1:3001/',{}],['isolated','http://127.0.0.1:3003/healthz',{Host:origin.host,'X-Forwarded-Proto':'https','CF-Connecting-IP':'127.0.0.1'}]];
if(process.argv.includes('--https'))checks.push(['https',origin.origin+'/healthz',{}]);
const report={checkedAt:new Date().toISOString(),origin:origin.origin,newBookingPublicAccess:'BLOCKED_NEW_DATABASE_NOT_SERVED',checks:[]};
for(const [label,url,headers] of checks){try{
 if(label==='isolated'){
  const result=await new Promise((resolve,reject)=>{const req=request(url,{headers,timeout:12000},res=>{let body='';res.on('data',b=>body+=b);res.on('end',()=>{try{resolve({label,status:res.statusCode,health:JSON.parse(body)});}catch{reject(Error('Invalid health response.'));}});});req.on('error',reject);req.on('timeout',()=>req.destroy(Error('timeout')));req.end();});report.checks.push(result);
 }else{const r=await fetch(url,{headers,signal:AbortSignal.timeout(12000)});const health=label==='main'?undefined:await r.json();report.checks.push({label,status:r.status,...health?{health}: {}});}
}catch{report.checks.push({label,status:'UNREACHABLE'});}}
fs.writeFileSync('artifacts/qa/smtp-reliability-health.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
