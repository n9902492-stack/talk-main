import {chromium} from 'playwright';
import {closeRecordingBrowser} from './recording-recorder.mjs';
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let busy=false;
export async function renderWhiteboardSummaryPdf(title,text){
  if(busy)throw Object.assign(new Error('Another private export is processing. Please retry.'),{status:429});
  busy=true;let server,failed=false,timeout,expired=false;
  try{
    const launch=chromium.launchServer({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{channel:'chrome'}),host:'127.0.0.1',headless:true,chromiumSandbox:process.env.NODE_ENV==='production',timeout:20000});
    void launch.then(owned=>{if(expired)return closeRecordingBrowser(owned,{force:true});}).catch(()=>{});
    const rendering=(async()=>{server=await launch;const browser=await chromium.connect(server.wsEndpoint(),{timeout:15000});const context=await browser.newContext({javaScriptEnabled:false});await context.route('**/*',route=>route.abort());const page=await context.newPage();
      await page.setContent(`<!doctype html><meta charset="utf-8"><style>@page{size:A4;margin:18mm}body{font:11pt Arial,'Noto Sans Devanagari',sans-serif;color:#204563;line-height:1.5}h1{font-size:23pt}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>Talk · Whiteboard review</h1><h2>${escape(title)}</h2><pre>${escape(text)}</pre>`,{timeout:15000});
      return Buffer.from(await page.pdf({format:'A4',printBackground:true,timeout:20000}));})();
    return await Promise.race([rendering,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('Private summary export timed out.')),35000);})]);
  }catch{failed=true;throw Object.assign(new Error('Private summary PDF unavailable. Try TXT or retry shortly.'),{status:503});}
  finally{expired=true;clearTimeout(timeout);try{await closeRecordingBrowser(server,{force:failed,closeMs:3000,killMs:2000});}finally{busy=false;}}
}
