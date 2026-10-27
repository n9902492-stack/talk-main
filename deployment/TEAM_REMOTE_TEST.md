# Remote-device acceptance test: five people, two meetings

Status: **not executed remotely**. This is a manual acceptance checklist after approved HTTPS deployment. Local automated Chrome/SFU checks use generated media and test authentication providers; they do not prove separate networks, physical microphones/cameras or real Google/SMS/email delivery.

## Setup

Use only five privately chosen verified Talk accounts; do not put passwords, OTPs, tokens or personal phone numbers in this document or screenshots. Test login through existing Google/Email OTP flows; Mobile OTP real SMS needs its own approval. Use fictional phone numbers for that regression until then. Do not merge matching-email accounts implicitly.

| Person | Device/network | Meeting | Role |
| --- | --- | --- | --- |
| User 1 | Laptop, network 1 | A | Creator/host |
| User 2 | Laptop, network 2 | A | Participant |
| User 3 | Mobile, mobile data | A | Participant |
| User 4 | Laptop, network 3 | B | Creator/host |
| User 5 | Mobile or laptop, another network | B | Participant |

Use headphones to avoid feedback. Test modern Chrome/Edge and an actual Android Chrome or iOS Safari device used by the team. Confirm address bar HTTPS and browser/site camera/microphone permissions; test initial denial and recovery. Corporate firewall testing must allow the documented LiveKit endpoints; a failed relay test is not a successful connection.

## Run together for at least 75 minutes

1. All five sign in at `https://talk-fc3dc.web.app`. Refresh and reopen a tab; session persists securely. Logout revokes access; unsigned-in dashboard/meeting access is rejected.
2. User 1 creates meeting A with approval required; User 4 independently creates B. Copy links from Talk. Confirm distinct logical IDs and separate LiveKit rooms on the backend without printing tickets. Share each link privately with its assigned users.
3. All use the existing pre-join preview, device selectors, speaker/microphone tests and display names. Join with different camera/microphone on/off settings; those settings survive admission.
4. Users 2, 3 and 5 wait. Before admission, verify no audio/video/chat/participant details leak and no meeting WebRTC connection is created. Each host sees only their own waiting requests; admit/deny/re-authorize/admit-all as appropriate.
5. Keep both calls connected simultaneously, A=3 and B=2. Each person speaks a unique sentence and shows motion on camera. Other users in the same room confirm hearing/seeing them. Users in the other room must hear/see nothing from that room. Record observations below, not just connection labels.
6. Send distinctive chat messages in A and B; confirm room isolation. Share a desktop window/tab from each host in turn; verify real content in that room and no publication in the other. Stop sharing from both browser and Talk controls. Where mobile cannot originate sharing, record that browser limitation rather than a false pass.
7. Toggle microphone/camera, switch devices, use camera-off avatars and reactions, pin/focus/grid. Confirm remote changes with a second person. Disable effects on a weak phone if performance suffers; preserve the current effects settings rather than changing the meeting design.
8. A host tests request-to-mute, audio/camera publish restrictions and restoration, co-host grant/revoke, raised hands, room lock, remove/re-authorize. Never remotely activate another microphone/camera. B remains unaffected throughout. Try a B member's account against A's moderation URL: backend must reject it; knowing a link alone is not a host privilege. A new linked participant still needs host admission.
9. Briefly disable one device's network, then restore; switch one phone between Wi-Fi and cellular. Verify reconnect, current authorized role, admission and room isolation. Remove a participant then try reconnecting/refreshing the old link: no immediate unauthorized rejoin. Do not paste signal URLs into evidence.
10. Keep a call active beyond 60 minutes to exercise Cloud Run's WebSocket timeout and automatic reconnection. Observe resumed media/chat and retained roles. Separately test a restrictive network or controlled relay-only configuration to verify TURN; ordinary UDP success alone does not prove fallback. Do not permanently force relay for all users just to pass a test.
11. User 1 leaves: A continues for admitted members. Rejoin as authorized host; end A for everyone: A disconnects and further access is blocked while B stays connected. End B separately. Confirm camera lights and media tracks stop.
12. Recording is off in the base proposal. If separately approved: exercise unanimous consent, late-join handling, persistent indicator, audio/video segments, private playback/download, deletion/retention and genuine English/Hindi transcripts under the reviewed worker capacity. Lack of consent must block capture. Do not claim local transcription throughput as cloud capacity.

## Evidence (complete only after real testing)

| Item | Actual observation / result |
| --- | --- |
| Date, reviewed release and device/browser versions | Pending |
| Five real authenticated users, three or more networks | Pending |
| A: three participants hearing/seeing each other | Pending |
| B: two participants hearing/seeing each other simultaneously | Pending |
| No cross-room audio/video/chat/screen content | Pending |
| Waiting room and backend moderation | Pending |
| Desktop screen sharing and chat in both rooms | Pending |
| Mobile permissions/device changes | Pending |
| Network change and >60-minute reconnect | Pending |
| TURN/restrictive-network path | Pending |
| Leave/end/media cleanup and independent rooms | Pending |
| Recording/transcription (separate approval) | Not part of base deployment |

Safe evidence: timestamp, room A/B labels, counts, sanitized error category, aggregate RTP frame/audio packet counters, ICE candidate type/protocol with addresses redacted, and consented screenshots without personal data. Never include request URLs with credentials, access tokens, raw SDP, IP addresses, phone numbers, session cookies, secrets or message contents without consent. Update hosting readiness only after the relevant hosted checks actually pass.
