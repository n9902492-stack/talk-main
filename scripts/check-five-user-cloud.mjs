// Read-only existing project check. Does not create rooms, tokens or resources.
import fs from 'node:fs';
import { fiveUserConfiguration } from '../backend/src/five-user-test.mjs';
import { RoomServiceClient } from 'livekit-server-sdk';
const launch = JSON.parse(fs.readFileSync('artifacts/qa/five-user-public-launch.json'));
const config = fiveUserConfiguration(launch.root, 'https://five-user-offline-preflight.trycloudflare.com', launch.directory);
let report;
try {
  const client = new RoomServiceClient(config.environment.LIVEKIT_URL.replace(/^wss:/, 'https:'), config.environment.LIVEKIT_API_KEY, config.environment.LIVEKIT_API_SECRET, { requestTimeout: 8, failover: false });
  await client.listRooms();
  report = { checkedAt: new Date().toISOString(), configured: true, authenticatedReadOnlyApi: 'PASS', media: 'NOT_TESTED', paidResourcesCreated: 0, roomsCreated: 0 };
} catch {
  report = { checkedAt: new Date().toISOString(), configured: true, authenticatedReadOnlyApi: 'FAIL', media: 'NOT_TESTED', paidResourcesCreated: 0, roomsCreated: 0 };
  process.exitCode = 1;
}
fs.writeFileSync('artifacts/qa/five-user-cloud-readiness.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
