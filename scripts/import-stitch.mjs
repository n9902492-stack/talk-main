import fs from 'node:fs';

// Import the supplied markup as design data; do not execute its scripts.
const source = fs.readFileSync('references/stitch/code.html', 'utf8');
const design = fs.readFileSync('references/stitch/DESIGN.md', 'utf8');
fs.mkdirSync('frontend/src/design', { recursive: true });
let main = source.match(/<main\b[^>]*>([\s\S]*?)<\/main>/)[1];
let footer = source.match(/<footer\b[\s\S]*?<\/footer>/)[0];
main = main.replace(/<script\b[\s\S]*?<\/script>/gi, '');
main = main.replace(/data-alt=/g, 'alt=');
footer = footer.replace('class="w-full ', 'class="skin-footer w-full ');
// Use white landing backgrounds and the same content gutters as the webinar page.
main = main.replace('bg-gradient-to-b from-[#FFF7D6] via-[#FFFBF0] to-surface', 'bg-white')
  .replace('bg-gradient-to-b from-surface to-[#FFF3CA]', 'bg-white')
  .replace(/<!-- Ambient luminous background blobs -->\s*(?:<div class="pointer-events-none absolute[^\"]*"><\/div>\s*){2}/, '')
  .replace(/<div class="pointer-events-none absolute -bottom-24[^\"]*"><\/div>/, '')
  .replaceAll('max-w-7xl mx-auto px-6 lg:px-12', 'page-width');
footer = footer.replace(' shadow-[0_-1px_8px_rgba(0,0,0,0.02)]', '')
  .replace('max-w-7xl mx-auto px-6 lg:px-12', 'page-width');
main = main.replace('Host video experiences people ', 'Run online meetings and webinars ')
  .replace('actually remember</span>', 'like a pro</span>')
  .replace('The modern all-in-one platform for high-impact webinars, customer onboarding, interactive sales demos, and collaborative workshops.', 'The platform for stand-out customer-facing sessions: webinars, workshops and demos.')
  .replace('Book an interactive demo', 'Get a live demo')
  .replace('Trusted by over 32,000 forward-thinking teams worldwide', 'Trusted by industry giants worldwide')
  .replace('High-Converting Webinars', 'Interactive Webinars')
  .replace('Ready to elevate every conversation?', 'Ready to transform your meetings?');

// The feature strip is an interactive React island; preserve the Stitch stage around it.
const stripStart = main.indexOf('<!-- Feature Interactive Quick-Bar -->');
const stripEnd = main.indexOf('<!-- Realistic Meeting Showcase Mockup Container -->');
main = main.slice(0, stripStart) + '<div id="feature-tabs" class="mt-14 w-full max-w-4xl"></div>\n' + main.slice(stripEnd);
main = main.replace('<div class="w-full max-w-6xl mt-12', '<div id="meeting-showcase" class="w-full max-w-6xl mt-12');
// Play a related collaboration demo inside the original Stitch meeting stage.
main = main.replace(/<img\b[^>]*alt="A modern collaborative online whiteboard[^>]*>/,
  '<video id="hero-whiteboard-video" class="hero-whiteboard-video" src="/reference/whiteboard-showcase.mp4" poster="/reference/whiteboard-showcase.jpg" autoplay muted loop playsinline preload="metadata" aria-label="Collaborative whiteboard demonstration with four teammates"></video>');
main = main.replace('<div class="relative w-full h-[320px]', '<div class="hero-whiteboard-stage relative w-full h-[320px]');
main = main.replace(/(<video id="hero-whiteboard-video"[^>]*><\/video>\s*)<div class="relative z-10 flex items-center justify-between">/,
  '$1<div class="hero-whiteboard-caption relative z-10 flex items-center justify-between">');
