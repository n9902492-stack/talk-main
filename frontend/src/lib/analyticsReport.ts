export type AnalyticsMetric={title:string;description:string;value:number;change?:string;scope?:string};
/** Download a local report without uploading workspace data. */
export async function downloadAnalyticsReport(metrics:AnalyticsMetric[],source:string){
 await document.fonts.ready;
 const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;
 const ctx=canvas.getContext('2d');if(!ctx)throw new Error('PNG export is not available in this browser.');
 const box=(x:number,y:number,w:number,h:number,fill:string,r=18)=>{ctx.fillStyle=fill;ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill();};
 const text=(v:string,x:number,y:number,size:number,color='#171c24',weight=400)=>{ctx.font=`${weight} ${size}px Inter, sans-serif`;ctx.fillStyle=color;ctx.fillText(v,x,y);};
 box(0,0,1920,1080,'#f5f5f5',0);box(0,0,1920,72,'#fff',0);box(48,18,36,36,'#1679c4',12);text('T',59,44,22,'#fff',700);text('Talk',96,46,28,'#171c24',700);text('My workspace / Analytics',260,44,18,'#667085');
 text('Analytics',80,140,36,'#171c24',700);text(source,80,174,18,'#667085');box(80,206,1760,242,'#eef6fd');text('SMART SCHEDULING INSIGHTS',112,249,14,'#1679c4',700);text('Use analytics to improve scheduling',112,301,32,'#171c24',700);text('See booking activity and peak times to plan your next great conversation.',112,341,19,'#667085');
 [62,102,146,88,122,74,154].forEach((h,i)=>box(1392+i*47,410-h,28,h,i%2?'#badcf9':'#d5eaff',5));
 metrics.forEach((m,i)=>{const x=80+(i%2)*890,y=478+Math.floor(i/2)*170;box(x,y,870,150,'#fff');text(m.title,x+24,y+35,19,'#171c24',600);text(m.description,x+24,y+63,15,'#667085');text(String(m.value),x+24,y+122,36,'#171c24',700);text(m.change||m.scope||'All time',x+710,y+120,16,m.change?.startsWith('-')?'#e11d48':'#1679c4',600);});
 text('Talk Analytics · '+new Date().toLocaleString(),80,1040,15,'#667085');
 const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Could not create your PNG report.')),'image/png'));
 const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`Talk_Analytics_${source.startsWith('Sample')?'Sample':'Workspace'}_${new Date().toISOString().slice(0,10)}.png`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
