import http from 'node:http';import https from 'node:https';import net from 'node:net';import dns from 'node:dns';import dnsPromises from 'node:dns/promises';import {syncBuiltinESMExports} from 'node:module';
// Test process only. All fixture HTTP and disposable PostgreSQL are loopback.
const allowed=host=>['127.0.0.1','::1','[::1]','localhost'].includes(String(host));
const reject=()=>{(globalThis.__cloudEgressBlocks||=[]).push(new Error().stack.split('\n').slice(2,6).join('\n'));throw new Error('External network egress blocked by the cloud AI test harness.');};
const originalFetch=globalThis.fetch;
globalThis.fetch=(url,options)=>{if(!allowed(new URL(typeof url==='string'||url instanceof URL?url:url.url).hostname))reject();return originalFetch(url,options);};
for(const api of [http,https])for(const key of ['request','get']){const original=api[key];api[key]=function(...args){const first=args[0],host=typeof first==='string'||first instanceof URL?new URL(first).hostname:first?.hostname||first?.host||'localhost';if(!allowed(host))reject();return original.apply(this,args);};}
const connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){const first=args[0],host=typeof first==='object'&&!Array.isArray(first)?first.host:Array.isArray(first)?first[0]?.host:typeof args[1]==='string'?args[1]:'localhost';if(host&&!allowed(host))reject();return connect.apply(this,args);};
for(const api of [dns,dnsPromises])for(const key of ['lookup','resolve','resolve4','resolve6'])if(api[key]){const original=api[key];api[key]=function(host,...rest){if(!allowed(host))reject();return original.call(this,host,...rest);};}
syncBuiltinESMExports();
globalThis.__cloudEgressGuard=true;
