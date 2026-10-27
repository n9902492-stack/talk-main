import sharp from 'sharp';
import { avatarPresets } from '../../frontend/src/lib/avatarCatalog.js';
export const avatarMaxBytes = 2 * 1024 * 1024;
export const avatarDescriptor = row => row ? {
  kind: row.kind, version: row.version,
  ...(row.kind === 'preset' ? { presetId: row.preset_id } : {}),
  ...(row.kind === 'upload' ? { imageUrl: `/api/auth/avatars/${encodeURIComponent(row.account_id)}/image?v=${encodeURIComponent(row.version)}` } : {}),
} : { kind: 'initials' };
export const validAvatarChoice = value => value && ['default', 'initials', 'preset'].includes(value.kind)
  && (value.kind !== 'preset' || avatarPresets.some(preset => preset.id === value.presetId));
export async function normalizeProfileImage(bytes, mime, { width = 512, height = 512, fit = 'cover', maxOutput = 256 * 1024 } = {}) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > avatarMaxBytes) throw new Error('Invalid image size');
  const format = mime === 'image/png' && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'png'
    : mime === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'jpeg'
    : mime === 'image/webp' && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' ? 'webp' : null;
  if (!format) throw new Error('Unsupported image');
  const image = sharp(bytes, { limitInputPixels: 10000000, failOn: 'warning' });
  const meta = await image.metadata();
  if (meta.format !== format || (meta.pages || 1) > 1 || !meta.width || !meta.height) throw new Error('Unsupported image');
  // Re-encoding strips source metadata and prevents serving user-supplied active content.
  const clean = await image.rotate().resize(width, height, { fit, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
  if (clean.length > maxOutput) throw new Error('Image too complex');
  return clean.toString('base64');
}
export const normalizeAvatar = (bytes, mime) => normalizeProfileImage(bytes, mime);
export const normalizeBackgroundImage = (bytes, mime) => normalizeProfileImage(bytes, mime, { width: 1920, height: 1080, fit: 'inside', maxOutput: 1024 * 1024 });
