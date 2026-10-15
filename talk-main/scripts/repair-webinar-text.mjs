import fs from 'node:fs';
const file = 'src/pages/Webinar.tsx';
let source = fs.readFileSync(file, 'utf8');
source = source.replace(/const agenda = \[[\s\S]*?\n\];/, `const agenda = [
  ['🎶', 'Starting soon', '2 minutes', 'Turn up the volume and settle in while we wait for everyone to join.'],
  ['👋', 'Welcome', '2 minutes', 'Meet your host, Carla Kargaard, and find out what’s ahead.'],
  ['🎙️', 'Speakers intro', '5 minutes', 'Get to know the people behind the product and the community.'],
  ['🚀', 'From launch to $1M', '20 minutes', 'The lessons, experiments, and customer conversations behind the AppSumo launch.'],
  ['💬', 'Questions & answers', '10 minutes', 'Bring your questions and join the conversation.'],
];`);
source = source.replaceAll('\uFFFD"', '’');
fs.writeFileSync(file, source);
