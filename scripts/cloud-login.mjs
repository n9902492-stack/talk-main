import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const sdk = process.env.GCLOUD_SDK_ROOT || path.join(root, 'artifacts/qa/cloud-tools/google-cloud-sdk');
const python = path.join(sdk, 'platform/bundledpython/python.exe');
const script = path.join(sdk, 'lib/gcloud.py');
if (process.platform === 'win32' && (!existsSync(python) || !existsSync(script))) {
  console.error('Google Cloud CLI is missing. Install the official CLI, then set GCLOUD_SDK_ROOT to its google-cloud-sdk folder. See deployment/APPROVAL.md.');
  process.exitCode = 1;
} else {
  console.log('Sign in to the Google account that owns talk-fc3dc in the browser. Do not paste tokens or authorization codes into chat.');
  console.log('This command only signs in the local CLI. It does not create resources, deploy Talk or send SMS.');
  const result = spawnSync(process.platform === 'win32' ? python : 'gcloud',
    [...(process.platform === 'win32' ? [script] : []), 'auth', 'login'], {
      cwd: root, stdio: 'inherit', windowsHide: true,
      env: { ...process.env, CLOUDSDK_CONFIG: path.join(root, 'artifacts/qa/gcloud-config'), CLOUDSDK_CORE_DISABLE_USAGE_REPORTING: '1' },
    });
  process.exitCode = result.status ?? 1;
}
