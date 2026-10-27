import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

export const windowsCloudflaredPath = 'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe';

// Probe the installed client only. This module never starts a tunnel or service.
export function checkCloudflaredClient() {
  let executable;
  if (process.platform === 'win32' && existsSync(windowsCloudflaredPath)) executable = windowsCloudflaredPath;
  else {
    const found = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', ['cloudflared'],
      { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    const first = found.status === 0 && found.stdout?.split(/\r?\n/).find(value => value.trim());
    if (first && path.isAbsolute(first.trim()) && existsSync(first.trim())) executable = first.trim();
  }
  if (!executable) return { status: 'NOT_FOUND' };
  const result = spawnSync(executable, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  const version = result.status === 0 && /^cloudflared version (\d{4}\.\d{1,2}\.\d+)\b/m.exec(result.stdout || '');
  // Raw stdout/stderr and child errors are intentionally not returned.
  return version ? { status: 'VERIFIED', executable, version: version[1] } : { status: 'VERSION_CHECK_FAILED', executable };
}
