import {analysisText} from '../../frontend/src/lib/whiteboardIntelligence.js';
import {renderWhiteboardSummaryPdf} from './whiteboard-ai-exports.mjs';
export function mountWhiteboardAIRoutes({app,intelligence,meetingSession,write,safeAsync,rateLimited,fail}){
  if(!intelligence)return;
  const base='/api/auth/meetings/:meetingId/whiteboard/ai';
  const read=handler=>safeAsync(async(req,res)=>{const person=await meetingSession(req,res);if(!person)return;res.set('Cache-Control','no-store');if(await rateLimited(req,res,'whiteboard-ai-read',person.account_id,{email:180,ip:900,window:60000}))return;await handler(req,res,person);});
  app.get(base+'/capabilities',read(async(req,res,person)=>res.json(await intelligence.capabilities(req.params.meetingId,person))));
  app.get(base+'/jobs',read(async(req,res,person)=>res.json(await intelligence.list(req.params.meetingId,person))));
  app.get(base+'/jobs/:jobId',read(async(req,res,person)=>res.json(await intelligence.read(req.params.meetingId,person,req.params.jobId))));
  for(const action of ['preview','confirm','cancel'])app.post(base+'/cloud/'+action,...write(async(req,res,person)=>{
    if(await rateLimited(req,res,'whiteboard-cloud-consent',person.account_id,{email:30,ip:100,window:3600000}))return;
    const result=await intelligence.cloud[action](req.params.meetingId,person,req.body);
    res.status(action==='confirm'?202:200).json(action==='confirm'?await intelligence.read(req.params.meetingId,person,result.jobId):result);
  },'intelligence'));
  for(const operation of ['generate','summarize','cluster'])app.post(base+'/'+operation,...write(async(req,res,person)=>{
    if(await rateLimited(req,res,'whiteboard-ai-generate',person.account_id,{email:10,ip:50,window:3600000}))return;
    res.status(202).json(await intelligence.enqueue(req.params.meetingId,person,operation,req.body));
  },'intelligence'));
  for(const action of ['cancel','retry','review','delete'])app.post(base+'/jobs/:jobId/'+action,...write(async(req,res,person)=>res.json(await intelligence.change(req.params.meetingId,person,req.params.jobId,action,req.body)),'intelligence'));
  app.post(base+'/jobs/:jobId/apply',...write(async(req,res,person)=>res.json(await intelligence.apply(req.params.meetingId,person,req.params.jobId,req.body)),'intelligence'));
  app.get(base+'/jobs/:jobId/export/:format',read(async(req,res,person)=>{
    if(!['txt','pdf'].includes(req.params.format))return fail(res,400,'invalid_export','Choose TXT or PDF.');
    if(await rateLimited(req,res,'whiteboard-ai-export',person.account_id,{email:5,ip:20,window:60000}))return;
    const job=await intelligence.read(req.params.meetingId,person,req.params.jobId);
    if(job.result?.kind!=='analysis')return fail(res,409,'whiteboard_ai_not_ready','A completed analysis is required for this export.');
    const text=analysisText(job.result.analysis,job.review,job.sourceRevision);let bytes;
    try{bytes=req.params.format==='txt'?Buffer.from(text):await renderWhiteboardSummaryPdf(job.result.analysis.title,text);}
    catch(error){return fail(res,error.status===429?429:503,'whiteboard_ai_export_unavailable','The private PDF could not be prepared. Try TXT or retry shortly.');}
    if(!await meetingSession(req,res))return;await intelligence.read(req.params.meetingId,person,req.params.jobId);
    res.set({'Content-Disposition':`attachment; filename="talk-board-summary-r${job.sourceRevision}.${req.params.format}"`,'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}).type(req.params.format==='txt'?'text/plain; charset=utf-8':'application/pdf').send(bytes);
  }));
}
