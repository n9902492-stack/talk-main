import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspectSmsHosting, canPublishToEmptySite, canCleanUpSmsTest } from '../scripts/sms-test-hosting-status.mjs';

const version='sites/talk-fc3dc/versions/temporary-fixture';
const expectedPaths=['404.html','robots.txt','sms-test-fixture/index.html'];
function fixture({existing=false,paths=expectedPaths,rewrites=[],more=false,status=200}={}){
  return async(url,options)=>{
    assert.equal(options.method,'GET');assert.equal(options.redirect,'error');
    let data={};
    if(url.includes('/releases?'))data={releases:existing?[{name:'release-fixture'}]:[]};
    else if(url.endsWith('/channels/live'))data=existing?{release:{version:{name:version}}}:{};
    else if(url.includes('/files?'))data={files:paths.map(name=>({path:'/'+name})),...(more?{nextPageToken:'fixture'}:{})};
    else if(url.endsWith(version))data={config:{rewrites}};
    return {status,ok:status===200,json:async()=>data};
  };
}

test('publish guard confirms no live release and fails closed on metadata errors or existing content',async()=>{
  const empty=await inspectSmsHosting({accessToken:'private-fixture',fetcher:fixture()});assert(canPublishToEmptySite(empty));
  const existing=await inspectSmsHosting({accessToken:'private-fixture',fetcher:fixture({existing:true})});assert(!canPublishToEmptySite(existing));
  for(const status of [403,404,500])assert(!canPublishToEmptySite(await inspectSmsHosting({accessToken:'private-fixture',fetcher:fixture({status})})));
  assert(!JSON.stringify(empty).includes('private-fixture'));
});

test('cleanup guard permits only the known standalone file set with no backend or SPA rewrites',async()=>{
  const inspect=options=>canCleanUpSmsTest({accessToken:'fixture',expectedPaths,fetcher:fixture({existing:true,...options})});
  assert(await inspect({}));
  assert(!await inspect({paths:[...expectedPaths,'index.html','assets/talk.js']}));
  assert(!await inspect({paths:['index.html']}));
  assert(!await inspect({rewrites:[{source:'**',destination:'/index.html'}]}));
  assert(!await inspect({more:true}));
  assert(!await inspect({existing:false}));
});
