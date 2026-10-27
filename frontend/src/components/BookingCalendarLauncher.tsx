import {useEffect,useRef,useState,type ComponentProps} from 'react';
import {CalendarDays} from 'lucide-react';
import SchedulingCalendar from './SchedulingCalendar';

export default function BookingCalendarLauncher(props:ComponentProps<typeof SchedulingCalendar>){
 const [open,setOpen]=useState(false),dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null),bookingTarget=useRef<string|null>(null);
 useEffect(()=>{
  if(!open)return;
  const element=dialog.current;if(!element)return;
  const overflow=document.body.style.overflow;
  element.showModal();document.body.style.overflow='hidden';element.querySelector<HTMLButtonElement>('.booking-calendar-close')?.focus();
  return()=>{if(element.open)element.close();document.body.style.overflow=overflow;};
 },[open]);
 function close(){setOpen(false);}
 function manageBooking(id:string){
  bookingTarget.current=id;close();
 }
 return <>
  <button ref={trigger} type="button" className="booking-calendar-launcher secondary" aria-haspopup="dialog" aria-expanded={open} aria-controls="booking-calendar-dialog" onClick={()=>setOpen(true)}><CalendarDays size={18} aria-hidden="true"/>Booking calendar</button>
  <dialog ref={dialog} id="booking-calendar-dialog" className="booking-calendar-dialog" aria-label="Booking calendar" onCancel={event=>{event.preventDefault();close();}} onClose={()=>{
   setOpen(false);const id=bookingTarget.current;bookingTarget.current=null;
   if(id)requestAnimationFrame(()=>{const target=document.getElementById('booking-'+id);target?.focus({preventScroll:true});target?.scrollIntoView({block:'center',behavior:'instant'});});
   else trigger.current?.focus({preventScroll:true});
  }} onClick={event=>{
   if(event.target!==event.currentTarget)return;
   const bounds=event.currentTarget.getBoundingClientRect();if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)close();
  }}>
   {open&&<SchedulingCalendar {...props} onClose={close} onManageBooking={manageBooking}/>}
  </dialog>
 </>;
}
