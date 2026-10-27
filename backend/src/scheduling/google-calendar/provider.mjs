import {createHash} from 'node:crypto';
import {calendarScope} from './config.mjs';
export class CalendarError extends Error{constructor(code,status=0){super('Google Calendar operation failed.');this.code=code;this.status=status;}}
export function googleCalendarProvider(config,{request=fetch}={}){
 async function call(url,{token,method='GET',body,headers={},form=false}={}){
  try{const r=await request(url,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':form?'application/x-www-form-urlencoded':'application/json'}:{}),...headers},...(body?{body:form?new URLSearchParams(body).toString():JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(15000)});
   if(r.status===204)return {};const value=await r.json().catch(()=>({}));
   if(!r.ok){const code=value.error==='invalid_grant'?'authorization_required':r.status===401?'unauthorized':r.status===410?'sync_expired':r.status===412?'precondition':r.status===409?'duplicate':r.status===404?'not_found':r.status===429||r.status>=500?'temporary':'permission';throw new CalendarError(code,r.status);}return value;
  }catch(e){if(e instanceof CalendarError)throw e;throw new CalendarError('temporary');}
 }
 const eventPath=(calendar,id='')=>'https://www.googleapis.com/calendar/v3/calendars/'+encodeURIComponent(calendar)+'/events'+(id?'/'+encodeURIComponent(id):'');
 const codeBody=extra=>({client_id:config.clientId,client_secret:config.clientSecret,...extra});
 return {
  authorizationUrl(state,verifier){const u=new URL('https://accounts.google.com/o/oauth2/v2/auth');u.search=new URLSearchParams({client_id:config.clientId,redirect_uri:config.redirectUri,response_type:'code',scope:calendarScope+' openid email',access_type:'offline',prompt:'consent',state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}).toString();return u.href;},
  exchange:(code,verifier)=>call('https://oauth2.googleapis.com/token',{method:'POST',form:true,body:codeBody({code,code_verifier:verifier,redirect_uri:config.redirectUri,grant_type:'authorization_code'})}),
  refresh:refresh_token=>call('https://oauth2.googleapis.com/token',{method:'POST',form:true,body:codeBody({refresh_token,grant_type:'refresh_token'})}),
  identity:token=>call('https://openidconnect.googleapis.com/v1/userinfo',{token}),
  revoke:token=>call('https://oauth2.googleapis.com/revoke',{method:'POST',form:true,body:{token}}),
  get:(token,calendar,id)=>call(eventPath(calendar,id),{token}),
  insert:(token,calendar,payload,updates)=>call(eventPath(calendar)+'?sendUpdates='+updates,{token,method:'POST',body:payload}),
  update:(token,calendar,id,{id:ignored,...payload},etag,updates)=>call(eventPath(calendar,id)+'?sendUpdates='+updates,{token,method:'PATCH',body:payload,headers:etag?{'If-Match':etag}:{}}),
  remove:(token,calendar,id,etag,updates)=>call(eventPath(calendar,id)+'?sendUpdates='+updates,{token,method:'DELETE',headers:etag?{'If-Match':etag}:{}}),
  list:(token,calendar,params)=>call(eventPath(calendar)+'?'+new URLSearchParams({...params,maxResults:'2500',fields:'items(id,status,etag,start,end,summary,description,location,reminders,extendedProperties,attendees(email,responseStatus),transparency),nextPageToken,nextSyncToken'}),{token})
 };
}