// Replace the preview microphone and camera buttons with a video playback toggle.
main = main.replace(/(<!-- Bottom Floating Control Dock -->\s*)<div[^>]*>[\s\S]*?(?=<!-- Central Core Dock -->)/,
  `$1<div id="hero-control-dock" class="h-16 bg-[#1A1A1A] px-4 flex items-center justify-between border-t border-white/5">
<div class="flex items-center gap-2">
<button id="hero-preview-toggle" type="button" class="hero-preview-toggle" aria-label="Pause whiteboard video">
<span class="material-symbols-outlined text-[20px]" aria-hidden="true">pause</span>
<span data-playback-label>Pause video</span>
</button>
</div>
`);
main = main.replace('animate-bounce', 'recording-offer');
// Replace the two use-case stills with related, locally rendered demonstration videos.
main = main.replace(/<img\b[^>]*alt="A clean SaaS user interface mockup[^>]*>/,
  '<video id="sandbox-demo-video" class="usecase-video" src="/reference/sandbox-showcase.mp4" poster="/reference/sandbox-showcase.jpg" autoplay muted loop playsinline controls preload="metadata" aria-label="Interactive product sandbox demonstration"></video>');
main = main.replace(/<img\b[^>]*alt="Online webinar keynote presentation[^>]*>/,
  '<video id="broadcast-demo-video" class="usecase-video" src="/reference/broadcast-showcase.mp4" poster="/reference/broadcast-showcase.jpg" autoplay muted loop playsinline controls preload="metadata" aria-label="Studio broadcast demonstration with presentation, Q&A, and a sample offer"></video>');
main = main.replace('<div class="relative h-48 rounded-xl overflow-hidden bg-surface-container">',
  '<div class="usecase-video-frame rounded-xl overflow-hidden bg-surface-container">');
main = main.replace('<div class="relative h-48 rounded-xl overflow-hidden bg-surface-container flex items-center justify-center">',
  '<div class="usecase-video-frame rounded-xl overflow-hidden bg-surface-container">');
main = main.replace(/<div class="absolute top-3 left-3 bg-inverse-surface[^\"]*">\s*Participant: Jordyn is interacting live\s*<\/div>/, '');
main = main.replace(/<div class="absolute bottom-3 right-3 bg-surface-container-lowest\/95[^\"]*">[\s\S]*?Flash Offer: \$99 Pass<\/span>\s*<\/div>/, '');
// Show the supplied recording's workspace-branding demo in place of the settings mockup.
main = main.replace(/<!-- Left: Workspace Settings UI Mockup -->[\s\S]*?(?=<!-- Right: Text Overview -->)/,
  `<div class="lg:col-span-7 order-2 lg:order-1">
<div class="workspace-demo rounded-3xl bg-surface-container-low p-4 sm:p-6 shadow-sm">
<div class="flex items-center gap-3 pb-4">
<div class="w-9 h-9 rounded-xl bg-primary flex items-center justify-center text-on-primary font-bold shrink-0">T</div>
<div><h4 class="font-title-md text-title-md font-bold text-on-surface">Talk Workspace Settings</h4>
<p class="font-label-sm text-label-sm text-secondary">Custom branding in action</p></div>
</div>
<video id="workspace-branding-video" class="w-full rounded-2xl bg-surface-container-lowest" src="/reference/workspaces-preview.mp4?v=cursor-clean-1" poster="/reference/workspaces-poster.jpg?v=cursor-clean-1" autoplay muted loop playsinline controls preload="metadata" aria-label="Workspace branding demonstration"></video>
</div>
</div>
`);
// Orbit the community emojis while counter-rotating their cards to keep them upright.
const communityEmojis = ['🎉', '🚀', '💡', '🙌', '❤️', '✨'];
main = main.replace(/<!-- Orbiting 3D\/Emoji Avatars -->\s*(?:<div class="absolute[^\"]*">[\s\S]*?<\/div>\s*){6}/,
  `<div class="community-orbit" aria-hidden="true">${communityEmojis.map((emoji, index) =>
    `<div class="community-orbit-arm" style="--orbit-angle: ${index * 60}deg"><div class="community-orbit-avatar rounded-full bg-surface-container-lowest shadow-md flex items-center justify-center text-3xl">${emoji}</div></div>`
  ).join('')}</div>\n`);
