import { createContext, useContext, useState, type Dispatch, type SetStateAction } from 'react';

// Ephemeral UI drafts only. Nothing is written to storage, history or the URL.
export const AuthDrafts = createContext<Record<string, unknown> | null>(null);
export function useAuthDraft<T,>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const drafts = useContext(AuthDrafts);
  const [value, setValue] = useState<T>(() => drafts && key in drafts ? drafts[key] as T : initial);
  const update: Dispatch<SetStateAction<T>> = next => setValue(previous => {
    const value = typeof next === 'function' ? (next as (previous: T) => T)(previous) : next;
    if (drafts) drafts[key] = value;
    return value;
  });
  return [value, update];
}
