const previewKey = 'talk-dashboard-preview';

export function openWorkspacePreview(email: string, name?: string) {
  const details = { email: email.trim(), ...(name?.trim() ? { name: name.trim().slice(0, 80) } : {}) };
  try { sessionStorage.setItem(previewKey, JSON.stringify(details)); } catch { /* The preview also works without browser storage. */ }
  window.history.pushState({}, '', '/dashboard');
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function readPreviewEmail() {
  try {
    const value = JSON.parse(sessionStorage.getItem(previewKey) || 'null');
    return typeof value?.email === 'string' && value.email.length <= 254 ? value.email : '';
  } catch { return ''; }
}

export function readPreviewName() {
  try {
    const value = JSON.parse(sessionStorage.getItem(previewKey) || 'null');
    return typeof value?.name === 'string' && value.name.length <= 80 ? value.name.trim() : '';
  } catch { return ''; }
}

export function exitWorkspacePreview() {
  try { sessionStorage.removeItem(previewKey); } catch { /* No stored preview to clear. */ }
  window.history.replaceState({}, '', '/sign-in');
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function readSavedDemo() {
  try {
    const value = JSON.parse(sessionStorage.getItem('talk-booking') || 'null');
    if (typeof value?.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.date) || typeof value.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.time)) return null;
    const start = new Date(`${value.date}T${value.time}:00+05:30`);
    const calendarDate = new Date(`${value.date}T12:00:00+05:30`);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(calendarDate.getTime()) || calendarDate.toISOString().slice(0, 10) !== value.date) return null;
    return { date: value.date, time: value.time, start };
  } catch { return null; }
}
