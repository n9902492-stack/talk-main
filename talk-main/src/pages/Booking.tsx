import { useState } from 'react';
import { ArrowLeft, ArrowRight, Calendar, Clock, Video, CheckCircle2, Download } from 'lucide-react';

const dates = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'];
const slots = ['09:45', '10:30', '11:15', '14:00', '15:30'];
const dateLabel = (date: string) => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${date}T12:00:00+05:30`));
export default function Booking() {
  const [step, setStep] = useState(0);
  const [date, setDate] = useState(dates[0]);
  const [time, setTime] = useState(slots[0]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState(sessionStorage.getItem('talk-email') || '');
  const [guests, setGuests] = useState('');
  const [guestError, setGuestError] = useState('');
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const list = guests.split(',').map(value => value.trim()).filter(Boolean);
    if (list.length > 5 || list.some(value => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))) { setGuestError('Enter up to 5 valid guest emails, separated by commas.'); return; }
    sessionStorage.setItem('talk-name', name.trim()); sessionStorage.setItem('talk-email', email);
    sessionStorage.setItem('talk-booking', JSON.stringify({ date, time, name, email, guests: list })); setStep(2);
  };
  const calendar = () => {
    const start = new Date(`${date}T${time}:00+05:30`); const end = new Date(start.getTime() + 30 * 60000);
    const stamp = (value: Date) => value.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Talk//Local Demo//EN', 'BEGIN:VEVENT', `UID:talk-${start.getTime()}@localhost`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`, 'SUMMARY:See Talk in action', 'DESCRIPTION:Local Talk session preview. Open http://localhost:3001/device-test', 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = 'talk-session.ics'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <section className="page-width py-12 md:py-16"><a href="/" className="back-link"><ArrowLeft size={16} />Back to Talk</a><div className="booking-card">{step === 2 ? <div className="booking-success"><CheckCircle2 size={66} className="text-emerald-500 mx-auto mb-6" /><h1>See Talk in action</h1><p>You’ve saved a session with Team Talk in this local preview.</p><div className="booking-summary"><div><Calendar size={18} />{dateLabel(date)}</div><div><Clock size={18} />{time} · 30 minutes · India Standard Time</div><div><Video size={18} />Online with Talk</div></div><a href="/device-test" className="primary-button">Open session lobby<ArrowRight size={16} /></a><button className="secondary-button ml-3" onClick={calendar}><Download size={16} />Add to calendar</button><p className="text-xs text-secondary mt-5">Booking saved in this browser. No invitation email is sent.</p></div> : <><span className="eyebrow">A BETTER WAY TO MEET</span><h1>See Talk in action</h1><p className="text-secondary mb-8">A 30-minute tour of your next great video experience.</p>{step === 0 ? <div className="booking-options"><div><h2 className="font-bold mb-4">Choose a date</h2><div className="grid gap-2">{dates.map(value => <button key={value} aria-pressed={date === value} className={`date-option ${date === value ? 'selected' : ''}`} onClick={() => setDate(value)}><Calendar size={17} />{dateLabel(value)}</button>)}</div></div><div><h2 className="font-bold mb-4">Available demo times</h2><div className="grid grid-cols-2 gap-3">{slots.map(slot => <button key={slot} aria-pressed={time === slot} className={`date-option ${time === slot ? 'selected' : ''}`} onClick={() => setTime(slot)}>{slot}</button>)}</div><p className="text-xs text-secondary mt-4">India Standard Time (UTC+05:30)</p><button className="primary-button mt-6" onClick={() => setStep(1)}>Continue<ArrowRight size={16} /></button></div></div> : <form onSubmit={submit}><p className="text-sm text-primary mb-6">{dateLabel(date)} · {time} · 30 minutes</p><label htmlFor="booking-name" className="field-label">Full name</label><input className="form-input mb-5" id="booking-name" placeholder="Enter your name" required value={name} maxLength={80} onChange={event => setName(event.target.value)} autoComplete="name" /><label htmlFor="booking-email" className="field-label">Email</label><input className="form-input mb-5" id="booking-email" type="email" placeholder="Enter your email" required value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" /><label htmlFor="booking-guests" className="field-label">Add guests <span className="text-secondary font-normal">(optional)</span></label><input className="form-input" id="booking-guests" placeholder="Add up to 5 guests by email, separated by commas" value={guests} onChange={event => setGuests(event.target.value)} />{guestError && <p role="alert" className="inline-error mt-2">{guestError}</p>}<div className="flex justify-end gap-3 mt-8"><button type="button" className="secondary-button" onClick={() => setStep(0)}>Back</button><button type="submit" className="primary-button">Schedule session<ArrowRight size={16} /></button></div></form>}</>}</div></section>;
}
