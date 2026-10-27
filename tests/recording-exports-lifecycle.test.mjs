import test from 'node:test';
import assert from 'node:assert/strict';
import { exportTranscriptPdf } from '../backend/src/recording-exports.mjs';

const example={title:'Private <meeting>',language:'hi',segments:[{start:1,end:2,text:'<script>never run</script> नमस्ते',speaker:null}]};
const timeouts={launch:100,operation:100,render:50,close:10,kill:10};
function fixture({hangClose=false,hangRender=false}={}) {
  const calls={close:0,kill:0,html:'',javascript:null,blocked:false};
  const page={setContent:async html=>{calls.html=html;},evaluate:async()=>true,pdf:async()=>hangRender?new Promise(()=>{}):Buffer.from('%PDF-FIXTURE')};
  const context={setDefaultTimeout:()=>{},route:async(_match,handler)=>{await handler({abort:()=>{calls.blocked=true;}});},newPage:async()=>page};
  const server={wsEndpoint:()=> 'ws://127.0.0.1/owned-fixture',close:async()=>{calls.close++;if(hangClose)return new Promise(()=>{});},kill:async()=>{calls.kill++;}};
  const browserType={launchServer:async()=>server,connect:async()=>({newContext:async options=>{calls.javascript=options.javaScriptEnabled;return context;}})};
  return{server,browserType,calls};
}

test('PDF lifecycle keeps transcript HTML escaped, scripts/network disabled and closes the owned worker',async()=>{
  const f=fixture(),pdf=await exportTranscriptPdf(example,{}, {browserType:f.browserType,timeouts});
  assert.equal(pdf.toString(),'%PDF-FIXTURE');assert.equal(f.calls.close,1);assert.equal(f.calls.kill,0);
  assert.equal(f.calls.javascript,false);assert.equal(f.calls.blocked,true);
  assert.match(f.calls.html,/&lt;script&gt;never run&lt;\/script&gt;/);assert.doesNotMatch(f.calls.html,/<script>/);assert.match(f.calls.html,/नमस्ते/);
});

test('PDF lifecycle force-terminates a worker whose graceful close never completes',async()=>{
  const f=fixture({hangClose:true});
  await exportTranscriptPdf(example,{}, {browserType:f.browserType,timeouts});assert.equal(f.calls.close,1);assert.equal(f.calls.kill,1);
});

test('PDF renderer deadline returns a sanitized failure and force-cleans its owned process',async()=>{
  const f=fixture({hangRender:true});
  await assert.rejects(exportTranscriptPdf(example,{}, {browserType:f.browserType,timeouts}),/private transcript PDF could not be generated/);
  assert.equal(f.calls.kill,1);assert.equal(f.calls.close,0);
});

test('PDF lifecycle disposes a late-launched browser after its startup request expired',async()=>{
  const f=fixture();let release;f.browserType.launchServer=()=>new Promise(resolve=>{release=resolve;});
  await assert.rejects(exportTranscriptPdf(example,{}, {browserType:f.browserType,timeouts:{...timeouts,launch:10}}));
  release(f.server);await new Promise(resolve=>setTimeout(resolve,20));assert.equal(f.calls.kill,1);
});
