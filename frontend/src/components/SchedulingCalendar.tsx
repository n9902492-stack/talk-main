import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, X } from 'lucide-react';
import { bookingTime, schedulingRequest } from '../lib/scheduling';
import { calendarDayBlocks, calendarDayStart, calendarParts, shiftCalendarDate, type CalendarBlock, type CalendarBooking, type CalendarSlot } from '../lib/schedulingCalendar';
import '../styles/scheduling-calendar.css';

type CalendarEvent = { id: string; title: string; slug: string; duration: number; enabled: boolean | number };
export default function SchedulingCalendar({ bookings, events, timezone, hostSlug, revision, onClose, onManageBooking }: { bookings: CalendarBooking[]; events: CalendarEvent[]; timezone: string; hostSlug?: string; revision?: unknown; onClose?:()=>void; onManageBooking?:(id:string)=>void }) {
  const [anchor, setAnchor] = useState(() => calendarParts(Date.now(), timezone).date), [days, setDays] = useState(3);
  const [eventId, setEventId] = useState(''), [slots, setSlots] = useState<CalendarSlot[]>([]), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [selected, setSelected] = useState<CalendarBlock | null>(null), [refresh, setRefresh] = useState(0), [fullDay, setFullDay] = useState(false);
  const [displayBookings, setDisplayBookings] = useState(bookings), [refreshing, setRefreshing] = useState(false);
  useEffect(() => setDisplayBookings(bookings), [bookings]);
  async function refreshCalendar() {
    setRefreshing(true);
    try { const value = await schedulingRequest('/dashboard'); setDisplayBookings(value.bookings); setRefresh(value => value + 1); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not refresh your calendar.'); }
    finally { setRefreshing(false); }
  }
  const enabled = events.filter(event => !!event.enabled), event = enabled.find(event => event.id === eventId) || enabled[0];
  const dates = useMemo(() => Array.from({ length: days }, (_, index) => shiftCalendarDate(anchor, index)), [anchor, days]);
  const from = calendarDayStart(anchor, timezone), to = calendarDayStart(shiftCalendarDate(anchor, days), timezone);
  useEffect(() => {
    let active = true; setSelected(null); setSlots([]); setError('');
    if (!event || to <= Date.now()) { setLoading(false); return; }
    setLoading(true);
    void schedulingRequest(`/events/${encodeURIComponent(event.id)}/slots?from=${Math.max(from, Date.now())}&to=${to}&timezone=${encodeURIComponent(timezone)}`)
      .then(value => { if (active) setSlots(value.slots); })
      .catch(failure => { if (active) setError(failure instanceof Error ? failure.message : 'Available times could not be loaded.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [event?.id, from, to, timezone, revision, refresh]);
  const columns = dates.map(date => ({ date, blocks: calendarDayBlocks(date, timezone, displayBookings, slots) }));
  const all = columns.flatMap(column => column.blocks);
  const firstHour = fullDay ? 0 : Math.max(0, Math.min(8, ...all.map(block => Math.floor(block.minute / 60))));
  const lastHour = fullDay ? 24 : Math.min(24, Math.max(19, ...all.map(block => Math.ceil(block.until / 60))));
  const height = (lastHour - firstHour) * 72;
  const clock = (time: number) => new Intl.DateTimeFormat(undefined, { timeZone: timezone, hour: 'numeric', minute: '2-digit', timeZoneName: 'shortOffset' }).format(time);
  const dayLabel = (date: string) => new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(date + 'T12:00:00Z'));
  const publicLink = hostSlug && event ? `/booking/${encodeURIComponent(hostSlug)}/${encodeURIComponent(event.slug)}` : '';
  return <section className="scheduling-calendar" aria-labelledby="booking-calendar-title" aria-busy={loading}>
    <header className="scheduling-calendar-heading"><div><h2 id="booking-calendar-title"><CalendarDays size={19} />Booking calendar</h2><p>See your appointments and bookable times together.</p></div><div className="scheduling-calendar-heading-actions"><button type="button" className="secondary" onClick={() => void refreshCalendar()} disabled={loading || refreshing}>Refresh calendar</button>{onClose&&<button type="button" className="secondary booking-calendar-close" aria-label="Close booking calendar" onClick={onClose}><X size={20} aria-hidden="true"/></button>}</div></header>
    <div className="scheduling-calendar-controls"><div className="scheduling-calendar-dates"><button type="button" className="secondary" aria-label="Previous calendar dates" onClick={() => setAnchor(shiftCalendarDate(anchor, -days))}><ChevronLeft size={16} /></button><button type="button" className="secondary" onClick={() => setAnchor(calendarParts(Date.now(), timezone).date)}>Today</button><button type="button" className="secondary" aria-label="Next calendar dates" onClick={() => setAnchor(shiftCalendarDate(anchor, days))}><ChevronRight size={16} /></button><label>Starting date<input type="date" aria-label="Calendar starting date" value={anchor} onChange={e => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) setAnchor(e.target.value); }} /></label></div><div className="scheduling-calendar-options"><label>View<select aria-label="Calendar view" value={days} onChange={e => setDays(Number(e.target.value))}><option value={3}>3 days</option><option value={7}>7 days</option></select></label><label>Availability for<select aria-label="Calendar event type" value={event?.id || ''} disabled={!enabled.length} onChange={e => setEventId(e.target.value)}>{!enabled.length && <option value="">No active booking links</option>}{enabled.map(item => <option key={item.id} value={item.id}>{item.title} · {item.duration} min</option>)}</select></label></div></div>
    <div className="scheduling-calendar-legend"><span><i className="is-booked" />Confirmed booking</span><span><i className="is-available" />Available start times</span><label><input type="checkbox" checked={fullDay} onChange={e => setFullDay(e.target.checked)} />Show full day</label><span>{timezone}</span></div>
    {loading && <p aria-live="polite" className="scheduling-calendar-status">Checking available times…</p>}{error && <p role="alert" className="scheduler-error">{error} Appointments are still shown.</p>}
    {!event && <p className="scheduling-calendar-status">Save availability and enable a booking link to see available times. Existing appointments stay visible.</p>}
    <div className="scheduling-calendar-scroll" tabIndex={0} role="region" aria-label="Scrollable booking calendar" style={{ '--calendar-days': days } as React.CSSProperties}>
      <div className="scheduling-calendar-grid"><div className="scheduling-calendar-zone" title={timezone}><Clock3 size={14} /><span>{timezone}</span></div>{dates.map(date => <div className={`scheduling-calendar-day-heading${date === calendarParts(Date.now(), timezone).date ? ' is-today' : ''}`} key={date}>{dayLabel(date)}</div>)}
        <div className="scheduling-calendar-hours" style={{ height }}>{Array.from({ length: lastHour - firstHour }, (_, i) => <span key={i} style={{ top: i * 72 }}>{String(firstHour + i).padStart(2, '0')}:00</span>)}</div>
        {columns.map(column => <div className="scheduling-calendar-day" aria-label={dayLabel(column.date)} key={column.date} style={{ height }}>{column.blocks.map(block => {
          const label = block.booking ? `${block.booking.title}, ${block.booking.name}, ${clock(block.booking.starts_at)} to ${clock(block.booking.ends_at)}` : `Available ${clock(block.start)} to ${clock(block.end)}, ${block.slots?.length} start times`;
          const colour = block.booking ? Array.from(block.booking.title).reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % 4 : 0;
          return <button type="button" key={block.id} className={`scheduling-calendar-block is-${block.kind} booking-colour-${colour}`} title={label} aria-label={label} onClick={() => setSelected(block)} style={{ top: (block.minute - firstHour * 60) * 1.2, height: Math.max(30, (block.until - block.minute) * 1.2 - 3), left: `calc(${(block.lane || 0) / (block.lanes || 1) * 100}% + 4px)`, width: `calc(${100 / (block.lanes || 1)}% - 8px)` }}><strong>{block.booking?.title || 'Available'}</strong><span>{block.booking ? `${clock(block.booking.starts_at)} – ${clock(block.booking.ends_at)}` : `${block.slots?.length} start times`}</span></button>;
        })}</div>)}
      </div>
    </div>
    <p className="scheduling-calendar-footnote">Times use {timezone}. Dashed blocks group valid start times for the selected booking link. Buffers, holidays, notice and booking limits are checked by Talk. Cancelled bookings are excluded.</p>
    {selected && <div className="scheduling-calendar-selection" role="region" aria-label="Calendar selection"><header><h3>{selected.booking?.title || 'Available start times'}</h3><button type="button" className="secondary" aria-label="Close calendar selection" onClick={() => setSelected(null)}><X size={16} /></button></header>{selected.booking ? <><p>{selected.booking.name} · {bookingTime(selected.booking.starts_at, timezone)} – {clock(selected.booking.ends_at)}</p><a href={`#booking-${selected.booking.id}`} className="scheduling-calendar-manage" onClick={()=>{if(selected.booking)onManageBooking?.(selected.booking.id);}}>Manage booking, reschedule or cancel</a></> : <><p>These start times are currently available for {event?.title}. Opening the booking page does not reserve a slot.</p><ul>{selected.slots?.map(slot => <li key={slot.start}>{clock(slot.start)}</li>)}</ul>{publicLink && <a href={publicLink}>Open booking page</a>}</>}</div>}
  </section>;
}
