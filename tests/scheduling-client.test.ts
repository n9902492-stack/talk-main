import test from 'node:test';
import assert from 'node:assert/strict';

test('a long-open booking confirmation refreshes a rejected form challenge once before effective delivery',async t=>{
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
 const {schedulingRequest}=await import(String('../frontend/src/lib/scheduling.ts?form-refresh'));
 let forms=0,writes=0,delivered=0;
 globalThis.fetch=(async(input,options)=>{
  if(String(input).endsWith('/form'))return Response.json({formToken:`form-${++forms}`});
  writes++;
  if(writes===1)return Response.json({error:'invalid_booking_form'},{status:403});
  assert.equal((options?.headers as Record<string,string>)['X-Scheduling-Token'],'form-2');
  delivered++;return Response.json({sent:true});
 }) as typeof fetch;
 assert.deepEqual(await schedulingRequest('/booking/synthetic/code',{credential:'synthetic'}),{sent:true});
 assert.equal(forms,2);assert.equal(writes,2);assert.equal(delivered,1);
});

test('SMTP failures and connection failures are never automatically retried',async t=>{
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
 const {schedulingRequest}=await import(String('../frontend/src/lib/scheduling.ts?no-delivery-retry'));
 let writes=0;
 globalThis.fetch=(async(input)=>{if(String(input).endsWith('/form'))return Response.json({formToken:'synthetic'});writes++;return Response.json({error:'verification_delivery_failed',message:'Not delivered.'},{status:503});}) as typeof fetch;
 await assert.rejects(schedulingRequest('/booking/synthetic/code',{}),/Not delivered/);assert.equal(writes,1);
 globalThis.fetch=(async()=>{writes++;throw new TypeError('Synthetic connection failure.');}) as typeof fetch;
 await assert.rejects(schedulingRequest('/booking/synthetic/code',{}),/Synthetic connection failure/);assert.equal(writes,2);
});

test('a repeated invalid form is bounded and host writes never use the public retry path',async t=>{
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
 const {schedulingRequest}=await import(String('../frontend/src/lib/scheduling.ts?bounded-refresh'));
 let writes=0;
 globalThis.fetch=(async input=>{
  if(String(input).endsWith('/form'))return Response.json({formToken:'synthetic'});
  if(String(input).endsWith('/session'))return Response.json({csrfToken:'host-csrf',user:{id:'host'}});
  writes++;return Response.json({error:'invalid_booking_form',message:'Refresh required.'},{status:403});
 }) as typeof fetch;
 await assert.rejects(schedulingRequest('/booking/synthetic/code',{}),/Refresh required/);assert.equal(writes,2);
 await assert.rejects(schedulingRequest('/profile',{},true),/Refresh required/);assert.equal(writes,3);
});
