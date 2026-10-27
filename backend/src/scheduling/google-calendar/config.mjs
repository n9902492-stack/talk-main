const safeOrigin=value=>{try{const u=new URL(value);return !u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==='/'&&(u.protocol==='https:'||u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname))?u.origin:null;}catch{return null;}};
export const calendarScope='https://www.googleapis.com/auth/calendar.events.owned';
export const defaultCalendarSettings=Object.freeze({autoCreate:false,remind15:true,remindDay:false,inviteGuests:false});
export function calendarConfiguration(env={}, {origins}={}){
 const origin=safeOrigin(env.GOOGLE_CALENDAR_PUBLIC_URL||env.APP_URL),key=env.GOOGLE_CALENDAR_TOKEN_KEY;
 const configured=Boolean(origin&&(!origins||origins.includes(origin))&&env.GOOGLE_CALENDAR_CLIENT_ID&&env.GOOGLE_CALENDAR_CLIENT_SECRET&&typeof key==='string'&&/^[A-Za-z0-9_-]{43}$/.test(key)&&Buffer.from(key,'base64url').length===32);
 return Object.freeze({configured,origin,clientId:env.GOOGLE_CALENDAR_CLIENT_ID,clientSecret:env.GOOGLE_CALENDAR_CLIENT_SECRET,key,
  redirectUri:origin?origin+'/api/auth/scheduling/google-calendar/callback':null,
  oauth:configured&&env.GOOGLE_CALENDAR_OAUTH_ENABLED==='true',writes:configured&&env.GOOGLE_CALENDAR_SYNC_ENABLED==='true',reads:configured&&env.GOOGLE_CALENDAR_READ_ENABLED==='true',invitations:configured&&env.GOOGLE_CALENDAR_INVITATIONS_ENABLED==='true'});
}
