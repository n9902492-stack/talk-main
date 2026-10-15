import proxyaddr from 'proxy-addr';
import { isIP } from 'node:net';

export function clientIpResolver(cidrs = '') {
  const ranges = cidrs.split(',').map(item => item.trim()).filter(Boolean);
  // Never permit trust-all or an arbitrary hop count. Work right to left from
  // explicitly trusted ingress addresses, stopping at the first untrusted hop.
  if (ranges.some(value => ['0.0.0.0/0', '::/0', 'true', '*'].includes(value))) throw new Error('Trust-all proxy configuration is forbidden.');
  const trust = ranges.length ? proxyaddr.compile(ranges) : () => false;
  return req => {
    try { const ip = proxyaddr(req, trust); return isIP(ip) ? ip.toLowerCase() : req.socket.remoteAddress || 'unknown'; }
    catch { return req.socket.remoteAddress || 'unknown'; }
  };
}
