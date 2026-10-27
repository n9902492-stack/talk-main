import test from 'node:test';import assert from 'node:assert/strict';
import {createWhiteboardProvider,whiteboardProviderFromEnvironment} from '../backend/src/whiteboard-ai-provider.mjs';
const digest='sha256:'+'a'.repeat(64),settings={enabled:true,approved:true,model:'qwen3:1.7b-q4_K_M',modelDigest:digest};
test('disabled provider makes no network request or implicit model start',async()=>{let requests=0;const p=createWhiteboardProvider({},async()=>{requests++;});assert.equal(p.configured,false);await assert.rejects(p.generate({operation:'generate',prompt:'Test'}));assert.equal(requests,0);});
test('unapproved/external/cloud/credential-bearing configurations are rejected',()=>{for(const config of [{...settings,approved:false},{...settings,baseUrl:'https://api.example.test'},{...settings,baseUrl:'http://localhost:11434'},{...settings,model:'model:cloud'},{...settings,baseUrl:'http://127.0.0.1:11434/api/chat'},{...settings,baseUrl:'http://user:secret@127.0.0.1:11434'}])assert.throws(()=>createWhiteboardProvider(config));assert.equal(whiteboardProviderFromEnvironment({}).configured,false);});
test('HTTP contract fixture verifies pinned model, structured JSON, no tools, local-only routing and unload',async()=>{
  const calls=[],p=createWhiteboardProvider(settings,async(url,init={})=>{calls.push({url,init});return url.endsWith('/api/tags')?Response.json({models:[{name:settings.model,digest}]}):Response.json({done:true,message:{content:JSON.stringify({schemaVersion:1,title:'Synthetic fixture'})}});},()=>3*1024**3);
  const result=await p.generate({operation:'generate',prompt:'Synthetic fixture',sources:[]});assert.equal(result.schemaVersion,1);assert.ok(calls.every(c=>c.url.startsWith('http://127.0.0.1:11434/')));assert.equal(calls.length,2);
  const body=JSON.parse(calls[1].init.body);assert.equal(body.keep_alive,0);assert.equal(body.think,false);assert.equal(body.stream,false);assert.equal(body.format.type,'object');assert.equal('tools'in body,false);assert.equal(calls[1].init.redirect,'error');
});
test('changed model and oversized, incomplete or malformed provider output are rejected',async()=>{
  const changed=createWhiteboardProvider(settings,async()=>Response.json({models:[{name:settings.model,digest:'sha256:'+'b'.repeat(64)}]}),()=>3*1024**3);await assert.rejects(changed.generate({operation:'generate',prompt:'Synthetic'}));
  for(const payload of [{done:false,message:{content:'{}'}},{done:true,message:{content:'not json'}},{done:true,message:{content:'x'.repeat(260000)}}]){
    const p=createWhiteboardProvider(settings,async url=>Response.json(url.endsWith('/api/tags')?{models:[{name:settings.model,digest}]}:payload),()=>3*1024**3);await assert.rejects(p.generate({operation:'generate',prompt:'Synthetic'}));}
});
test('low-memory guard rejects before network requests or model loading',async()=>{let calls=0;const p=createWhiteboardProvider(settings,async()=>{calls++;},()=>512*1024**2);await assert.rejects(p.generate({operation:'generate',prompt:'Synthetic'}),e=>e.code==='whiteboard_provider_resources');assert.equal(calls,0);});
test('invalid optional runtime settings disable AI without preventing normal Talk startup',()=>{const p=whiteboardProviderFromEnvironment({WHITEBOARD_AI_ENABLED:'true',WHITEBOARD_AI_OLLAMA_URL:'https://external.invalid'});assert.equal(p.configured,false);assert.match(p.reason,/normal drawing remain available/);});
test('genuine local-model quality/inference validation',{skip:'No Phase 10H model execution approved; limited-RAM benchmark remains postponed.'},()=>{});
test('genuine handwriting-text recognition',{skip:'No reliable handwriting text recognizer configured; unavailable state is tested instead.'},()=>{});
