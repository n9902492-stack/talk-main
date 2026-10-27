import { chromium } from 'playwright';
import { closeRecordingBrowser } from './recording-recorder.mjs';
async function deadline(operation, milliseconds) {
  let timer;
  try { return await Promise.race([operation, new Promise((_, reject) => { timer=setTimeout(()=>reject(new Error('Transcript export timed out.')),milliseconds); })]); }
  finally { clearTimeout(timer); }
}
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
export const transcriptTime = value => { const seconds = Math.floor(Math.max(0, value)); return [Math.floor(seconds / 3600), Math.floor(seconds % 3600 / 60), seconds % 60].map(part => String(part).padStart(2, '0')).join(':'); };
export function exportTranscriptText({ title, segments, language }) { return `Talk — ${title}\nLanguage: ${language || 'undetermined'}\nSpeaker identity is unattributed unless explicitly supplied by a reliable source.\n\n` + segments.map(s => `[${transcriptTime(s.start)} – ${transcriptTime(s.end)}] ${s.speaker || 'Unattributed speaker'}\n${s.text}\n`).join('\n'); }
export async function exportTranscriptPdf({ title, segments, language }, env = process.env, { browserType=chromium, timeouts={} } = {}) {
  const limits={launch:20000,operation:15000,render:30000,close:3000,kill:2000,...timeouts};
  let server,expired=false,failed=false;
  try {
    // Own the Chromium process so a stuck PDF renderer can be terminated rather
    // than leaving an unbounded browser.close() in a finished HTTP request.
    const launching=browserType.launchServer({ ...(env.CHROMIUM_PATH ? { executablePath: env.CHROMIUM_PATH } : { channel: 'chrome' }), host:'127.0.0.1',headless:true,chromiumSandbox:env.NODE_ENV==='production',timeout:limits.launch });
    void launching.then(owned=>{if(expired)return closeRecordingBrowser(owned,{force:true,killMs:limits.kill});}).catch(()=>{});
    server=await deadline(launching,limits.launch);
    const browser=await deadline(browserType.connect(server.wsEndpoint(),{timeout:limits.operation}),limits.operation);
    const render=(async()=>{
    const context = await browser.newContext({ javaScriptEnabled: false });context.setDefaultTimeout(limits.operation); await context.route('**/*', route => route.abort()); const page = await context.newPage();
    await page.setContent(`<!doctype html><meta charset="utf-8"><style>@page{size:A4;margin:20mm}body{color:#1c1c1c;font:11pt Arial,'Noto Sans Devanagari',sans-serif;line-height:1.6}h1{font-size:23pt;color:#0877c9}small{color:#737373}article{break-inside:avoid;margin:16pt 0}p{white-space:pre-wrap;overflow-wrap:anywhere;margin:5pt 0}</style><h1>Talk · Meeting transcript</h1><h2>${escape(title)}</h2><small>Language: ${escape(language || 'undetermined')} · Speakers are unattributed unless reliably identified.</small>${segments.map(s => `<article><strong>${transcriptTime(s.start)} – ${transcriptTime(s.end)} · ${escape(s.speaker || 'Unattributed speaker')}</strong><p>${escape(s.text)}</p></article>`).join('')}`);
    // Resolve to a primitive: FontFaceSet itself is not a serializable result.
    await page.evaluate(async () => { await document.fonts.ready; return true; });
    return Buffer.from(await page.pdf({ format: 'A4', printBackground: true, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: '<div style="font-size:9px;text-align:center;width:100%">Talk · Private transcript · <span class="pageNumber"></span></div>' }));
    })();
    return await deadline(render,limits.render);
  } catch { failed=true;throw new Error('The private transcript PDF could not be generated. Please try again.'); }
  finally { expired=true;await closeRecordingBrowser(server,{force:failed,closeMs:limits.close,killMs:limits.kill}); }
}
