import { useState } from 'react';
import { UserRound } from 'lucide-react';
import { avatarPresets } from '../lib/avatarCatalog';
import { avatarInitials, type AvatarSelection } from '../lib/avatars';
import '../styles/avatars.css';

// Static renderer: media acquisition and future tracking adapters stay separate.
export default function Avatar({ avatar, name, className = '' }: { avatar?: AvatarSelection; name: string; className?: string }) {
  const [failed, setFailed] = useState('');
  const preset = avatar?.kind === 'preset' ? avatarPresets.find(item => item.id === avatar.presetId) : undefined;
  const image = preset?.src || (avatar?.kind === 'upload' && avatar.imageUrl?.startsWith('/api/auth/avatars/') ? avatar.imageUrl : '');
  return <span className={`talk-avatar ${className}`} data-avatar-kind={avatar?.kind || 'initials'} data-avatar-preset={preset?.id} aria-label={`${name} avatar`} role="img">
    {image && failed !== image ? <img src={image} alt="" onError={() => setFailed(image)} /> : avatar?.kind === 'default' ? <UserRound aria-hidden="true" /> : <span aria-hidden="true">{avatarInitials(name)}</span>}
  </span>;
}
