import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { readBackground, saveBackground, type BackgroundPreference } from '../lib/backgroundCatalog';
export function useBackgroundPreference() {
  const { user } = useAuth();const accountId = user?.id || 'guest';
  const [preference, setPreference] = useState(() => readBackground(accountId));
  useEffect(() => {
    setPreference(readBackground(accountId));
    const update = (event: Event) => { const detail = (event as CustomEvent).detail; if (detail?.accountId === accountId) setPreference(detail.preference); };
    const storage = (event: StorageEvent) => { if (event.key === `talk-background:${accountId}`) setPreference(readBackground(accountId,true)); };
    window.addEventListener('talk:background-preference', update);window.addEventListener('storage', storage);
    return () => { window.removeEventListener('talk:background-preference', update);window.removeEventListener('storage', storage); };
  }, [accountId]);
  return { preference, accountId, select: (value: BackgroundPreference) => { setPreference(value); saveBackground(accountId, value); } };
}
