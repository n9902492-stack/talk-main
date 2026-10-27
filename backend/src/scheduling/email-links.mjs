import {createHmac,timingSafeEqual} from 'node:crypto';

// Purpose-bound email credentials can be regenerated after restart without
// persisting bearer credentials, SMTP bodies or LiveKit tokens in the database.
export function createEmailLinks({baseUrl,secret}) {
  let url;
  try { url=new URL(baseUrl); } catch { throw new Error('Scheduling email requires a valid SCHEDULING_PUBLIC_URL.'); }
  if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||
    !(url.protocol==='https:'||url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))
    throw new Error('Scheduling email requires an HTTPS origin or a loopback test origin.');
  if(typeof secret!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(secret)||Buffer.from(secret,'base64url').length!==32)
    throw new Error('Scheduling email requires a dedicated 32-byte base64url SCHEDULING_EMAIL_LINK_SECRET.');
  const key=Buffer.from(secret,'base64url');
  const token=b=>createHmac('sha256',key).update(`talk:scheduling:email-access:v1:${b.id}:${b.version}`).digest('base64url');
  return Object.freeze({
    inviteeUrl:b=>`${url.origin}/booking-confirmation?id=${encodeURIComponent(b.id)}#${token(b)}`,
    hostUrl:b=>`${url.origin}/device-test?room=${encodeURIComponent(b.meeting_id)}`,
    verify(b,value,now){
      if(b.status!=='confirmed'||now>b.ends_at+3600000||typeof value!=='string'||!/^[-\w]{43}$/.test(value))return false;
      return timingSafeEqual(Buffer.from(value),Buffer.from(token(b)));
    }
  });
}
