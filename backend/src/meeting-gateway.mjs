import { WebSocket, WebSocketServer } from 'ws';
import { SignalResponse } from '@livekit/protocol';

const prefix = '/api/auth/meeting-signal';
const paths = new Set([`${prefix}/rtc`, `${prefix}/rtc/v1`]);
const clientParameters = new Set(['sdk', 'version', 'protocol', 'client_protocol', 'device_model', 'os', 'os_version', 'browser', 'browser_version', 'auto_subscribe', 'adaptive_stream', 'reconnect', 'sid', 'reconnect_reason', 'network', 'join_request']);

// Real SFU JWTs never cross this boundary. Refreshed tokens are replaced with
// the same opaque, revocable, session-bound Talk ticket before reaching the SDK.
export function scrubSignal(bytes, binary, ticket) {
  const packet = binary ? SignalResponse.fromBinary(new Uint8Array(bytes)) : SignalResponse.fromJsonString(bytes.toString(), { ignoreUnknownFields: true });
  if (packet.message.case === 'refreshToken') packet.message.value = ticket;
  // MoveParticipant changes the logical room. Talk must reauthorize admission
  // rather than accepting an SFU-initiated room change or forwarding its JWT.
  // This is distinct from LiveKit Cloud's regional endpoint selection.
  if (packet.message.case === 'roomMoved') throw new Error('Room changes require Talk meeting authorization.');
  return binary ? packet.toBinary({ writeUnknownFields: false }) : packet.toJsonString();
}

export function createMeetingGateway({ db, manager, service, origins }) {
  const server = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024, perMessageDeflate: false });
  const connections = new Set();
  const attempts = new Map();
  const originAllowed = origin => origins.has(origin);
  async function attach(httpServer) {
    const upgrade = async (request, socket, head) => {
      let url;
      try { url = new URL(request.url, 'http://localhost'); } catch { return; }
      if (!url.pathname.startsWith(prefix)) return; // Leave Vite's own HMR socket alone.
      const reject = status => { if (!socket.destroyed) socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nCache-Control: no-store\r\nContent-Length: 0\r\n\r\n`); };
      if (!paths.has(url.pathname) || !originAllowed(request.headers.origin) || request.url.length > 24000) { reject(403); return; }
      try {
        const ticket = url.searchParams.get('access_token');
        const authorization = await db.withContext(() => manager.authorizeTicket(ticket));
        if (!authorization || !service.configured) { reject(403); return; }
        const time = Date.now();
        let bucket = attempts.get(authorization.connection.identity);
        if (!bucket || bucket.until <= time) { bucket = { until: time + 60000, count: 0 }; attempts.set(authorization.connection.identity, bucket); }
        if (++bucket.count > 20 || connections.size >= 500) { reject(429); return; }
        const issued = await service.issueToken(authorization.connection.account_id, authorization.own.display_name, {
          identity: authorization.connection.identity, roomName: authorization.row.room_name,
          canAudio: Boolean(authorization.own.can_audio), canVideo: Boolean(authorization.own.can_video),
        });
        if (socket.destroyed) return;
        // Authorization is checked again after signing and periodically while
        // connected, closing the admission/removal race around an upgrade.
        if (!await db.withContext(() => manager.authorizeTicket(ticket))) { reject(403); return; }
        server.handleUpgrade(request, socket, head, downstream => {
          const upstreamUrl = new URL(service.upstreamUrl);
          upstreamUrl.pathname = url.pathname.endsWith('/v1') ? '/rtc/v1' : '/rtc';
          for (const [key, value] of url.searchParams) if (clientParameters.has(key)) upstreamUrl.searchParams.set(key, value);
          upstreamUrl.searchParams.set('access_token', issued.token);
          const upstream = new WebSocket(upstreamUrl, { handshakeTimeout: 10000, maxPayload: 2 * 1024 * 1024, perMessageDeflate: false });
          const entry = { downstream, upstream, ticket, identity: authorization.connection.identity, room: authorization.row.room_name, checking: false };
          connections.add(entry);
          let queued = [], queuedBytes = 0;
          const close = () => { connections.delete(entry); downstream.close(); upstream.close(); };
          const forward = (to, bytes, binary) => {
            if (to.readyState !== WebSocket.OPEN) return;
            if (to.bufferedAmount > 2 * 1024 * 1024) { close(); return; }
            to.send(bytes, { binary });
          };
          upstream.on('open', () => { for (const [bytes, binary] of queued) forward(upstream, bytes, binary); queued = []; });
          downstream.on('message', (bytes, binary) => {
            if (upstream.readyState === WebSocket.OPEN) forward(upstream, bytes, binary);
            else if (upstream.readyState === WebSocket.CONNECTING && (queuedBytes += bytes.length) < 128 * 1024) queued.push([bytes, binary]);
            else close();
          });
          upstream.on('message', (bytes, binary) => {
            try { forward(downstream, scrubSignal(bytes, binary, ticket), binary); } catch { close(); }
          });
          upstream.on('error', close); downstream.on('error', close);
          upstream.on('close', () => { connections.delete(entry); downstream.close(4000, 'Meeting signaling closed'); });
          downstream.on('close', () => { connections.delete(entry); upstream.close(); });
        });
      } catch { reject(503); }
    };
    httpServer.on('upgrade', upgrade);
    httpServer.once('close', () => { httpServer.off('upgrade', upgrade); shutdown(); });
  }
  let reconciling = false, ticks = 0;
  const timer = setInterval(() => {
    for (const [identity, bucket] of attempts) if (bucket.until <= Date.now()) attempts.delete(identity);
    if (++ticks % 5 === 0 && !reconciling && service.configured) {
      reconciling = true;
      void db.withContext(() => manager.reconcile()).catch(() => {}).finally(() => { reconciling = false; });
    }
    for (const connection of connections) {
      if (connection.checking) continue; connection.checking = true;
      void db.withContext(async () => {
        if (!await manager.authorizeTicket(connection.ticket)) {
          // Revoke signaling first; even if the SFU is briefly unreachable,
          // reconnects cannot obtain a new upstream connection.
          connection.downstream.close(4003, 'Meeting access revoked'); connection.upstream.close();
          try { await service.admin.removeParticipant(connection.room, connection.identity); } catch { /* Desired state remains durable. */ }
        }
      }).catch(() => { connection.downstream.close(1011, 'Meeting authorization unavailable'); connection.upstream.close(); }).finally(() => { connection.checking = false; });
    }
  }, 1000);
  timer.unref();
  const shutdown = () => { clearInterval(timer); for (const connection of connections) { connection.downstream.terminate(); connection.upstream.terminate(); } connections.clear(); server.close(); };
  return { attach, shutdown };
}
