import fs from 'node:fs/promises';
import {localSfu} from './helpers/local-sfu.mjs';
// Run the existing three-browser regression without touching the developer's
// SFU process/configuration. Test-only global consumed by the shared harness.
const sfu=await localSfu();
try{
  globalThis.__talkBrowserLivekitConfig=sfu.config;
  await import('./whiteboard-intelligence-browser.mjs');
  await fs.copyFile('artifacts/qa/phase10h-browser.json','artifacts/qa/phase10i-regression-browser.json');
}catch{console.error('Browser regression failed; raw request details withheld to protect fixture cookies.');process.exitCode=1;}
finally{delete globalThis.__talkBrowserLivekitConfig;await sfu.stop();}
