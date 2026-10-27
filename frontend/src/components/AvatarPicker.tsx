import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { avatarPresets, avatarStyles } from '../lib/avatarCatalog';
import type { AvatarSelection } from '../lib/avatars';
import Avatar from './Avatar';

export default function AvatarPicker() {
  const { user, updateAvatar } = useAuth();
  const [draft, setDraft] = useState<AvatarSelection>(user?.avatar || { kind: 'initials' });
  const [category, setCategory] = useState('Cartoon');
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const generation = useRef(0);
  const choose = (value: AvatarSelection) => { ++generation.current; setDraft(value); setFile(null); setError(''); setNotice(''); };
  const save = async () => {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { const result = await updateAvatar(file || draft); setDraft(result); setFile(null); setNotice('Avatar saved. Your meeting participants will see the update.'); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not save the avatar. Try again.'); }
    finally { setBusy(false); }
  };
  const upload = async (value?: File) => {
    if (!value) return;
    const current = ++generation.current;
    setError(''); setNotice('');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(value.type) || value.size > 2 * 1024 * 1024 || !value.size) { setError('Choose a JPEG, PNG or WebP image under 2 MB.'); return; }
    const reader = new FileReader();
    reader.onload = () => { if (current === generation.current && typeof reader.result === 'string') { setFile(value); setDraft({ kind: 'upload' }); preview.current = reader.result; setNotice('Image ready to save.'); } };
    reader.onerror = () => setError('This image could not be read.'); reader.readAsDataURL(value);
  };
  const preview = useRef('');
  if (!user) return null;
  return <section className="talk-avatar-picker" aria-label="Choose your avatar"><h3>Your avatar</h3><p>Shown when your camera is off. Updates do not enable your camera.</p>
    <div className="talk-avatar-preview">{file ? <span className="talk-avatar"><img src={preview.current} alt="Selected upload preview" /></span> : <Avatar avatar={draft} name={user.name} />}<div><strong>{user.name}</strong><small>Preview</small></div></div>
    <div className="talk-avatar-basics"><button disabled={busy} aria-pressed={draft.kind === 'default'} onClick={() => choose({ kind: 'default' })}>Default</button><button disabled={busy} aria-pressed={draft.kind === 'initials'} onClick={() => choose({ kind: 'initials' })}>Initials</button></div>
    <div className="talk-avatar-categories" role="group" aria-label="Avatar styles">{avatarStyles.map(style => <button disabled={busy} key={style} aria-pressed={style === category} onClick={() => setCategory(style)}>{style}</button>)}</div>
    <div className="talk-avatar-presets" role="group" aria-label={`${category} avatars`}>{avatarPresets.filter(preset => preset.style === category).map(preset => <button key={preset.id} disabled={busy} aria-label={preset.name} aria-pressed={draft.kind === 'preset' && draft.presetId === preset.id} onClick={() => choose({ kind: 'preset', presetId: preset.id })}><Avatar name={preset.name} avatar={{ kind: 'preset', presetId: preset.id }} /></button>)}</div>
    <label className="talk-avatar-upload"><Upload size={16} />Upload picture<input type="file" aria-label="Upload profile picture" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={event => { void upload(event.target.files?.[0]); event.target.value = ''; }} /></label><p>Still JPEG, PNG or WebP · Up to 2 MB and 10 megapixels. Images are cropped to a square.</p>
    {error && <p role="alert" className="talk-avatar-error">{error}</p>}<p role="status">{notice}</p><button className="primary-button" disabled={busy} onClick={() => void save()}>{busy ? 'Saving avatar…' : 'Save avatar'}</button>
  </section>;
}
