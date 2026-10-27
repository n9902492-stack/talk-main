import {randomUUID} from 'node:crypto';

// Reset credentials have their own cookie/table and can never verify signup,
// link providers, or create a Talk login session.
export function mountPasswordReset({app,db,now,token,digest,cookieHash,cookieOptions,hashSecret,verifySecret,normalizedEmail,validPassword,generateCode,emailMailer,
  validOrigin,requireJson,json,publicCsrf,safeAsync,constantTimeEqual,rateLimited,fail}) {
  const cookie='talk_password_reset',base='/api/auth/email/password-reset',ttl=300000,flowTtl=1800000;
  const get=(sql,...values)=>db.prepare(sql).get(...values),run=(sql,...values)=>db.prepare(sql).run(...values);
  let stopped=false,working=false;
  const timers=new Set();
  const pending=req=>{const key=cookieHash(req,cookie);return key?get("SELECT * FROM password_reset_challenges WHERE token_hash=? AND flow_expires_at>? AND state!='used'",key,now()):null;};
  const state=row=>({reset:row?{email:row.email,verified:row.state==='verified',expiresAt:row.expires_at,resendAt:row.resend_at,attemptsRemaining:Math.max(0,5-row.attempts)}:null,csrfToken:row?.csrf_token||null,serverTime:now()});
  async function transaction(email,operation){await db.exec('BEGIN IMMEDIATE');try{await db.lockIdentity(`password:${email}`);const result=await operation();await db.exec('COMMIT');return result;}catch(error){await db.exec('ROLLBACK');throw error;}}
  async function deliverOne(){
    const claim=token(),row=await get("UPDATE password_reset_challenges SET state='sending',claim_id=?,claimed_at=?,deliveries=deliveries+1 WHERE id=(SELECT id FROM password_reset_challenges WHERE expires_at>? AND deliveries<2 AND (state='queued' OR state='sending' AND claimed_at<?) ORDER BY created_at LIMIT 1) AND (state='queued' OR state='sending' AND claimed_at<?) RETURNING *",claim,now(),now(),now()-90000,now()-90000);
    if(!row)return false;
    try{
      const code=generateCode();if(typeof code!=='string'||!/^\d{6}$/.test(code))throw new Error('Invalid reset generator.');
      const hash=await hashSecret(`reset:${row.id}:${claim}:${code}`);
      if(!(await run("UPDATE password_reset_challenges SET code_hash=? WHERE id=? AND claim_id=? AND state='sending'",hash,row.id,claim)).changes)return true;
      if(row.account_id){
        const identity=await get("SELECT password_hash,verified_at FROM identities WHERE provider='password' AND provider_id=? AND account_id=?",row.email,row.account_id);
        if(!identity?.verified_at||digest(identity.password_hash)!==row.password_version)throw new Error('Reset identity changed.');
        await emailMailer.sendVerification({to:row.email,code,expiresAt:new Date(row.expires_at),purpose:'password-reset'});
      }
      await run("UPDATE password_reset_challenges SET state='active' WHERE id=? AND claim_id=? AND state='sending'",row.id,claim);
    }catch{await run("UPDATE password_reset_challenges SET state='failed',code_hash=NULL WHERE id=? AND claim_id=? AND state='sending'",row.id,claim);}
    return true;
  }
  async function tick(){if(working||stopped)return;working=true;try{await db.withContext(async()=>{await run('DELETE FROM password_reset_challenges WHERE flow_expires_at<=?',now());for(let i=0;i<8&&!stopped;i++)if(!await deliverOne())break;});}catch{/* Never log a code, password, recipient or transport error. */}finally{working=false;}}
  // Persisted queued jobs resume after a process restart. One claimed delivery
  // at a time; stale claims may retry once with a newly generated code/hash.
  const interval=setInterval(()=>void tick(),1000);interval.unref();timers.add(interval);
  const wake=()=>{const timer=setTimeout(()=>{timers.delete(timer);void tick();},0);timer.unref();timers.add(timer);};
  const guard=safeAsync(async(req,res,next)=>{const row=await pending(req);if(!row||!constantTimeEqual(req.get('X-CSRF-Token'),row.csrf_token))return fail(res,403,'reset_expired','This reset session expired. Request a new code.');req.passwordReset=row;next();});
  const write=handler=>[validOrigin,requireJson,json,guard,safeAsync(handler)];
  async function start(req,res,email){
    if(!email)return fail(res,400,'invalid_email','Enter a valid email address.');
    if(!emailMailer.configured||typeof emailMailer.sendVerification!=='function')return fail(res,503,'email_not_configured','Email delivery is temporarily unavailable. Please try again later.');
    if(await rateLimited(req,res,'password-reset-send',email,{email:5,ip:30,window:3600000}))return;
    let row;
    await transaction(email,async()=>{
      const latest=await get('SELECT MAX(resend_at) AS resend_at FROM password_reset_challenges WHERE email=?',email);
      if(latest?.resend_at>now()){const retryAfter=Math.ceil((latest.resend_at-now())/1000);res.set('Retry-After',String(retryAfter));fail(res,429,'resend_cooldown','Please wait before requesting another code.',{retryAfter});return;}
      const count=await get('SELECT COUNT(*) AS n FROM password_reset_challenges WHERE flow_expires_at>?',now());if(Number(count.n)>=4000){fail(res,429,'rate_limited','Please try again later.');return;}
      const identity=await get("SELECT * FROM identities WHERE provider='password' AND provider_id=? AND verified_at IS NOT NULL",email);
      const old=cookieHash(req,cookie);if(old)await run("UPDATE password_reset_challenges SET state='used',code_hash=NULL WHERE token_hash=?",old);
      await run("UPDATE password_reset_challenges SET state='used',code_hash=NULL WHERE email=? AND state!='used'",email);
      const key=token(),id=randomUUID();
      await run("INSERT INTO password_reset_challenges(id,token_hash,account_id,email,password_version,csrf_token,state,expires_at,resend_at,created_at,flow_expires_at) VALUES (?,?,?,?,?,?,'queued',?,?,?,?)",id,digest(key),identity?.account_id||null,email,identity?digest(identity.password_hash):null,token(),now()+ttl,now()+60000,now(),now()+flowTtl);
      res.cookie(cookie,key,{...cookieOptions,maxAge:flowTtl});row=await get('SELECT * FROM password_reset_challenges WHERE id=?',id);
    });
    if(row){res.status(202).json({...state(row),message:'If this email has a verified password account, a reset code will arrive shortly. Check spam too.'});wake();}
  }
  app.get(base,safeAsync(async(req,res)=>res.json(state(await pending(req)))));
  app.post(base+'/request',validOrigin,requireJson,json,safeAsync(publicCsrf),safeAsync((req,res)=>start(req,res,normalizedEmail(req.body?.email))));
  app.post(base+'/resend',...write((req,res)=>start(req,res,req.passwordReset.email)));
  app.post(base+'/verify',...write(async(req,res)=>{
    const row=req.passwordReset;
    if(await rateLimited(req,res,'password-reset-verify',row.email,{email:20,ip:60,window:600000}))return;
    if(typeof req.body?.code!=='string'||!/^\d{6}$/.test(req.body.code))return fail(res,400,'invalid_code_format','Enter the six-digit code from your email.');
    if(row.expires_at<=now())return fail(res,410,'code_expired','This code expired. Request a new one.');
    if(row.attempts>=5)return fail(res,429,'attempt_limit','This code reached its attempt limit. Request a new one.');
    const reserved=await run("UPDATE password_reset_challenges SET attempts=attempts+1 WHERE id=? AND attempts<5 AND expires_at>? AND state IN('sending','active','failed','queued')",row.id,now());
    if(!reserved.changes)return fail(res,409,'reset_changed','This reset attempt changed. Request a new code.');
    const matches=row.code_hash?await verifySecret(`reset:${row.id}:${row.claim_id}:${req.body.code}`,row.code_hash):false;
    let accepted=false,locked=false;
    await transaction(row.email,async()=>{
      const current=await get('SELECT * FROM password_reset_challenges WHERE id=?',row.id);
      if(!current||current.expires_at<=now()||!['sending','active'].includes(current.state)||current.claim_id!==row.claim_id)return;
      if(matches&&current.account_id){await run("UPDATE password_reset_challenges SET state='verified',code_hash=NULL,expires_at=? WHERE id=?",now()+ttl,row.id);accepted=true;}
      else if(current.attempts>=5){await run('UPDATE password_reset_challenges SET code_hash=NULL WHERE id=?',row.id);locked=true;}
    });
    if(!accepted)return fail(res,locked?429:400,locked?'attempt_limit':'incorrect_code',locked?'This code reached its attempt limit. Request a new one.':'The code is incorrect or unavailable. Check your email or resend it.');
    res.json(state(await get('SELECT * FROM password_reset_challenges WHERE id=?',row.id)));
  }));
  app.post(base+'/complete',...write(async(req,res)=>{
    const row=req.passwordReset;
    if(await rateLimited(req,res,'password-reset-complete',row.email,{email:10,ip:40,window:600000}))return;
    if(row.state!=='verified'||row.expires_at<=now())return fail(res,403,'reset_not_verified','Verify a valid reset code before choosing a password.');
    if(!validPassword(req.body?.password)||req.body.password!==req.body.confirmPassword)return fail(res,400,'invalid_password','Use 8–128 characters and enter the same password twice.');
    const passwordHash=await hashSecret(req.body.password);let completed=false;
    await transaction(row.email,async()=>{
      const current=await pending(req),identity=await get("SELECT * FROM identities WHERE provider='password' AND provider_id=? AND account_id=?",row.email,row.account_id);
      if(current?.id!==row.id||current.state!=='verified'||current.expires_at<=now()||!identity?.verified_at||digest(identity.password_hash)!==row.password_version)return;
      await run("UPDATE identities SET password_hash=? WHERE provider='password' AND provider_id=? AND account_id=?",passwordHash,row.email,row.account_id);
      await run("UPDATE password_reset_challenges SET state='used',code_hash=NULL WHERE email=? OR account_id=?",row.email,row.account_id);
      await run("UPDATE email_challenges SET delivery_state='used',code_hash=NULL,staged_password_hash=NULL WHERE account_id=?",row.account_id);
      await run('DELETE FROM sessions WHERE account_id=?',row.account_id);
      await run('UPDATE talk_meeting_connections SET revoked=1 WHERE account_id=?',row.account_id);completed=true;
    });
    if(!completed)return fail(res,409,'reset_changed','This reset attempt changed. Request a new code.');
    res.clearCookie(cookie,cookieOptions);res.clearCookie('talk_session',cookieOptions);
    res.json({...state(null),completed:true,message:'Password changed successfully. Sign in with your new password.'});
  }));
  return {tick,shutdown:async()=>{stopped=true;for(const timer of timers)clearTimeout(timer);timers.clear();while(working)await new Promise(resolve=>setTimeout(resolve,20));}};
}
