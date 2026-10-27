export const schedulingBase='/api/auth/scheduling';
let formToken='';
export function newBookingCredential(){const bytes=crypto.getRandomValues(new Uint8Array(32));return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
export async function schedulingRequest(path:string,body?:unknown,host=false,refreshedForm=false):Promise<any>{
 const headers:Record<string,string>={};if(body!==undefined){headers['Content-Type']='application/json';if(host){const r=await fetch('/api/auth/session',{credentials:'same-origin',cache:'no-store'});const s=await r.json();if(!s.csrfToken||!s.user||s.requiresConfirmation)throw new Error('Sign in to manage your schedule.');headers['X-CSRF-Token']=s.csrfToken;}else{if(!formToken){const r=await fetch(schedulingBase+'/form',{credentials:'same-origin',cache:'no-store'});const v=await r.json();if(!r.ok)throw new Error(v.message||'Booking form unavailable.');formToken=v.formToken;}headers['X-Scheduling-Token']=formToken;}}
 const response=await fetch(schedulingBase+path,{credentials:'same-origin',cache:'no-store',method:body===undefined?'GET':'POST',headers,...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});const result=await response.json();if(!response.ok){if(result.error==='invalid_booking_form'){formToken='';if(!host&&body!==undefined&&!refreshedForm)return schedulingRequest(path,body,false,true);}throw new Error(result.message||'Scheduling is unavailable.');}return result;
}
export const browserTimezone=()=>Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
export const bookingTime=(time:number,timezone:string)=>new Intl.DateTimeFormat(undefined,{timeZone:timezone,dateStyle:'medium',timeStyle:'short'}).format(time);
export const guestMeeting=()=>new URLSearchParams(window.location.search).get('guest')==='1';
export const meetingEndpoint=(room:string)=>`${guestMeeting()?schedulingBase+'/guest/meetings':'/api/auth/meetings'}/${encodeURIComponent(room)}`;