// A second React island uses the same split composition as the recorded feature tour.
const trustEnd = main.indexOf('<!-- 3. ');
const sectionEnd = main.lastIndexOf('<!-- ========================================== -->', trustEnd);
main = main.slice(0, sectionEnd) + '<div id="platform-tour"></div>\n' + main.slice(sectionEnd);
const ids = ['hero', 'trust', 'features-overview', 'interactivity', 'workspaces', 'integrations', 'security', 'wall-of-love', 'community', 'pricing'];
let index = 0;
main = main.replace(/<section\b([^>]*)>/g, (match, attributes) => {
  const id = ids[index++];
  return /\bid=/.test(attributes) ? match : `<section id="${id}"${attributes}>`;
});
// Replace dead placeholder destinations with local, reviewable flows.
function linkTargets(html) {
  return html.replace(/<a\b([^>]*)href="#"([^>]*)>([\s\S]*?)<\/a>/g, (all, before, after, content) => {
    const text = content.replace(/<[^>]+>/g, '').trim();
    const path = (before + after).match(/data-path="([^"]+)"/)?.[1];
    let target = '#features-overview';
    if (/Webinar/.test(text)) target = '/webinars';
    else if (/Video Meetings|Log in/.test(text)) target = '/device-test';
    else if (/Get started|Sign up/.test(text)) target = '/device-test';
    else if (/demo/i.test(text) || path === 'request-demo') target = '/bookings';
    else if (path === 'pricing') target = '#pricing';
    else if (path === 'resources' || path === 'referral-program') target = '#community';
    else if (/privacy|terms/.test(path || '')) target = '#security';
    else if (path === 'home') target = '/';
    else if (/Integrations/.test(text)) target = '#integrations';
    return `<a${before}href="${target}"${after}>${content}</a>`;
  });
}
main = linkTargets(main);
footer = linkTargets(footer).replace('© 2025', '© 2026');
if (fs.existsSync('references/stitch/asset-map.json')) {
  for (const [url, path] of Object.entries(JSON.parse(fs.readFileSync('references/stitch/asset-map.json', 'utf8')))) {
    main = main.replaceAll(url, path);
    footer = footer.replaceAll(url, path);
  }
}
fs.writeFileSync('frontend/src/design/landing.html', main);
fs.writeFileSync('frontend/src/design/footer.html', footer);

const colors = [...design.matchAll(/^  ([a-z-]+): '(#[0-9a-f]+)'$/gm)];
let theme = '@theme {\n' + colors.map(([, name, value]) => `  --color-${name}: ${value};`).join('\n');
const sizes = {
  'display-xl': [64, 72, '-0.03em'], 'display-xl-mobile': [40, 48, '-0.025em'],
  'headline-lg': [44, 52, '-0.025em'], 'headline-lg-mobile': [32, 40, '-0.02em'],
  'headline-md': [32, 40, '-0.02em'], 'headline-sm': [24, 32, '-0.015em'],
  'title-lg': [20, 28, '-0.01em'], 'title-md': [18, 26, '-0.005em'],
  'body-lg': [18, 28, '-0.005em'], 'body-md': [16, 24, '0em'], 'body-sm': [14, 20, '0em'],
  'label-lg': [14, 20, '0.01em'], 'label-md': [12, 16, '0.02em'], 'label-sm': [11, 14, '0.04em'],
};
for (const [name, [size, line, tracking]] of Object.entries(sizes)) {
  theme += `\n  --font-${name}: ${/body|label/.test(name) ? "'Inter'" : "'Plus Jakarta Sans'"}, sans-serif;`;
  theme += `\n  --text-${name}: ${size}px;\n  --text-${name}--line-height: ${line}px;\n  --text-${name}--letter-spacing: ${tracking};`;
}
for (const [name, value] of Object.entries({ 'space-xs': '.25rem', 'space-sm': '.5rem', 'space-md': '1rem', 'space-lg': '1.5rem', 'space-xl': '2.5rem', 'space-2xl': '4rem' })) {
  theme += `\n  --spacing-${name}: ${value};`;
}
theme += '\n}\n';
fs.writeFileSync('frontend/src/design/tokens.css', theme);
console.log('Imported Stitch layout, footer, and original palette.');
