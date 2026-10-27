import sharp from 'sharp';
import { chromium } from 'playwright';
import { closeRecordingBrowser } from './recording-recorder.mjs';
import { boardBounds, whiteboardTextLines } from '../../frontend/src/lib/whiteboardModel.js';
const escape = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function exportWhiteboardSvg(board) {
  const bounds=boardBounds(board.elements), images=new Map(board.images.map(image=>[image.id,{data:image.image_data,mime:image.exportPng?'image/png':'image/webp'}]));
  const scale=Math.min(1,4096/Math.max(bounds.width,bounds.height));
  const text=element=>`<defs><clipPath id="clip-${element.id}"><rect width="${element.width}" height="${element.height}"/></clipPath></defs><text clip-path="url(#clip-${element.id})" font-family="Arial, Noto Sans Devanagari, sans-serif" font-size="${element.fontSize}" fill="${element.stroke==='none'?'#172435':element.stroke}">${whiteboardTextLines(element).map((line,index)=>`<tspan x="8" y="${element.fontSize+8+index*element.fontSize*1.2}">${escape(line)}</tspan>`).join('')}</text>`;
  const content=board.elements.map(element=>{
    const e=element, common=`stroke="${e.stroke==='none'?'none':e.stroke}" stroke-width="${e.strokeWidth}" fill="${e.fill}" stroke-linecap="round" stroke-linejoin="round"`;
    let shape='';
    if(['pen','highlighter','line','arrow'].includes(e.type)) {
      const pts=e.points.length?e.points:[0,0,e.width,e.height];
      shape=`<polyline points="${pts.reduce((parts,point,index)=>parts+(index%2?',':' ')+point,'').trim()}" ${common.replace(/fill="[^"]*"/,'fill="none"')}/>`;
      if(e.type==='arrow'&&pts.length>=4){const x=pts.at(-2),y=pts.at(-1),angle=Math.atan2(y-pts.at(-3),x-pts.at(-4)),size=12;shape+=`<polygon points="${x},${y} ${x-size*Math.cos(angle-.5)},${y-size*Math.sin(angle-.5)} ${x-size*Math.cos(angle+.5)},${y-size*Math.sin(angle+.5)}" fill="${e.stroke}"/>`;}
    } else if(e.type==='ellipse')shape=`<ellipse cx="${e.width/2}" cy="${e.height/2}" rx="${e.width/2}" ry="${e.height/2}" ${common}/>`;
    else if(e.type==='image'){const image=images.get(e.imageId);shape=image?`<image href="data:${image.mime};base64,${image.data}" width="${e.width}" height="${e.height}" preserveAspectRatio="none"/>`:'';}
    else if(e.type==='text')shape=text(e);
    else {shape=`<rect width="${e.width}" height="${e.height}" rx="${e.type==='rounded'?16:e.type==='sticky'?4:0}" ${common}/>`;if(e.type==='sticky')shape+=text(e);}
    return `<g transform="translate(${e.x} ${e.y}) rotate(${e.rotation})" opacity="${e.opacity}">${shape}</g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(bounds.width*scale)}" height="${Math.ceil(bounds.height*scale)}" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}"><title>${escape(board.title)} · revision ${board.revision}</title><rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" fill="#fafafc"/>${content}</svg>`;
}
let exporting=false;
export async function renderWhiteboardExport(board,format) {
  if(exporting){const error=new Error('Another export is processing. Please try again shortly.');error.status=429;throw error;}
  exporting=true;let server,failed=false;
  try{
    // librsvg's embedded WebP support varies by platform. Embed normalized PNG
    // in every export so browser PDF and server PNG see the same private image.
    // Sequential conversion and bounded dimensions keep peak memory controlled.
    const used=new Set(board.elements.map(element=>element.imageId).filter(Boolean)),images=[];
    for(const image of board.images.filter(image=>used.has(image.id))){
      const source=Buffer.from(image.image_data,'base64');let png=await sharp(source).resize({width:1024,height:1024,fit:'inside',withoutEnlargement:true}).png().toBuffer();
      if(png.length>1024*1024)png=await sharp(source).resize({width:480,height:480,fit:'inside',withoutEnlargement:true}).png().toBuffer();
      images.push({id:image.id,image_data:png.toString('base64'),exportPng:true});
    }
    const svg=exportWhiteboardSvg({...board,images});
    if(format==='svg')return Buffer.from(svg);
    if(format==='png')return await sharp(Buffer.from(svg),{limitInputPixels:17000000}).png().toBuffer();
    server=await chromium.launchServer({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{channel:'chrome'}),chromiumSandbox:process.env.NODE_ENV==='production',headless:true,host:'127.0.0.1',timeout:20000});
    const browser=await chromium.connect(server.wsEndpoint(),{timeout:15000});
    const context=await browser.newContext({javaScriptEnabled:false});context.setDefaultTimeout(15000);await context.route('**/*',route=>route.abort());
    const page=await context.newPage();
    await page.setContent(`<!doctype html><meta charset="utf-8"><style>@page{size:A4 landscape;margin:8mm}body{margin:0}svg{width:100%;height:180mm;object-fit:contain}</style>${svg}`);
    return Buffer.from(await page.pdf({format:'A4',landscape:true,printBackground:true,timeout:25000}));
  }catch{failed=true;const error=new Error('Whiteboard export could not be generated. Try SVG or retry shortly.');error.status=503;throw error;}
  finally{try{await closeRecordingBrowser(server,{force:failed,closeMs:3000,killMs:2000});}finally{exporting=false;}}
}
