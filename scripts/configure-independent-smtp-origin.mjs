// Only the separately approved independent runtime's backend configuration.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
const launch=JSON.parse(fs.readFileSync('artifacts/qa/smtp-reliability-independent-launch.json','utf8')),mode=process.argv[2];
try{
 assert.ok(['--capture','--commit-verified-origin'].includes(mode));assert.equal(process.argv.length,3);assert.ok(Date.now()<launch.bookingStart);assert.ok(path.resolve(launch.directory).startsWith(path.resolve('data/smtp-reliability-test')+path.sep));assert.equal(fs.realpathSync(launch.directory),launch.directory);
 const connector=JSON.parse(fs.readFileSync(path.join(launch.directory,'connector-start.json'),'utf8'));assert.equal(connector.launchId,launch.id);assert.ok(Number.isInteger(connector.pid));process.kill(connector.pid,0);
 const save=(name,value)=>fs.writeFileSync(path.join(launch.directory,name),JSON.stringify(value,null,2),{mode:0o600});
 if(mode==='--capture'){
  const logs=[launch.cloudflaredStdout,launch.cloudflaredStderr].filter(fs.existsSync).map(f=>fs.readFileSync(f,'utf8').slice(-131072)).join('\n');
  const origins=[...new Set(logs.match(/https:\/\/[-a-z0-9]+\.trycloudflare\.com\b/g)||[])];assert.equal(origins.length,1);assert.match(logs,/Registered tunnel connection/);
  const assigned={launchId:launch.id,origin:new URL(origins[0]).origin,connectorPid:connector.pid,capturedAt:new Date().toISOString()};save('assigned-origin.json',assigned);console.log(JSON.stringify({...assigned,routesEnabled:false}));
 }else{
  const assigned=JSON.parse(fs.readFileSync(path.join(launch.directory,'assigned-origin.json'),'utf8')),proof=JSON.parse(fs.readFileSync(path.join(launch.directory,'independence-proof.json'),'utf8')),server=JSON.parse(fs.readFileSync(launch.serverState,'utf8'));
  assert.equal(assigned.launchId,launch.id);assert.equal(assigned.connectorPid,connector.pid);assert.equal(proof.launchId,launch.id);assert.equal(proof.connectorPid,connector.pid);assert.equal(proof.connectorSurvivedServerStop,true);assert.equal(proof.metricsReady,true);assert.notEqual(server.serverPid,proof.stoppedBootstrapServerPid);assert.equal(server.status,'WAITING_FOR_APPROVED_ORIGIN');process.kill(server.serverPid,0);
  fs.writeFileSync(launch.originFile,JSON.stringify({...assigned,independenceVerified:true,serverPid:server.serverPid,committedAt:new Date().toISOString()},null,2),{flag:'wx',mode:0o600});console.log(JSON.stringify({origin:assigned.origin,serverPid:server.serverPid,connectorPid:connector.pid,independenceVerified:true,emailsSent:0}));
 }
}catch{console.error('Independent HTTPS origin configuration stopped safely. No email or OTP sent.');process.exitCode=1;}
