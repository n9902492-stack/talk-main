import fs from 'node:fs/promises';
const files = ['src/design/landing.html', 'src/design/footer.html'];
const html = await Promise.all(files.map(file => fs.readFile(file, 'utf8')));
const urls = [...new Set(html.flatMap(source => [...source.matchAll(/src="(https:\/\/lh3\.googleusercontent\.com\/[^"\s]+)"/g)].map(match => match[1])))];
await fs.mkdir('public/assets/stitch', { recursive: true });
const mapping = new Map();
let index = 0;
async function worker() {
  while (index < urls.length) {
    const position = index++;
    const url = urls[position];
    const path = `/assets/stitch/image-${String(position + 1).padStart(2, '0')}.jpg`;
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Image ${position + 1}: HTTP ${response.status}`);
    await fs.writeFile('public' + path, Buffer.from(await response.arrayBuffer()));
    mapping.set(url, path);
    console.log(`Cached image ${position + 1}/${urls.length}`);
  }
}
await Promise.all(Array.from({ length: Math.min(4, urls.length) }, worker));
for (let i = 0; i < files.length; i++) {
  let source = html[i];
  for (const [url, path] of mapping) source = source.replaceAll(url, path);
  await fs.writeFile(files[i], source);
}
if (mapping.size) await fs.writeFile('references/stitch/asset-map.json', JSON.stringify(Object.fromEntries(mapping), null, 2));
console.log('Stitch images are now served locally.');

// Cache the design fonts so typography and icon ligatures work offline.
const fontUrl = 'https://fonts.googleapis.com/css2?family=Caveat:wght@600;700&family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&family=Plus+Jakarta+Sans:ital,wght@0,300..800;1,300..800&family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0&display=swap';
const fontResponse = await fetch(fontUrl, { headers: { 'User-Agent': 'Mozilla/5.0 Chrome/131.0.0.0 Safari/537.36' }, signal: AbortSignal.timeout(30000) });
if (!fontResponse.ok) throw new Error(`Font CSS: ${fontResponse.status}`);
let css = await fontResponse.text();
const fontSources = [...new Set([...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map(match => match[1]))];
await fs.mkdir('public/fonts', { recursive: true });
let fontIndex = 0;
async function fontWorker() {
  while (fontIndex < fontSources.length) {
    const position = fontIndex++;
    const url = fontSources[position];
    const extension = new URL(url).pathname.split('.').pop();
    const path = `/fonts/font-${position + 1}.${extension}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Font ${position + 1}: ${response.status}`);
    await fs.writeFile('public' + path, Buffer.from(await response.arrayBuffer()));
    css = css.replaceAll(url, path);
  }
}
await Promise.all(Array.from({ length: 4 }, fontWorker));
await fs.writeFile('public/fonts/fonts.css', css);
console.log(`Cached ${fontSources.length} font files, including the Stitch icons.`);
