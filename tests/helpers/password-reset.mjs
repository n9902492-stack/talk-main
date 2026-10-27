import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createAuthApp} from '../../backend/src/auth.mjs';
import {openAuthDatabase} from '../../backend/src/database.mjs';
export async function resetHarness({database:given,databasePath=':memory:',hosting=false,origin='http://localhost:3001'}={}){
  let now=Date.now(),sequence=100000,failing=false;const delivered=[],database=given||openAuthDatabase(databasePath),password=randomBytes(24).toString('base64url');
  const app=createAuthApp({clientId:'reset-test.apps.googleusercontent.com',origins:[origin],database,now:()=>now,generateCode:()=>String(++sequence),verifyCredential:async raw=>JSON.parse(raw),
    ...(hosting?{cookieMode:'hosting',secureCookies:true,cookieSecret:randomBytes(32).toString('base64url')}:{}),
    mailer:{configured:true,sendVerification:async mail=>{if(failing)throw new Error('Private SMTP failure withheld');delivered.push(mail);}}});
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}/api/auth/`;
  function client(){const jar=new Map();
    const request=async(route,body,extra={})=>{const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{Cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; '),...(body===undefined?{}:{Origin:origin,'Content-Type':'application/json'}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});for(const cookie of response.headers.getSetCookie()){const [key,value]=cookie.split(';')[0].split('=');if(/Max-Age=0/.test(cookie))jar.delete(key);else jar.set(key,value);}return {status:response.status,body:await response.json(),cookies:response.headers.getSetCookie()};};
    const post=async(route,body,source='config',extra={})=>request(route,body,{'X-CSRF-Token':(await request(source)).body.csrfToken,...extra});
    const reset=(action,body={})=>post('email/password-reset/'+action,body,action==='request'?'config':'email/password-reset');
    return {request,post,reset,jar};
  }
  async function verified(email='member@example.test'){const person=client();assert.equal((await person.post('email/signup',{name:'Member',email,password})).status,202);assert.equal((await person.post('email/verify',{code:delivered.at(-1).code},'email/verification')).status,200);return person;}
  async function flush(){for(let i=0;i<100;i++){await app.locals.passwordReset.tick();const row=given?await database.withContext(()=>database.prepare("SELECT id FROM password_reset_challenges WHERE state IN('queued','sending')").get()):database.prepare("SELECT id FROM password_reset_challenges WHERE state IN('queued','sending')").get();if(!row)return;await new Promise(resolve=>setTimeout(resolve,20));}throw new Error('Reset worker did not settle.');}
  return {app,base,database,password,client,verified,flush,delivered,failDelivery:value=>{failing=value;},advance:ms=>{now+=ms;},now:()=>now,
    code:()=>delivered.filter(mail=>mail.purpose==='password-reset').at(-1)?.code,
    close:async()=>{await app.locals.closeAuthDatabase();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));if(!given)database.close();}};
}
