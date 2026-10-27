import {createEmailLinks} from "../../backend/src/scheduling/email-links.mjs";
import {once} from 'node:events';
import express from 'express';
import path from 'node:path';
import {createAuthApp} from '../../backend/src/auth.mjs';
import {openAuthDatabase} from '../../backend/src/database.mjs';
import {createMeetingService} from '../../backend/src/meetings.mjs';
export async function schedulingHarness({database,livekit,frontendBuild,transportEnabled=true,whiteboardIntelligence=false,calendar={},links}={}){
 const raw=database||openAuthDatabase(),outer=express(),server=outer.listen(0,'127.0.0.1');await once(server,'listening');
 const origin=`http://127.0.0.1:${server.address().port}`,outbox=[],codes=[];let now=Date.now();
 const meetings=livekit||createMeetingService({NODE_ENV:'development',LIVEKIT_URL:'ws://127.0.0.1:7880',LIVEKIT_API_KEY:'fixture-key',LIVEKIT_API_SECRET:'fixture-secret-for-local-unit-tests-only'});
 if(!livekit)meetings.admin={listParticipants:async()=>[],sendData:async()=>{},deleteRoom:async()=>{},removeParticipant:async()=>{},updateParticipant:async()=>{}};
 const delivered=new Set(),transport={links:createEmailLinks({baseUrl:origin,secret:Buffer.alloc(32,7).toString('base64url')}),send:async mail=>{if(!delivered.has(mail.jobId)){delivered.add(mail.jobId);outbox.push(mail);}return {accepted:true,smtpCode:250};},sendCode:async mail=>{codes.push(mail);}};
 const app=createAuthApp({database:raw,clientId:'scheduling.apps.googleusercontent.com',origins:[origin],now:()=>now,verifyCredential:async value=>JSON.parse(value),meetings,scheduling:{transport:transportEnabled?transport:null,calendar,...links?{links}:{}},assistant:false,whiteboardIntelligence});
 outer.use(app);app.locals.attachMeetingGateway(server);
 outer.get('/test-presentation',(_req,res)=>res.type('html').send('<!doctype html><title>Talk scheduling presentation fixture</title><body style="background:#064e90;color:white;font:48px sans-serif">Synthetic Talk screen-share fixture</body>'));
 if(frontendBuild){outer.use(express.static(path.resolve(frontendBuild)));outer.get('*',(_req,res)=>res.sendFile(path.resolve(frontendBuild,'index.html')));}
 function client(){const jar=new Map();let csrf='';return {jar,setCsrf:value=>{csrf=value;},async request(route,body,extra={}){const response=await fetch(origin+'/api/auth/'+route,{method:body===undefined?'GET':'POST',headers:{Cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; '),...(body===undefined?{}:{Origin:origin,'Content-Type':'application/json','X-CSRF-Token':csrf}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});for(const cookie of response.headers.getSetCookie()){const [key,value]=cookie.split(';')[0].split('=');jar.set(key,value);}const type=response.headers.get('content-type')||'';return {status:response.status,body:type.includes('json')?await response.json():await response.text(),headers:response.headers};}};}
 async function account(name){const c=client(),cfg=(await c.request('config')).body;c.setCsrf(cfg.csrfToken);const seconds=Math.floor(now/1000),result=await c.request('google',{credential:JSON.stringify({iss:'https://accounts.google.com',aud:'scheduling.apps.googleusercontent.com',sub:name,name,email:`${name}@example.test`,email_verified:true,nonce:cfg.nonce,iat:seconds,exp:seconds+3600})});if(result.status!==200)throw new Error('Fixture account failed.');c.setCsrf(result.body.csrfToken);await c.request('google/confirm',{});return {...c,id:result.body.user.id};}
 return {raw,app,origin,server,client,account,codes,outbox,advance:ms=>{now+=ms;},now:()=>now,transport,close:async()=>{await app.locals.closeAuthDatabase();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));if(!database)raw.close();}};
}
