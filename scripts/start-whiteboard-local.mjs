import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import {createRuntimeAuth} from '../backend/src/runtime-auth.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),origin='http://localhost:3001';
// Normal local provider configuration is read privately. Never read or mutate
// the separate tunnel environment, and never inherit its database or origins.
const read=name=>{try{return dotenv.parse(fs.readFileSync(path.join(root,name)));}catch{return {};}};
const local=JSON.parse(fs.readFileSync(path.join(root,'data/livekit-local.json'),'utf8'));
if(local.url!=='ws://127.0.0.1:7880')throw new Error('Start the loopback local meeting server first.');
const env={...read('.env'),...read('.env.local'),NODE_ENV:'development',AUTH_DB_DRIVER:'sqlite',AUTH_DATABASE_PATH:'data/whiteboard-local/talk.sqlite',APP_URL:origin,
  LIVEKIT_URL:local.url,LIVEKIT_API_KEY:local.apiKey,LIVEKIT_API_SECRET:local.apiSecret};
const build=path.join(root,'artifacts/qa/phase10-build');
if(!fs.existsSync(path.join(build,'index.html')))throw new Error('Run npm run build:whiteboard first.');
const auth=createRuntimeAuth(env,{origins:[origin,'http://127.0.0.1:3001'],secureCookies:false}),app=express();
app.disable('x-powered-by');app.use((_req,res,next)=>{res.set({'Cross-Origin-Opener-Policy':'same-origin-allow-popups','Referrer-Policy':'no-referrer'});next();});
app.use(auth);app.use('/api',(_req,res)=>res.status(404).json({error:'not_found'}));
app.use(express.static(build,{dotfiles:'deny',index:false}));app.get('*',(_req,res)=>res.sendFile(path.join(build,'index.html')));
const server=app.listen(3001,'127.0.0.1',()=>console.log('Talk whiteboard local test: http://localhost:3001/sign-in — isolated data/whiteboard-local/talk.sqlite. No public tunnel.'));
auth.locals.attachMeetingGateway(server);
server.on('error',async()=>{console.error('Local port 3001 is unavailable. Existing services were not stopped.');await auth.locals.closeAuthDatabase();process.exitCode=1;});
let stopping=false;const stop=async()=>{if(stopping)return;stopping=true;server.close();server.closeIdleConnections();await auth.locals.closeAuthDatabase();};
process.once('SIGINT',stop);process.once('SIGTERM',stop);
