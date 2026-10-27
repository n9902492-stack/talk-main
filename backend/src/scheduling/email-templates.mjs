const labels = Object.freeze({
  confirmation: { subject: 'Booking confirmed', heading: 'Your meeting is confirmed', verb: 'is confirmed' },
  rescheduled: { subject: 'Booking rescheduled', heading: 'Your meeting was rescheduled', verb: 'has been rescheduled' },
  cancellation: { subject: 'Booking cancelled', heading: 'Your meeting was cancelled', verb: 'has been cancelled' },
  reminder_day: { subject: 'Meeting today', heading: 'Your meeting is today', verb: 'is scheduled for today' },
  reminder_15: { subject: 'Meeting reminder', heading: 'Your meeting starts soon', verb: 'starts soon' },
});

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function oneLine(value) {
  return String(value ?? '').replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ').trim();
}

function link(value) {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new TypeError('Scheduling email requires a valid application link.');
  }
  return url.href;
}

function meetingTime(booking, timezone) {
  const format = new Intl.DateTimeFormat('en', {
    timeZone: timezone, dateStyle: 'full', timeStyle: 'short',
  });
  return `${format.format(booking.starts_at)} - ${format.format(booking.ends_at)} (${timezone})`;
}

function managementLink(target, action, bookingId, isHost) {
  const url = isHost ? new URL('/bookings', target) : new URL(target);
  url.searchParams.set('action', action);
  if (isHost) {
    url.searchParams.set('booking', bookingId);
    url.hash = `booking-${encodeURIComponent(bookingId)}`;
  }
  // An action selects the relevant screen; state changes still require the
  // existing authorized, CSRF-protected POST operation and user confirmation.
  return url.href;
}

/** Pure templates: no env access, delivery, credentials, questions, or other invitees. */
export function renderSchedulingEmail({ kind, recipient, b, host, inviteeUrl, hostUrl, managementEnabled = true }) {
  const copy = labels[kind];
  if (!copy || !['host', 'invitee'].includes(recipient)) throw new TypeError('Unknown scheduling email template.');
  const isHost = recipient === 'host';
  const name = oneLine(isHost ? host.name : b.name) || 'there';
  const hostName = oneLine(host.name) || 'your host';
  const inviteeName = oneLine(b.name) || 'your invitee';
  const title = oneLine(b.title) || 'Talk meeting';
  const cancelled = kind === 'cancellation';
  const target = cancelled ? null : link(isHost ? hostUrl : inviteeUrl);
  const action = isHost ? 'Open host meeting' : 'View booking and join';
  const duration = (b.ends_at - b.starts_at) / 60_000;
  if (!Number.isFinite(duration) || duration <= 0) throw new TypeError('Scheduling email requires valid meeting times.');
  const management = target && managementEnabled ? [
    ['Reschedule meeting', managementLink(target, 'reschedule', b.id, isHost)],
    ['Cancel booking', managementLink(target, 'cancel', b.id, isHost)],
  ] : [];
  const managementNotice = !cancelled && !managementEnabled
    ? 'Rescheduling and cancellation are unavailable in this isolated test. Contact the host if you need changes.' : '';
  const calendarLabel = cancelled ? 'Calendar update' : 'Add to calendar';
  const calendarInstruction = cancelled
    ? 'Open the attached talk-booking.ics file in your calendar app to apply the cancellation.'
    : 'Open the attached talk-booking.ics file in your calendar app to add or update this meeting.';
  const description = isHost
    ? `Your meeting with ${inviteeName} ${copy.verb}.`
    : `Your meeting with ${hostName} ${copy.verb}.`;
  const details = [
    ['Meeting', title],
    ['Duration', `${duration} ${duration === 1 ? 'minute' : 'minutes'}`],
    ['Invitee time', meetingTime(b, b.timezone)],
    ['Host time', meetingTime(b, host.timezone)],
    ...(isHost ? [['Invitee', `${inviteeName} (${oneLine(b.email)})`]] : [['Host', hostName]]),
  ];
  const instructions = cancelled
    ? 'The invitation and its joining access have been cancelled. No further reminders will be sent for this booking version.'
    : isHost
      ? 'Sign in with your existing Talk host account. Your normal host permissions and waiting-room controls apply.'
      : 'Keep this private booking link to yourself. Talk will verify your email before guest access; the host may need to admit you from the waiting room.';
  const text = [
    `Hi ${name},`, '', description, '',
    ...details.map(([label, value]) => `${label}: ${value}`), '',
    ...(target ? [`${action}: ${target}`, ''] : []),
    `${calendarLabel}: ${calendarInstruction}`, '',
    ...management.map(([label, url]) => `${label}: ${url}`),
    ...(management.length ? [''] : []),
    ...(managementNotice ? [managementNotice, ''] : []),
    instructions, '', 'Talk',
  ].join('\n');
  const managementHtml = management.length ? `<p>${management.map(([label, url]) => `<a href="${escapeHtml(url)}" style="color:#675016">${escapeHtml(label)}</a>`).join(' &nbsp; | &nbsp; ')}</p>` : managementNotice ? `<p>${escapeHtml(managementNotice)}</p>` : '';
  const html = `<!doctype html><html lang="en"><body style="margin:0;background:#f8f7f3;color:#202124;font-family:Arial,sans-serif"><main style="max-width:600px;margin:24px auto;padding:28px;background:#fff;border:1px solid #e5e2da;border-radius:16px"><p style="font-size:24px;font-weight:700;margin:0 0 24px">Talk</p><h1 style="font-size:24px;margin:0 0 20px">${escapeHtml(copy.heading)}</h1><p>Hi ${escapeHtml(name)},</p><p>${escapeHtml(description)}</p><dl>${details.map(([label, value]) => `<dt style="font-weight:700;margin-top:16px">${escapeHtml(label)}</dt><dd style="margin:4px 0 0;line-height:1.5">${escapeHtml(value)}</dd>`).join('')}</dl>${target ? `<p style="margin:28px 0"><a href="${escapeHtml(target)}" style="display:inline-block;background:#81651c;color:#fff;padding:13px 20px;border-radius:8px;text-decoration:none">${escapeHtml(action)}</a></p>` : ''}<p><strong>${escapeHtml(calendarLabel)}:</strong> ${escapeHtml(calendarInstruction)}</p>${managementHtml}<p style="font-size:14px;line-height:1.6;color:#555">${escapeHtml(instructions)}</p></main></body></html>`;
  return { subject: `Talk - ${copy.subject}: ${title}`, text, html };
}
