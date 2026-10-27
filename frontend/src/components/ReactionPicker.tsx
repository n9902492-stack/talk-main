import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { findReactions, reactionCategories, recentReactions, reactions } from '../lib/reactionCatalog';
import type { MeetingManagement } from '../hooks/useMeetingManagement';

export default function ReactionPicker({ management, connected }: { management: MeetingManagement; connected: boolean }) {
  const { user } = useAuth();
  const key = `talk-recent-reactions:${user?.id || 'member'}`;
  const [category, setCategory] = useState('All'), [query, setQuery] = useState('');
  const [recent, setRecent] = useState<string[]>(() => { try { return recentReactions(JSON.parse(localStorage.getItem(key) || '[]')); } catch { return []; } });
  const send = async (emoji: string) => {
    if (!await management.action('reaction', undefined, { emoji })) return;
    const next = recentReactions([emoji, ...recent]); setRecent(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* Recents are optional; no credentials stored. */ }
  };
  const choices = findReactions(query, category === 'All' ? '' : category);
  const buttons = (items: typeof reactions) => items.map(item => <button key={item.emoji} title={item.label} disabled={!connected || management.busy} aria-label={`React ${item.emoji}`} onClick={() => void send(item.emoji)}><span aria-hidden="true">{item.emoji}</span><small>{item.label}</small></button>);
  return <section className="talk-reaction-picker" aria-label="Emoji picker"><label htmlFor="talk-reaction-search">Search reactions</label><input id="talk-reaction-search" className="form-input" type="search" placeholder="Search emoji or feeling" maxLength={80} value={query} onChange={event => setQuery(event.target.value)} />
    {!query && recent.length > 0 && <><h3>Recently used</h3><div className="talk-reaction-grid">{buttons(recent.map(emoji => reactions.find(item => item.emoji === emoji)!))}</div></>}
    <div className="talk-reaction-categories" role="group" aria-label="Reaction categories">{['All', ...reactionCategories].map(value => <button key={value} aria-pressed={category === value} onClick={() => setCategory(value)}>{value}</button>)}</div>
    <div className="talk-reaction-grid" aria-label="Available reactions">{buttons(choices)}</div>{!choices.length && <p>No reactions found. Try another word.</p>}
    <p className="live-panel-caption">Visible to everyone for a few seconds. Up to five reactions every ten seconds.</p>{management.error && <p role="alert" className="talk-avatar-error">{management.error}</p>}
  </section>;
}
