import {digest} from './repository.mjs';
export const googleEventId=(connection,booking)=>'talk'+digest(connection+':'+booking);
export function publicTalkJoin(origin,meeting){const u=new URL('/device-test',origin);u.searchParams.set('room',meeting);return u.href;}
export function eventPayload(b,c,origin,invitationGate){
 const settings=JSON.parse(c.settings),agenda=JSON.parse(b.event_settings||'{}').agenda;
 // No invitation token, OTP, meeting credential or qualifying answer is read.
 const description=[`Talk meeting: ${b.title}`,`Host: ${b.host_name}`,...typeof agenda==='string'?[`Agenda: ${agenda.slice(0,2000).replace(/https?:\/\/[^\s]+/g,'[link omitted]')}`]:[],`Join Talk: ${publicTalkJoin(origin,b.meeting_id)}`,'Invited guests: use your private Talk invitation to verify your email. Host admission is required.'].join('\n');
 return {id:googleEventId(c.id,b.id),summary:'Talk — '+b.title,description,location:'Talk Video Meeting',start:{dateTime:new Date(b.starts_at).toISOString(),timeZone:b.host_timezone},end:{dateTime:new Date(b.ends_at).toISOString(),timeZone:b.host_timezone},reminders:{useDefault:false,overrides:[...settings.remind15?[{method:'popup',minutes:15}]:[],...settings.remindDay?[{method:'popup',minutes:1440}]:[]]},extendedProperties:{private:{talkBookingId:b.id,talkVersion:String(b.version)}},...invitationGate&&settings.inviteGuests?{attendees:[{email:b.email}]}:{}};
}
export function ownedEvent(value){return {summary:value.summary||'',description:value.description||'',location:value.location||'',start:{at:Date.parse(value.start?.dateTime||value.start?.date),zone:value.start?.timeZone||''},end:{at:Date.parse(value.end?.dateTime||value.end?.date),zone:value.end?.timeZone||''},reminders:{useDefault:value.reminders?.useDefault===true,overrides:(value.reminders?.overrides||[]).map(r=>({method:r.method,minutes:r.minutes})).sort((a,b)=>a.minutes-b.minutes)},attendees:(value.attendees||[]).map(a=>a.email.toLowerCase()).sort(),talkBookingId:value.extendedProperties?.private?.talkBookingId||'',talkVersion:value.extendedProperties?.private?.talkVersion||''};}
export const eventHash=value=>digest(ownedEvent(value));
export function safeEventUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&['calendar.google.com','www.google.com'].includes(u.hostname)&&!u.username&&!u.password&&!u.port?u.href:null;}catch{return null;}}
