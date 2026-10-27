import express from 'express';
import { renderWhiteboardExport } from './whiteboard-exports.mjs';
export function mountWhiteboardRoutes({app,whiteboards,meetingSession,write,validOrigin,safeAsync,rateLimited,constantTimeEqual,fail}) {
  if(!whiteboards)return;
  const base='/api/auth/meetings/:meetingId/whiteboard';
  const read=handler=>safeAsync(async(req,res)=>{
    const session=await meetingSession(req,res);if(!session)return;
    res.set('Cache-Control','no-store');
    if(await rateLimited(req,res,'whiteboard-read',session.account_id,{email:180,ip:1800,window:60000}))return;
    await handler(req,res,session);
  });
  app.get(base,read(async(req,res,session)=>res.json({...await whiteboards.read(req.params.meetingId,session,req.query.since),csrfToken:session.csrf_token})));
  app.post(base+'/open',...write(async(req,res,session)=>res.json(await whiteboards.open(req.params.meetingId,session))));
  app.post(base+'/operations',...write(async(req,res,session)=>res.json(await whiteboards.operation(req.params.meetingId,session,req.body))));
  app.post(base+'/manage',...write(async(req,res,session)=>res.json(await whiteboards.manage(req.params.meetingId,session,req.body))));
  app.post(base+'/cursor',...write(async(req,res,session)=>res.json(await whiteboards.cursor(req.params.meetingId,session,req.body)),'cursor'));
  app.get(base+'/snapshots',read(async(req,res,session)=>res.json(await whiteboards.snapshots(req.params.meetingId,session))));
  const uploadGuard=safeAsync(async(req,res,next)=>{
    const session=await meetingSession(req,res);if(!session)return;
    if(!constantTimeEqual(req.get('X-CSRF-Token'),session.csrf_token))return fail(res,403,'invalid_session','Refresh Talk before uploading.');
    if(await rateLimited(req,res,'whiteboard-upload',session.account_id,{email:10,ip:50,window:60000}))return;
    req.whiteboardSession=session;next();
  });
  app.post(base+'/images',validOrigin,uploadGuard,express.raw({type:()=>true,limit:'2mb'}),safeAsync(async(req,res)=>res.status(201).json(await whiteboards.upload(req.params.meetingId,req.whiteboardSession,req.body,req.get('Content-Type')))));
  app.get(base+'/images/:imageId',read(async(req,res,session)=>res.type('webp').set({'Content-Security-Policy':"default-src 'none'",'X-Content-Type-Options':'nosniff'}).send(await whiteboards.image(req.params.meetingId,session,req.params.imageId))));
  app.get(base+'/export/:format',read(async(req,res,session)=>{
    if(!['svg','png','pdf'].includes(req.params.format))return fail(res,400,'invalid_export','Choose PNG, PDF or SVG.');
    if(await rateLimited(req,res,'whiteboard-export',session.account_id,{email:5,ip:20,window:60000}))return;
    const data=await whiteboards.exportData(req.params.meetingId,session);
    let bytes;try{bytes=await renderWhiteboardExport(data,req.params.format);}catch(error){return fail(res,error.status===429?429:503,'whiteboard_export_unavailable','Export is temporarily unavailable. Try SVG or retry shortly.');}
    // Recheck revocation/membership after asynchronous rendering.
    if(!await meetingSession(req,res))return;
    await whiteboards.exportData(req.params.meetingId,session);
    res.set({'Content-Disposition':`attachment; filename="talk-whiteboard-r${data.revision}.${req.params.format}"`,'Content-Security-Policy':"default-src 'none'; sandbox",'X-Content-Type-Options':'nosniff'}).type(req.params.format==='svg'?'image/svg+xml':req.params.format==='pdf'?'application/pdf':'image/png').send(bytes);
  }));
}
