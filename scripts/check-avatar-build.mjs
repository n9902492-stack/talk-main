// Compare sensitive backend settings privately; report only aggregate checks.
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'dotenv';
const env = {};
for (const file of ['.env','.env.local','.env.production']) if(fs.existsSync(file))Object.assign(env,parse(fs.readFileSync(file)));
const scripts=fs.readdirSync('frontend/dist/assets').filter(file=>file.endsWith('.js')).map(file=>fs.readFileSync(path.join('frontend/dist/assets',file),'utf8')).join('\n');
const sensitive=Object.entries(env).filter(([key,value])=> /SMTP_PASSWORD|AUTH_COOKIE_SECRET|LIVEKIT_API_SECRET|PGPASSWORD|PRIVATE_KEY/.test(key)&&value.length>=12);
const exposed=sensitive.some(([,value])=>scripts.includes(value));
// Background controls now extend pre-join deliberately. Its functional
// preservation is verified by tests/meetings-browser.mjs, not obsolete hashes.
if(exposed)throw new Error('Build privacy check failed. Values withheld.');
console.log('PASS: no configured backend secrets detected in built JavaScript.');
