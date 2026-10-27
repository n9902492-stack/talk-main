import test from 'node:test';import assert from 'node:assert/strict';
import {createCloudWhiteboardProvider,cloudWhiteboardProviderFromEnvironment,cloudEndpoint,publicAddress,pinnedDestination,lockedCloudTransport,readCloudResponse,canonical,CLOUD_EXTERNAL_RELEASE_APPROVED} from '../backend/src/whiteboard-cloud-provider.mjs';
import {PassThrough} from 'node:stream';
import {cloudSettings,diagram,response} from './helpers/cloud-fixture.mjs';
const input={operation:'generate',prompt:'Synthetic plan',sources:[]};
const run=p=>p.generate({prepared:p.prepare(input),beforeSend:async()=>{}});

test('network guard prevents real external fetch, HTTP, DNS and sockets',async()=>{
  assert.equal(globalThis.__cloudEgressGuard,true);await assert.rejects(async()=>fetch('https://llm.example.com'));
  const https=await import('node:https'),dns=await import('node:dns/promises');assert.throws(()=>https.request('https://llm.example.com'));await assert.rejects(async()=>dns.lookup('llm.example.com'));
});
test('default and missing configuration are disabled without a crash or network probe',()=>{
  for(const options of [{},{...cloudSettings,apiKey:''},{...cloudSettings,model:''}])assert.equal(createCloudWhiteboardProvider(options).configured,false);
  assert.equal(cloudWhiteboardProviderFromEnvironment({}).status,'not_configured');
});
test('credentials alone, operator flag alone and UI-like input cannot lift release lock',async()=>{
  assert.equal(CLOUD_EXTERNAL_RELEASE_APPROVED,false);
  for(const options of [{...cloudSettings,enabled:false},{...cloudSettings,operatorApproved:false},cloudSettings]){
    const p=createCloudWhiteboardProvider(options);await assert.rejects(run(p));assert.equal(p.status,'disabled');
  }
  await assert.rejects(lockedCloudTransport({endpoint:'https://llm.example.com',body:'{}'}),e=>e.code==='cloud_release_blocked');
});
test('URLs require exact explicit HTTPS allowlist and reject unsafe syntax and destinations',()=>{
  for(const url of ['http://llm.example.com/v1','https://localhost/v1','https://127.0.0.1/v1','https://[::1]/v1','https://metadata.google.internal/v1','https://u:secret@llm.example.com/v1','https://llm.example.com:444/v1','https://llm.example.com/v1?q=1','https://llm.example.com/v1#x','https://llm.example.com/a/../v1','https://llm.example.com/%2e/v1'])assert.throws(()=>cloudEndpoint(url,[url]));
  assert.throws(()=>cloudEndpoint(cloudSettings.baseUrl,[]));assert.equal(cloudEndpoint(cloudSettings.baseUrl,cloudSettings.allowlist),cloudSettings.baseUrl);
});
test('DNS validation rejects private, reserved, mapped IPv6 and mixed-address rebinding answers',async()=>{
  for(const address of ['0.0.0.0','127.0.0.1','10.1.1.1','100.100.100.200','169.254.169.254','172.16.0.1','192.168.1.1','192.0.2.1','198.18.0.1','224.0.0.1','::1','::ffff:8.8.8.8','fc00::1','fe80::1','64:ff9b::808:808','2001:db8::1','2002:808:808::1','3fff::1'])assert.equal(publicAddress(address),false,address);
  assert.equal(publicAddress('8.8.8.8'),true);assert.equal(publicAddress('2606:4700:4700::1111'),true);
  await assert.rejects(pinnedDestination(cloudSettings.baseUrl,async()=>[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}]));
});
test('TLS hostname is preserved while validated DNS is pinned with no redirect/proxy agent',async()=>{
  let resolutions=0;const options=await pinnedDestination(cloudSettings.baseUrl,async()=>{resolutions++;return [{address:'8.8.8.8',family:4}];});
  assert.equal(options.servername,'llm.example.com');assert.equal(options.rejectUnauthorized,true);assert.equal(options.agent,false);assert.equal(options.path,'/v1/chat/completions');
  options.lookup('llm.example.com',{},(_,address)=>assert.equal(address,'8.8.8.8'));assert.equal(resolutions,1);
});
test('invalid model, invalid settings and sensitive configuration errors never echo credentials',()=>{
  for(const options of [{model:'bad model'},{provider:'arbitrary'},{maxOutputTokens:999999},{estimatedSpendLimit:1},{baseUrl:'https://user:super-secret@bad.example.com'}]){const p=createCloudWhiteboardProvider({...cloudSettings,...options});assert.equal(p.status,'error');assert.ok(!JSON.stringify(p).includes(cloudSettings.apiKey));assert.ok(!p.reason.includes('super-secret'));}
});
test('generic structured adapter sends only fixed instructions/request/text and reports numeric usage',async()=>{
  let sent;const p=createCloudWhiteboardProvider(cloudSettings,async request=>{await request.beforeSend();sent=JSON.parse(request.body);return response();});
  const result=await run(p);assert.deepEqual(result.output,diagram);assert.equal(p.status,'disabled','A mock is never a verified real provider');assert.equal(result.usage.total_tokens,150);assert.equal(sent.max_tokens,2048);assert.equal(sent.stream,false);assert.equal(sent.tools,undefined);assert.equal(sent.messages.length,2);assert.deepEqual(JSON.parse(sent.messages[1].content),{request:'Synthetic plan',notes:[]});
});
test('OpenAI dialect uses completion cap, strict required/nullable schema and fixed official endpoint',async()=>{
  let sent;const p=createCloudWhiteboardProvider({...cloudSettings,provider:'openai',baseUrl:'https://api.openai.com/v1',allowlist:['https://api.openai.com/v1']},async req=>{sent=JSON.parse(req.body);return response({...diagram,nodes:[{...diagram.nodes[0],section:null}]});});
  const result=await run(p);assert.equal(sent.max_completion_tokens,2048);assert.equal(sent.max_tokens,undefined);assert.equal(sent.response_format.json_schema.strict,true);assert.ok(sent.response_format.json_schema.schema.properties.nodes.items.required.includes('section'));assert.equal(result.output.nodes[0].section,undefined);
  assert.equal(createCloudWhiteboardProvider({...cloudSettings,provider:'openai'}).status,'error');
});
test('explicit legacy JSON dialect has no automatic retry/fallback',async()=>{
  let calls=0;const p=createCloudWhiteboardProvider({...cloudSettings,responseFormat:'json_object'},async req=>{calls++;assert.deepEqual(JSON.parse(req.body).response_format,{type:'json_object'});throw new Error('private credential or body');});await assert.rejects(run(p),e=>!e.message.includes('private credential'));assert.equal(calls,1);
});
test('invalid JSON, incomplete output, refusal, tool calls, oversized responses are rejected',async()=>{
  for(const payload of [{choices:[{finish_reason:'stop',message:{content:'invalid'}}]}, {choices:[{finish_reason:'length',message:{content:'{}'}}]}, {choices:[{finish_reason:'stop',message:{content:'{}',refusal:'No'}}]}, {choices:[{finish_reason:'stop',message:{content:'{}',tool_calls:[]}}]},response({text:'x'.repeat(256000)})])await assert.rejects(run(createCloudWhiteboardProvider(cloudSettings,async()=>payload)));
});
test('timeout, user cancellation and excessive input stop processing safely',async()=>{
  const p=createCloudWhiteboardProvider({...cloudSettings,timeoutMs:100},async()=>new Promise(()=>{}));const keep=setInterval(()=>{},50);try{await assert.rejects(run(p),e=>e.code==='cloud_timeout');}finally{clearInterval(keep);}
  const c=new AbortController();c.abort();await assert.rejects(p.generate({prepared:p.prepare(input),signal:c.signal,beforeSend:async()=>{}}));
  assert.throws(()=>createCloudWhiteboardProvider({...cloudSettings,maxInputTokens:256}).prepare(input));
});
test('cost is unknown without reliable prices, operator estimates use configured currency only',()=>{
  const plain=createCloudWhiteboardProvider(cloudSettings);assert.equal(plain.prepare(input).cost,null);
  const priced=createCloudWhiteboardProvider({...cloudSettings,inputPricePerMillion:2,outputPricePerMillion:4,currency:'USD',estimatedSpendLimit:1});const q=priced.prepare(input);assert.equal(q.cost.microunits,q.inputEstimate*2+2048*4);assert.equal(q.cost.currency,'USD');assert.equal(canonical({b:1,a:2}),canonical({a:2,b:1}));
});
test('response reader rejects redirects, rate limits, malformed JSON and oversized bodies without following URLs',async()=>{
  for(const status of [301,302,307,308,429,500]){const res=new PassThrough();res.statusCode=status;res.headers={location:'http://169.254.169.254/'};await assert.rejects(readCloudResponse(res));assert.equal(res.destroyed,true);}
  for(const body of ['invalid','x'.repeat(256001)]){const res=new PassThrough();res.statusCode=200;const reading=readCloudResponse(res);res.end(Buffer.from(body));await assert.rejects(reading);}
  const res=new PassThrough();res.statusCode=200;const reading=readCloudResponse(res);res.end(Buffer.from('{"safe":true}'));assert.deepEqual(await reading,{safe:true});
});
