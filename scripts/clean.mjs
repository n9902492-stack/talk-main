import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Only generated frontend output is removed; sources and account data stay intact.
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.resolve(root, 'frontend/dist');
if (!output.startsWith(path.resolve(root) + path.sep)) throw new Error('Build output escaped the workspace.');
await rm(output, { recursive: true, force: true });
console.log('Frontend build output removed.');
