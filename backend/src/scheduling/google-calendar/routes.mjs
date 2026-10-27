import {calendarInvitation} from '../calendar.mjs';
import {reject} from '../validation.mjs';
import {MeetingError} from '../../meeting-management.mjs';
export function mountCalendarRoutes(router,authenticate,calendar,service){
 const host=handler=>authenticate(async(...args)=>{try{return await handler(...args);}catch(e){if(e instanceof MeetingError)throw e;reject(503,'calendar_unavailable','Google Calendar is temporarily unavailable. Your Talk booking is preserved; check Calendar status or reconnect.');}});
 const base='/google-calendar';
 router.get(base,host(async(_req,res,id)=>res.json(await calendar.connection.status(id))));
 router.post(base+'/connect',host(async(req,res,id,session)=>res.json(await calendar.connection.begin(id,session.csrf_token))));
 router.get(base+'/callback',host(async(req,res,id,session)=>{
  res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
  try{await calendar.connection.callback(id,session.csrf_token,req.query);res.redirect(303,'/bookings?calendar=connected#calendar-integration');}
  catch{res.redirect(303,'/bookings?calendar=authorization-failed#calendar-integration');}
 }));
 router.post(base+'/preferences',host(async(req,res,id)=>res.json(await calendar.connection.preferences(id,req.body))));
 router.post(base+'/disconnect',host(async(_req,res,id)=>res.json(await calendar.connection.disconnect(id))));
 router.post(base+'/check',host(async(_req,res,id)=>res.json(await calendar.incoming.check(id))));
 router.get(base+'/bookings/:id',host(async(req,res,id)=>res.json(await calendar.booking(id,req.params.id))));
 router.post(base+'/bookings/:id/add',host(async(req,res,id)=>res.json(await calendar.add(id,req.params.id))));
 router.post(base+'/bookings/:id/resolve',host(async(req,res,id)=>res.json(await calendar.resolve(id,req.params.id,req.body))));
 router.get(base+'/bookings/:id/ics',host(async(req,res,id)=>{const {booking:b}=await service.detail(req.params.id,null,id);res.set({'Cache-Control':'no-store','Content-Disposition':'attachment; filename="talk-booking.ics"'}).type('text/calendar').send(calendarInvitation({...b,title:b.event.title,cancelled:b.status==='cancelled'}));}));
}
