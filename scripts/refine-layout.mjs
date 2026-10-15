import fs from 'node:fs';
const webinarPath = 'frontend/src/pages/Webinar.tsx';
let webinar = fs.readFileSync(webinarPath, 'utf8');
webinar = webinar.replace('<span className="banner-eyebrow">LEARN FROM OUR APPSUMO SUCCESS</span><span className="banner-brand">talk<span className="ml-2 font-normal text-xl">live</span></span><h1>How we hit $1M in sales<br />and Top 5 glory.</h1><div className="banner-caption"><span>Big lessons. Honest conversations.</span><span className="banner-dot" />One remarkable launch.</div>', '<span className="banner-eyebrow">Learn from our<br />AppSumo success</span><h1>How we hit $1M in sales and Top 5 glory</h1>');
fs.writeFileSync(webinarPath, webinar);
