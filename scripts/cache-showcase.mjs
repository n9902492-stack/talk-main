import fs from 'node:fs/promises';

const file = 'frontend/src/design/landing.html';
const html = await fs.readFile(file, 'utf8');
const url = html.match(/<img[^>]*alt="A modern collaborative online whiteboard[^>]*src="([^"]+)"/)?.[1];
if (!url?.startsWith('https://')) process.exit(0);
const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
if (!response.ok) throw new Error(`Showcase image: HTTP ${response.status}`);
const path = '/assets/stitch/whiteboard-showcase.jpg';
await fs.writeFile('public' + path, Buffer.from(await response.arrayBuffer()));
const mappingFile = 'references/stitch/asset-map.json';
const mapping = JSON.parse(await fs.readFile(mappingFile, 'utf8'));
mapping[url] = path;
await fs.writeFile(mappingFile, JSON.stringify(mapping, null, 2));
await fs.writeFile(file, html.replaceAll(url, path));
console.log('Original Stitch showcase image cached locally.');
