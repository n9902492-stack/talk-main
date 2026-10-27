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

