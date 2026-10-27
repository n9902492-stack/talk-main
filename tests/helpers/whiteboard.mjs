import assert from 'node:assert/strict';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {createAuthApp} from '../../backend/src/auth.mjs';
import {openAuthDatabase} from '../../backend/src/database.mjs';
import {createMeetingService} from '../../backend/src/meetings.mjs';
export async function whiteboardHarness({database:given,databasePath=':memory:',enabled=true,intelligence={autoStart:false}}={}){
  let now=Date.now();const database=given||openAuthDatabase(databasePath),origin='http://localhost:3001';
  const service=createMeetingService({NODE_ENV:'development',LIVEKIT_URL:'ws://127.0.0.1:7880',LIVEKIT_API_KEY:'whiteboard-fixture',LIVEKIT_API_SECRET:'whiteboard-private-fixture-not-a-real-api-key'});
  service.admin={sendData:async()=>{},listParticipants:async()=>[],removeParticipant:async()=>{},deleteRoom:async()=>{}};
  const app=createAuthApp({clientId:'whiteboard-test.apps.googleusercontent.com',origins:[origin],database,meetings:service,whiteboards:enabled,whiteboardIntelligence:intelligence,now:()=>now,verifyCredential:async value=>JSON.parse(value)});
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}/api/auth/`;
  async function account(name=randomUUID()){
    const jar=new Map();let csrf='';
    async function request(route,body,options={}){
      const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{Cookie:[...jar].map(([key,value])=>`${key}=${value}`).join('; '),...(body===undefined?{}:{Origin:origin,'Content-Type':options.raw?'image/png':'application/json','X-CSRF-Token':csrf}),...options.headers},...(body===undefined?{}:{body:options.raw?body:JSON.stringify(body)})});
      for(const cookie of response.headers.getSetCookie()){const [key,value]=cookie.split(';')[0].split('=');if(/Max-Age=0/.test(cookie))jar.delete(key);else jar.set(key,value);}
      const bytes=Buffer.from(await response.arrayBuffer()),type=response.headers.get('Content-Type')||'';
      return {status:response.status,body:type.includes('application/json')?JSON.parse(bytes):bytes,headers:response.headers};
    }
    const config=(await request('config')).body;csrf=config.csrfToken;const seconds=Math.floor(now/1000);
    const signed=await request('google',{credential:JSON.stringify({iss:'https://accounts.google.com',aud:config.clientId,sub:name,name,email:`${name.replace(/[^a-z\d]/gi,'')}@example.test`,email_verified:true,nonce:config.nonce,iat:seconds,exp:seconds+3600})});assert.equal(signed.status,200);csrf=signed.body.csrfToken;assert.equal((await request('google/confirm',{})).status,200);
    const route=(room='talk-workshop')=>`meetings/${room}`;
    return {request,id:signed.body.user.id,csrf:()=>csrf,
      create:(approvalRequired=false,room)=>request(route(room)+'/create',{approvalRequired}),
      join:(room)=>request(route(room)+'/token',{displayName:name}),
      action:(action,target,extra={},room)=>request(route(room)+'/actions',{action,target,...extra}),
      board:(suffix='',body,room)=>request(route(room)+'/whiteboard'+suffix,body),
      edit:(edits,room)=>request(route(room)+'/whiteboard/operations',{requestId:randomUUID(),edits})};
  }
  return {account,database,service,app,advance:ms=>{now+=ms;},base,origin,
    close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await app.locals.closeAuthDatabase();if(!given)database.close();}};
}
export const element=(type='rectangle',extra={})=>({id:randomUUID(),type,x:30,y:40,...extra});
export const createEdit=e=>({kind:'create',id:e.id,element:e});
