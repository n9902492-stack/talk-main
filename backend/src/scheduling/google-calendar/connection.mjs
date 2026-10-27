import {randomBytes,randomUUID} from 'node:crypto';
import {reject} from '../validation.mjs';
import {calendarScope,defaultCalendarSettings} from './config.mjs';
import {tokenVault} from './vault.mjs';
import {digest,enqueueHostBookings} from './repository.mjs';
export function calendarConnection(s,config,provider){
 const vault=config.configured?tokenVault(config.key):null,purpose=(host,id)=>`talk:calendar:${host}:${id}:tokens`;
 const row=host=>s.get('SELECT * FROM talk_calendar_connections WHERE host_id=?',host);
 async function status(host){const c=await row(host);return {configured:config.configured,authorizationEnabled:config.oauth,writesEnabled:config.writes,readsEnabled:config.reads,invitationsEnabled:config.invitations,status:c?.status||'disconnected',accountEmail:c?.account_email||null,calendarId:c?.calendar_id||'primary',settings:c?JSON.parse(c.settings):{...defaultCalendarSettings},lastSyncAt:c?.last_sync_at||null,errorCode:c?.error_code||null};}
 async function begin(host,session){
  if(!config.oauth)reject(503,'calendar_authorization_disabled','Google Calendar authorization is not enabled. Your Talk sign-in is unchanged.');
  const state=randomBytes(32).toString('base64url'),verifier=randomBytes(32).toString('base64url');
  await s.transaction(host,async()=>{await s.run('DELETE FROM talk_calendar_oauth_states WHERE host_id=?',host);await s.run('INSERT INTO talk_calendar_oauth_states(state_hash,host_id,session_hash,verifier_cipher,connection_revision,expires_at) VALUES (?,?,?,?,?,?)',digest(state),host,digest(session),vault.seal(verifier,`talk:calendar:${host}:oauth:${digest(state)}`),(await row(host))?.revision||0,s.now()+600000);});
  return {authorizationUrl:provider.authorizationUrl(state,verifier)};
 }
 async function callback(host,session,{state,code,error}){
  if(!config.oauth)reject(503,'calendar_authorization_disabled','Calendar authorization is disabled.');
  if(typeof state!=='string'||!/^[-\w]{43}$/.test(state)||typeof code!=='string'||!code||code.length>4096||error)reject(400,'calendar_oauth_denied','Google Calendar consent was not completed.');
  let verifier;
  await s.transaction(host,async()=>{const r=await s.get('SELECT * FROM talk_calendar_oauth_states WHERE state_hash=?',digest(state));if(!r||r.host_id!==host||r.session_hash!==digest(session)||r.expires_at<=s.now()||r.consumed)reject(403,'calendar_oauth_state','Calendar authorization expired or did not match this session.');await s.run('UPDATE talk_calendar_oauth_states SET consumed=1 WHERE state_hash=?',digest(state));verifier=vault.open(r.verifier_cipher,`talk:calendar:${host}:oauth:${digest(state)}`);});
  const token=await provider.exchange(code,verifier),identity=await provider.identity(token.access_token),scopes=String(token.scope||'').split(' ');
  if(!scopes.includes(calendarScope)||!identity.sub||identity.email_verified!==true||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity.email||'')||!token.refresh_token||!token.access_token)reject(403,'calendar_consent_incomplete','Calendar permission or offline access was not granted. Reconnect with the required consent.');
  await s.transaction(host,async()=>{
   const old=await row(host),pending=await s.get('SELECT * FROM talk_calendar_oauth_states WHERE state_hash=?',digest(state));
   if(!pending||pending.host_id!==host||pending.session_hash!==digest(session)||pending.expires_at<=s.now()||pending.connection_revision!==(old?.revision||0))reject(403,'calendar_oauth_state','Calendar consent was superseded. Start again.');
   const id=old?.account_subject===identity.sub?old.id:randomUUID();
   if(old?.status==='connected'&&old.account_subject!==identity.sub)reject(409,'calendar_account_changed','Disconnect your current calendar before connecting a different Google account.');
   const cipher=vault.seal({refresh:token.refresh_token,access:token.access_token,expiresAt:s.now()+Math.min(Number(token.expires_in)||3600,86400)*1000},purpose(host,id));
   await s.run("INSERT INTO talk_calendar_connections(host_id,id,status,account_email,account_subject,token_cipher,settings,scopes,updated_at) VALUES (?,?,'connected',?,?,?,?,?,?) ON CONFLICT(host_id) DO UPDATE SET id=excluded.id,status='connected',account_email=excluded.account_email,account_subject=excluded.account_subject,token_cipher=excluded.token_cipher,scopes=excluded.scopes,sync_cipher=NULL,error_code=NULL,revision=talk_calendar_connections.revision+1,updated_at=excluded.updated_at",host,id,identity.email,identity.sub,cipher,old?.settings||JSON.stringify(defaultCalendarSettings),JSON.stringify(scopes),s.now());
   await s.run("UPDATE talk_calendar_jobs SET status='cancelled',lease_until=NULL WHERE host_id=? AND status IN ('pending','processing')",host);
   await s.run('DELETE FROM talk_calendar_oauth_states WHERE host_id=?',host);await enqueueHostBookings(s,host);await s.audit(host,null,'calendar_connected');
  });return status(host);
 }
 async function access(c,{fresh=false}={}){
  const live=await row(c.host_id);if(!live||live.id!==c.id||live.status!=='connected')throw Object.assign(new Error('Calendar disconnected.'),{code:'authorization_required'});
  const tokens=vault.open(live.token_cipher,purpose(c.host_id,c.id));if(!fresh&&tokens.expiresAt>s.now()+60000)return tokens.access;
  const owner=randomUUID();let latest;
  await s.transaction(c.host_id,async()=>{
   const current=await row(c.host_id);if(current?.status!=='connected'||current.id!==c.id)throw Object.assign(new Error('Calendar disconnected.'),{code:'authorization_required'});
   if(current.refresh_until>s.now())throw Object.assign(new Error('Calendar refresh is busy.'),{code:'temporary'});
   latest=vault.open(current.token_cipher,purpose(c.host_id,c.id));await s.run('UPDATE talk_calendar_connections SET refresh_owner=?,refresh_until=? WHERE host_id=?',owner,s.now()+30000,c.host_id);
  });
  try{const value=await provider.refresh(latest.refresh);if(!value.access_token||value.scope&&!String(value.scope).split(' ').includes(calendarScope))throw Object.assign(new Error('Calendar permission unavailable.'),{code:'authorization_required'});
   const result=await s.run("UPDATE talk_calendar_connections SET token_cipher=?,updated_at=?,refresh_owner=NULL,refresh_until=NULL WHERE host_id=? AND id=? AND status='connected' AND refresh_owner=? AND token_cipher=?",vault.seal({refresh:value.refresh_token||latest.refresh,access:value.access_token,expiresAt:s.now()+Math.min(Number(value.expires_in)||3600,86400)*1000},purpose(c.host_id,c.id)),s.now(),c.host_id,c.id,owner,live.token_cipher);if(!result.changes)throw Object.assign(new Error('Calendar connection changed.'),{code:'temporary'});return value.access_token;
  }finally{await s.run('UPDATE talk_calendar_connections SET refresh_owner=NULL,refresh_until=NULL WHERE host_id=? AND refresh_owner=?',c.host_id,owner);}
 }
 async function api(c,operation){try{return await operation(await access(c));}catch(e){if(e.code==='unauthorized'){try{return await operation(await access(c,{fresh:true}));}catch(next){e=next;}}if(e.code==='authorization_required'||e.code==='unauthorized'){await s.run("UPDATE talk_calendar_connections SET status='reconnect_required',error_code='authorization_required',token_cipher=NULL WHERE host_id=? AND id=? AND status='connected' AND revision=?",c.host_id,c.id,c.revision);}throw e;}}
 async function preferences(host,body){
  const settings={};for(const key of Object.keys(defaultCalendarSettings)){if(typeof body[key]!=='boolean')reject(400,'calendar_settings','Choose valid calendar settings.');settings[key]=body[key];}
  if(settings.inviteGuests&&!config.invitations)reject(403,'calendar_invitations_disabled','Calendar attendee invitations require separate operator approval.');
  await s.transaction(host,async()=>{const old=await row(host);await s.run("INSERT INTO talk_calendar_connections(host_id,id,status,settings,updated_at) VALUES (?,?,'disconnected',?,?) ON CONFLICT(host_id) DO UPDATE SET settings=excluded.settings,revision=talk_calendar_connections.revision+1,updated_at=excluded.updated_at",host,randomUUID(),JSON.stringify(settings),s.now());if(old?.status==='connected')await enqueueHostBookings(s,host);await s.audit(host,null,'calendar_preferences_updated');});return status(host);
 }
 async function disconnect(host){const c=await row(host);let refresh;
  if(c?.token_cipher&&vault)try{refresh=vault.open(c.token_cipher,purpose(host,c.id)).refresh;}catch{}
  await s.transaction(host,async()=>{await s.run("UPDATE talk_calendar_connections SET status='disconnected',token_cipher=NULL,sync_cipher=NULL,revision=revision+1,error_code=NULL,updated_at=? WHERE host_id=?",s.now(),host);await s.run("UPDATE talk_calendar_jobs SET status='cancelled',lease_until=NULL WHERE host_id=? AND status IN ('pending','processing')",host);await s.run('DELETE FROM talk_calendar_oauth_states WHERE host_id=?',host);await s.audit(host,null,'calendar_disconnected');});
  if(refresh&&config.oauth)try{await provider.revoke(refresh);}catch{await s.run("UPDATE talk_calendar_connections SET error_code='revocation_pending' WHERE host_id=?",host);}return status(host);
 }
 return {status,begin,callback,access,api,preferences,disconnect,row,vault};
}
