import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Clock3, Grid2X2, Hand, Info, LoaderCircle, Lock, Maximize2, MessageCircle, MessageSquare, Mic, MicOff, Minimize2, MonitorUp, MoreHorizontal, PhoneOff, RefreshCw, Settings2, Sun, Moon, ChevronUp, Captions, ShieldCheck, Smile, Users, Video, VideoOff, Volume2 } from 'lucide-react';
import { ConnectionState, DisconnectReason, LocalVideoTrack, Room, RoomEvent, Track, supportsAudioOutputSelection, type Participant } from 'livekit-client';
import { MeetingAccessError, meetingIdFromUrl, navigateToMeeting, readMeetingPreferences, requestMeetingAccess, saveMeetingPreferences, takeMeetingJoin, type MeetingPreferences } from '../lib/meetingSession';
import { useAuth } from '../lib/auth';
import {guestMeeting} from '../lib/scheduling';
import { hasCameraEffects, readBackground } from '../lib/backgroundCatalog';
import { applyCameraBackground, releaseCameraBackground, TalkCameraProcessor } from '../lib/cameraBackground';
import { useMeetingBackground } from '../hooks/useMeetingBackground';
import { useMeetingManagement } from '../hooks/useMeetingManagement';
import { useMeetingRecording } from '../hooks/useMeetingRecording';
import { RecordingNotice } from './MeetingRecording';
import { meetingHostIdentity } from '../lib/meetingExperience';
import { useMeetingChat } from '../hooks/useMeetingChat';
import MeetingCanvas from './MeetingCanvas';
import MeetingPanels, { type MeetingPanel } from './MeetingPanels';
import Avatar from './Avatar';
import '../styles/live-meeting.css';
import '../styles/meeting-studio.css';
import { Pencil } from 'lucide-react';
import '../styles/whiteboard.css';
import '../styles/meeting-reference.css';
import '../styles/call-reference.css';
const Whiteboard = lazy(() => import('./Whiteboard'));

type MeetingState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error' | 'ended' | 'waiting' | 'uncreated';

function mediaMessage(error: unknown) {
  const name = error instanceof Error ? error.name : '';
  return name === 'NotAllowedError' ? 'Camera or microphone permission was blocked. Allow access in your browser, then enable the device again.'
    : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'Your selected device is unavailable. Choose another device in Settings.'
      : name === 'NotReadableError' ? 'Another application may be using this device. Close it and try again.'
        : 'The device could not be enabled. You can stay in the meeting with it turned off.';
}

export default function LiveMeeting() {
  const roomId = meetingIdFromUrl();
  const { user } = useAuth();
  const backgroundAccount = useRef(user?.id || 'guest'); backgroundAccount.current = user?.id || 'guest';
  const room = useRef<Room | null>(null);
  const pendingCameraProcessor = useRef<{ room: Room; processor: TalkCameraProcessor } | null>(null);
  const preferences = useRef<MeetingPreferences | null>(null);
  const stopConnection = useRef<() => void>(() => {});
  const [state, setState] = useState<MeetingState>('connecting');
  const [title, setTitle] = useState('Social Media Marketing Workshop');
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [cameraOn, setCameraOn] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [deviceBusy, setDeviceBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [errorCode, setErrorCode] = useState('');
  const [mediaError, setMediaError] = useState('');
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const controlsBusy = useRef(false);
  const [instance, setInstance] = useState<Room | null>(null);
  const [panel, setPanel] = useState<MeetingPanel>(() => window.innerWidth >= 900 ? 'chat' : null);
  const [callTheme,setCallTheme]=useState<'light'|'dark'>(()=>{try{return localStorage.getItem('talk-call-theme')==='dark'?'dark':'light';}catch{return 'light';}});
  const chooseCallTheme=(value:'light'|'dark')=>{setCallTheme(value);try{localStorage.setItem('talk-call-theme',value);}catch{}};
  const [whiteboardOpen,setWhiteboardOpen]=useState(false),[whiteboardAvailable,setWhiteboardAvailable]=useState(false);
  useEffect(()=>{let active=true;void fetch('/api/auth/config',{credentials:'same-origin'}).then(response=>response.json()).then(value=>{if(active)setWhiteboardAvailable(!guestMeeting()&&value.whiteboardConfigured===true);}).catch(()=>{});return()=>{active=false;};},[]);
  const meetingElement = useRef<HTMLDivElement | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const changed = () => setFullscreen(document.fullscreenElement === meetingElement.current);
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);
  const panelTrigger = useRef<HTMLButtonElement | null>(null);
  const previousWaiting = useRef<{ roomId: string; requests: Set<string> }>({ roomId, requests: new Set() });
  const [floatingReactions, setFloatingReactions] = useState(() => { try { return localStorage.getItem('talk-floating-reactions') !== 'off'; } catch { return true; } });
  const [reactionClock, setReactionClock] = useState(Date.now());
  useEffect(() => { const timer = window.setInterval(() => setReactionClock(Date.now()), 500); return () => window.clearInterval(timer); }, []);
  const [layout, setLayout] = useState<'grid' | 'speaker'>('grid');
  const [pinnedIdentity, setPinnedIdentity] = useState<string | null>(null);
  const [activeSpeakerIdentity, setActiveSpeakerIdentity] = useState('');
  const [presentationIdentity, setPresentationIdentity] = useState<string | null>(null);
  const [screenOn, setScreenOn] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const shareInFlight = useRef(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDevices, setSelectedDevices] = useState({ cameraId: '', micId: '', speakerId: '' });
  const [copyStatus, setCopyStatus] = useState('');
  const background = useMeetingBackground(instance, cameraOn);
  const management = useMeetingManagement(roomId, instance);
  const recording = useMeetingRecording(roomId, instance);
  const terminalMessage = useRef('');
  const [muteRequest, setMuteRequest] = useState(false);
  const lastMuteRequest = useRef(0);
  const chat = useMeetingChat(instance, panel === 'chat');
  const hostIdentity = meetingHostIdentity(management.data?.members || []);
  const cohostIdentities = management.data?.members.filter(member => member.role === 'cohost').map(member => member.identity) || [];
  const raisedHands = management.data?.members.filter(member => member.handAt).map(member => member.identity) || [];
  const waitingCount = management.data?.pending.filter(member => member.admission === 'pending').length || 0;
  useEffect(() => {
    const data = management.data;
    if (!data || data.meeting.id !== roomId || data.role === 'member') return;
    const requests = new Set(data.pending.filter(person => person.admission === 'pending').map(person => `${person.accountId}:${person.requestedAt}`));
    const hasNewRequest = [...requests].some(request => previousWaiting.current.roomId !== roomId || !previousWaiting.current.requests.has(request));
    previousWaiting.current = { roomId, requests };
    // Reveal the queue if no panel is open; keep an active chat/settings panel
    // undisturbed and notify through the persistent notice and toolbar badge.
    if (hasNewRequest) setPanel(current => current || 'participants');
  }, [management.data, roomId]);
  const meetingLink = `${window.location.origin}/device-test?room=${encodeURIComponent(roomId)}${guestMeeting()?'&guest=1':''}`;
  const presenters = participants.filter(participant => participant.isScreenShareEnabled);
  const currentPresentation = presenters.some(participant => participant.identity === presentationIdentity) ? presentationIdentity : presenters[0]?.identity || null;
  useEffect(() => { if (pinnedIdentity && !participants.some(participant => participant.identity === pinnedIdentity)) setPinnedIdentity(null); }, [participants, pinnedIdentity]);
  useEffect(() => {
    const data = management.data;
    if (!data) return;
    if (data.status === 'ended' || data.admission === 'removed' || data.admission === 'denied') {
      terminalMessage.current = data.status === 'ended' ? 'The host ended this meeting for everyone.' : data.admission === 'removed' ? 'The host removed your account from this meeting. Ask the host to authorize you before joining again.' : 'The host did not admit your account. Ask the host before requesting access again.';
      stopConnection.current(); setState('ended'); setMessage(terminalMessage.current); setParticipants([]);
    } else if (state === 'waiting' && data.admission === 'admitted' || state === 'uncreated' && data.status === 'active') setAttempt(value => value + 1);
    if (data.muteRequestedAt > lastMuteRequest.current) { lastMuteRequest.current = data.muteRequestedAt; setMuteRequest(true); }
  }, [management.data, state]);
  useEffect(() => {
    if (!instance || state !== 'connected') return;
    if (management.data?.canAudio === false && instance.localParticipant.isMicrophoneEnabled) void instance.localParticipant.setMicrophoneEnabled(false).catch(() => {});
    if (management.data?.canVideo === false) {
      if (instance.localParticipant.isCameraEnabled) void instance.localParticipant.setCameraEnabled(false).catch(() => {});
      if (instance.localParticipant.isScreenShareEnabled) void instance.localParticipant.setScreenShareEnabled(false).catch(() => {});
    }
  }, [management.data?.canAudio, management.data?.canVideo, instance, state]);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try { const available = await navigator.mediaDevices.enumerateDevices(); if (active) setDevices(available); }
      catch { /* The existing media error state handles unavailable browser APIs. */ }
    };
    const changed = async () => {
      await refresh();
      if (!active || !instance) return;
      for (const source of [Track.Source.Camera, Track.Source.Microphone]) {
        const publication = instance.localParticipant.getTrackPublication(source);
        if (publication?.track?.mediaStreamTrack.readyState === 'ended' && !publication.isMuted) {
          try { if (source === Track.Source.Camera) await instance.localParticipant.setCameraEnabled(false); else await instance.localParticipant.setMicrophoneEnabled(false); }
          catch { /* Device disappearance must not disconnect the meeting. */ }
          if (active) setMediaError('A selected device disconnected. Choose another device in Settings.');
        }
      }
    };
    void refresh(); navigator.mediaDevices?.addEventListener('devicechange', changed);
    instance?.on(RoomEvent.MediaDevicesChanged, changed);
    return () => { active = false; navigator.mediaDevices?.removeEventListener('devicechange', changed); instance?.off(RoomEvent.MediaDevicesChanged, changed); };
  }, [instance]);

  useEffect(() => {
    let active = true;
    let connection: Room | undefined;
    let borrowed: MediaStream | null = null;
    let preparingCamera: LocalVideoTrack | undefined;
    const retryCameraStreams = new Set<MediaStream>();
    const controller = new AbortController();
    const staged = takeMeetingJoin(roomId);
    const saved = staged?.preferences || readMeetingPreferences(roomId);
    preferences.current = saved;
    if (saved) setSelectedDevices({ cameraId: saved.cameraId, micId: saved.micId, speakerId: saved.speakerId || '' });
    terminalMessage.current = '';
    setState('connecting'); setMessage(''); setErrorCode(''); setMediaError(''); setParticipants([]); setAudioBlocked(false);
    const stopTracks = () => {
      void releaseCameraBackground(preparingCamera).catch(() => {});
      preparingCamera?.stop();
      const pending = pendingCameraProcessor.current;
      if (pending && pending.room === connection) {
        pendingCameraProcessor.current = null;
        pending.processor.getSourceTrack()?.stop();
        void pending.processor.suspend().catch(() => {});
      }
      borrowed?.getTracks().forEach(track => track.stop());
      retryCameraStreams.forEach(stream => stream.getTracks().forEach(track => track.stop()));
      retryCameraStreams.clear();
      connection?.localParticipant.trackPublications.forEach(publication => publication.track?.stop());
    };
    const stop = () => { stopTracks(); if (connection) void connection.disconnect(true); };
    stopConnection.current = stop;
    const pageLeave = () => { active = false; controller.abort(); stop(); };
    const accountChanged = () => { stop(); if (active) { setState('disconnected'); setMessage('Your Talk session changed. Return to the pre-join screen to join again.'); } };
    window.addEventListener('pagehide', pageLeave);
    window.addEventListener('talk:auth-session-changed', accountChanged);
    async function connect() {
      if (!saved) { if (active) { setState('error'); setMessage('Enter your display name on the pre-join screen before joining.'); } return; }
      borrowed = staged?.stream || null;
      try {
        const access = staged?.access || await requestMeetingAccess(roomId, saved.displayName, controller.signal);
        if (!active) { stopTracks(); return; }
        setTitle(access.meeting.title);
        if (access.joinState) { borrowed?.getTracks().forEach(track => track.stop()); borrowed = null; setState(access.joinState === 'waiting' ? 'waiting' : 'uncreated'); return; }
        connection = new Room({ adaptiveStream: true, dynacast: true, stopLocalTrackOnUnpublish: true,
          videoCaptureDefaults: { deviceId: saved.cameraId ? { exact: saved.cameraId } : undefined, resolution: { width: 1280, height: 720 } },
          audioCaptureDefaults: { deviceId: saved.micId ? { exact: saved.micId } : undefined, echoCancellation: true, noiseSuppression: true },
        });
        room.current = connection;
        setInstance(connection);
        const sync = () => {
          if (!active || !connection) return;
          setParticipants([connection.localParticipant, ...connection.remoteParticipants.values()]);
          setCameraOn(connection.localParticipant.isCameraEnabled);
          setMicOn(connection.localParticipant.isMicrophoneEnabled);
          setScreenOn(connection.localParticipant.isScreenShareEnabled);
          setActiveSpeakerIdentity(previous => connection!.activeSpeakers[0]?.identity || previous);
        };
        for (const event of [RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected, RoomEvent.TrackSubscribed,
          RoomEvent.TrackUnsubscribed, RoomEvent.TrackMuted, RoomEvent.TrackUnmuted, RoomEvent.LocalTrackPublished,
          RoomEvent.LocalTrackUnpublished, RoomEvent.ActiveSpeakersChanged, RoomEvent.ParticipantNameChanged, RoomEvent.TrackPublished, RoomEvent.TrackUnpublished]) connection.on(event, sync);
        connection.on(RoomEvent.Reconnecting, () => { if (active) { setState('reconnecting'); setMessage('Connection interrupted. Reconnecting to your meeting…'); } });
        connection.on(RoomEvent.SignalReconnecting, () => { if (active) { setState('reconnecting'); setMessage('Connection interrupted. Reconnecting to your meeting…'); } });
        connection.on(RoomEvent.Reconnected, () => { if (active) { setState('connected'); setMessage(''); sync(); } });
        connection.on(RoomEvent.Disconnected, reason => {
          stopTracks();
          if (active) {
            const ended = Boolean(terminalMessage.current) || reason === DisconnectReason.ROOM_DELETED || reason === DisconnectReason.PARTICIPANT_REMOVED;
            setState(ended ? 'ended' : 'disconnected'); setMessage(terminalMessage.current || (ended ? 'This meeting session has ended. You can return to the pre-join screen.' : 'You have disconnected from the meeting. You can rejoin or leave.')); setParticipants([]);
          }
        });
        connection.on(RoomEvent.MediaDevicesError, error => { if (active) setMediaError(mediaMessage(error)); });
        connection.on(RoomEvent.AudioPlaybackStatusChanged, () => { if (active && connection) setAudioBlocked(!connection.canPlaybackAudio); });
        if (!access.serverUrl || !access.token) throw new Error('Missing meeting connection');
        await connection.connect(access.serverUrl, access.token, { autoSubscribe: true, maxRetries: 1, websocketTimeout: 12000, peerConnectionTimeout: 15000 });
        if (!active) { stop(); return; }
        controlsBusy.current = true; setDeviceBusy(true);
        setState('connected'); setStartedAt(value => value || Date.now()); sync();
        if (saved.speakerId && supportsAudioOutputSelection()) {
          try { await connection.switchActiveDevice('audiooutput', saved.speakerId); } catch { if (active) setMediaError('Your selected speaker output is unavailable. Choose another output in Settings.'); }
        }
        // Publish the original pre-join tracks; devices are not re-opened on Join.
        // Muted/off sources are never silently enabled.
        const tracks = borrowed?.getTracks() || [];
        for (const kind of ['audio', 'video'] as const) {
          const enabled = kind === 'audio' ? saved.micOn && access.canAudio !== false : saved.cameraOn && access.canVideo !== false;
          const track = tracks.find(item => item.kind === kind && item.readyState === 'live');
          if (!active || connection.state !== ConnectionState.Connected) { stop(); return; }
          try {
            if (enabled && track) {
              if (kind === 'video' && hasCameraEffects(readBackground(backgroundAccount.current))) {
                const camera = new LocalVideoTrack(track);
                preparingCamera = camera;
                try { await applyCameraBackground(camera, readBackground(backgroundAccount.current)); if (!active) { camera.stop(); return; } await connection.localParticipant.publishTrack(camera, { source: Track.Source.Camera }); }
                catch (failure) { camera.stop(); throw failure; }
                finally { if (preparingCamera === camera) preparingCamera = undefined; }
              } else await connection.localParticipant.publishTrack(track, { source: kind === 'audio' ? Track.Source.Microphone : Track.Source.Camera });
            }
            else if (enabled) {
              if (kind === 'audio') await connection.localParticipant.setMicrophoneEnabled(true);
              else {
                // A retry has no borrowed pre-join camera. Own its source stream
                // explicitly: capture can resolve after Leave/disconnect, before
                // LiveKit has a publication that stopTracks() could otherwise see.
                const stream = await navigator.mediaDevices.getUserMedia({audio: false, video: {
                  ...(saved.cameraId ? {deviceId: {exact: saved.cameraId}} : {}),
                  width: {ideal: 1280}, height: {ideal: 720},
                }});
                if (!active || connection.state !== ConnectionState.Connected) {
                  stream.getTracks().forEach(source => source.stop()); return;
                }
                retryCameraStreams.add(stream);
                const source = stream.getVideoTracks()[0];
                if (!source) { stream.getTracks().forEach(item => item.stop()); throw new Error('Camera unavailable'); }
                const effect = readBackground(backgroundAccount.current);
                let camera: LocalVideoTrack | undefined;
                try {
                  if (hasCameraEffects(effect)) {
                    camera = new LocalVideoTrack(source); preparingCamera = camera;
                    await applyCameraBackground(camera, effect);
                  }
                  if (!active || connection.state !== ConnectionState.Connected) { camera?.stop(); source.stop(); return; }
                  const publication = await connection.localParticipant.publishTrack(camera || source, {source: Track.Source.Camera});
                  if (!active || connection.state !== ConnectionState.Connected) { publication.track?.stop(); source.stop(); return; }
                } catch (failure) {
                  source.stop(); camera?.stop();
                  throw failure;
                } finally { if (preparingCamera === camera) preparingCamera = undefined; }
              }
            } else track?.stop();
          } catch (error) { track?.stop(); if (active) setMediaError(mediaMessage(error)); }
          sync();
        }
        if (!active) stop();
      } catch (error) {
        stop();
        if (!active) return;
        setState('error'); setParticipants([]);
        setMessage(error instanceof MeetingAccessError ? error.message : 'Could not connect to the meeting server. Check your connection and try again.');
        setErrorCode(error instanceof MeetingAccessError ? error.code : '');
      } finally { if (active && connection && room.current === connection) { controlsBusy.current = false; setDeviceBusy(false); } }
    }
    void connect();
    return () => {
      active = false; controller.abort();
      window.removeEventListener('pagehide', pageLeave);
      window.removeEventListener('talk:auth-session-changed', accountChanged);
      stop(); connection?.removeAllListeners();
      if (room.current === connection) { room.current = null; setInstance(null); }
    };
  }, [roomId, attempt]);

  useEffect(() => {
    if (!startedAt || state === 'ended' || state === 'disconnected' || state === 'error') return;
    const tick = () => setSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    tick(); const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [startedAt, state]);

  const toggle = async (source: 'camera' | 'microphone') => {
    const connection = room.current;
    if (!connection || state !== 'connected' || controlsBusy.current) return;
    controlsBusy.current = true; setDeviceBusy(true); setMediaError('');
    let processor: TalkCameraProcessor | undefined;
    try {
      const selectedBackground = readBackground(backgroundAccount.current);
      const previousCamera = connection.localParticipant.getTrackPublication(Track.Source.Camera)?.videoTrack;
      if (source === 'camera' && !connection.localParticipant.isCameraEnabled && previousCamera && (hasCameraEffects(selectedBackground) || previousCamera.getProcessor() instanceof TalkCameraProcessor)) {
        await connection.localParticipant.unpublishTrack(previousCamera, true);
      }
      const cameraEnabled = !connection.localParticipant.isCameraEnabled;
      if (source === 'camera' && cameraEnabled && hasCameraEffects(selectedBackground)) {
        processor = new TalkCameraProcessor(selectedBackground);
        pendingCameraProcessor.current = { room: connection, processor };
      }
      const publication = source === 'camera'
        ? await connection.localParticipant.setCameraEnabled(cameraEnabled, processor ? { deviceId: selectedDevices.cameraId ? { exact: selectedDevices.cameraId } : undefined, processor } : undefined)
        : await connection.localParticipant.setMicrophoneEnabled(!connection.localParticipant.isMicrophoneEnabled);
      if (room.current !== connection || connection.state !== ConnectionState.Connected) { publication?.track?.stop(); if (processor) { processor.getSourceTrack()?.stop(); await processor.suspend().catch(() => {}); } return; }
      const camera = connection.localParticipant.isCameraEnabled;
      const microphone = connection.localParticipant.isMicrophoneEnabled;
      setCameraOn(camera); setMicOn(microphone);
      if (preferences.current) {
        preferences.current = { ...preferences.current, cameraOn: camera, micOn: microphone };
        saveMeetingPreferences(preferences.current);
      }
    } catch (error) { if (processor) { processor.getSourceTrack()?.stop(); await processor.suspend().catch(() => {}); } setMediaError(mediaMessage(error)); }
    finally { if (pendingCameraProcessor.current?.processor === processor) pendingCameraProcessor.current = null; controlsBusy.current = false; setDeviceBusy(false); }
  };
  const leave = () => {
    if (leaving) return;
    setLeaving(true);
    if (room.current?.localParticipant.identity) void management.action('leave', undefined, { identity: room.current.localParticipant.identity });
    stopConnection.current();
    navigateToMeeting(`/device-test?room=${encodeURIComponent(roomId)}${guestMeeting()?'&guest=1':''}`);
  };
  const pin = (identity: string) => setPinnedIdentity(current => current === identity ? null : identity);
  const openPanel = (next: Exclude<MeetingPanel, null>, trigger: HTMLButtonElement) => {
    panelTrigger.current = trigger;
    setPanel(current => current === next ? null : next);
  };
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(meetingLink); setCopyStatus('Meeting link copied.'); }
    catch { setCopyStatus('Copy is unavailable. Open Meeting information and copy the link manually.'); }
  };
  const toggleScreen = async () => {
    const connection = room.current;
    if (!connection || state !== 'connected' || shareInFlight.current) return;
    if (!navigator.mediaDevices?.getDisplayMedia && !connection.localParticipant.isScreenShareEnabled) {
      setMediaError('Screen sharing is unavailable in this browser. Try a desktop browser over HTTPS.'); return;
    }
    shareInFlight.current = true; setShareBusy(true); setMediaError('');
    const enable = !connection.localParticipant.isScreenShareEnabled;
    try {
      const publication = await connection.localParticipant.setScreenShareEnabled(enable, { audio: management.data?.canAudio !== false, selfBrowserSurface: 'exclude', surfaceSwitching: 'include', contentHint: 'detail' });
      if (room.current !== connection || connection.state !== ConnectionState.Connected) {
        publication?.track?.stop(); connection.localParticipant.trackPublications.forEach(item => item.track?.stop()); void connection.disconnect(true); return;
      }
      setScreenOn(connection.localParticipant.isScreenShareEnabled);
      if (enable) { setPinnedIdentity(null); setPresentationIdentity(connection.localParticipant.identity); }
    } catch (error) {
      if (room.current === connection) setMediaError(error instanceof Error && (error.name === 'NotAllowedError' || error.name === 'AbortError')
        ? 'Screen sharing was cancelled or permission was blocked. Choose Share screen to try again.'
        : 'Your screen could not be shared. Check your browser permissions and try again.');
    } finally { shareInFlight.current = false; setShareBusy(false); }
  };
  const changeDevice = async (kind: MediaDeviceKind, id: string) => {
    const connection = room.current;
    if (!connection || state !== 'connected' || controlsBusy.current) return;
    controlsBusy.current = true; setDeviceBusy(true); setMediaError('');
    try {
      const changed = await connection.switchActiveDevice(kind, id || 'default', Boolean(id));
      if (!changed) throw new Error('Device switch failed');
      if (room.current !== connection || connection.state !== ConnectionState.Connected) return;
      const key = kind === 'videoinput' ? 'cameraId' : kind === 'audioinput' ? 'micId' : 'speakerId';
      setSelectedDevices(current => ({ ...current, [key]: id }));
      if (preferences.current) { preferences.current = { ...preferences.current, [key]: id }; saveMeetingPreferences(preferences.current); }
      setDevices(await navigator.mediaDevices.enumerateDevices());
    } catch (error) { if (room.current === connection) setMediaError(mediaMessage(error)); }
    finally { controlsBusy.current = false; setDeviceBusy(false); }
  };
  const enableAudio = async () => {
    try { await room.current?.startAudio(); setAudioBlocked(Boolean(room.current && !room.current.canPlaybackAudio)); }
    catch { setMediaError('Audio playback is blocked. Allow sound in your browser and try again.'); }
  };
  const duration = `${Math.floor(seconds / 3600) ? `${Math.floor(seconds / 3600)}:` : ''}${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  const statusLabel = state === 'connected' ? 'Connected' : state === 'connecting' ? 'Connecting securely…' : state === 'reconnecting' ? 'Reconnecting…' : state === 'waiting' ? 'Waiting room' : state === 'ended' ? 'Meeting ended' : state === 'uncreated' ? 'Ready to create' : 'Not connected';
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await meetingElement.current?.requestFullscreen();
    } catch { setMediaError('Fullscreen is unavailable. You can continue using the meeting normally.'); }
  };
  const retryActions = <div className="studio-retry-actions"><button className="secondary-button" onClick={() => setAttempt(value => value + 1)}><RefreshCw size={15} />Rejoin meeting</button><a href={`/device-test?room=${encodeURIComponent(roomId)}${guestMeeting()?'&guest=1':''}`} className="secondary-button"><ArrowLeft size={15} />Back to pre-join</a>{errorCode === 'sign_in_required' && <a href="/sign-in" className="primary-button">Sign in to Talk</a>}</div>;
  return <div ref={meetingElement} className={`meeting-room live-meeting meeting-studio call-reference call-theme-${callTheme}${panel ? ' has-call-panel' : ''}${whiteboardOpen&&whiteboardAvailable&&!['waiting','uncreated','ended'].includes(state)?' is-whiteboarding':''}`} data-connection-state={state}>
    <header className="room-header">
      <a href="/dashboard" className="room-brand" aria-label="Talk overview"><span className="studio-brand-mark"><MessageCircle size={25} /></span>Talk</a>
      <div className="live-meeting-status" role="status" aria-live="polite"><span className={`live-connection-dot ${state}`} />{statusLabel}</div>
      <div className="room-title"><strong title={title}>{title}</strong><button className="call-title-info" aria-label="Meeting information" onClick={event=>openPanel('info',event.currentTarget)}><Info size={13}/></button></div>
      {participants.length > 0 && <button className="secondary-button studio-layout-toggle" aria-label={layout === 'grid' ? 'Focus speaker' : 'Grid view'} title={layout === 'grid' ? 'Focus speaker' : 'Grid view'} aria-pressed={layout === 'speaker'} onClick={() => { setPinnedIdentity(null); setLayout(current => current === 'grid' ? 'speaker' : 'grid'); }}><Grid2X2 size={15} /><span>{layout === 'grid' ? 'Focus speaker' : 'Grid view'}</span></button>}
      <div className="live-meeting-summary"><span aria-label="Participant count"><Users size={16} />{participants.length}</span><time aria-label="Meeting duration"><Clock3 size={17} aria-hidden="true" />{duration}</time><span className="studio-security"><ShieldCheck size={15} /><span>Secure meeting access</span></span></div>{recording.data?.active?.status==='recording'&&<span className="call-recording-indicator"><i/>Recording</span>}<div className="call-header-actions"><div className="call-theme-toggle" role="group" aria-label="Call theme"><button aria-pressed={callTheme==='light'} onClick={()=>chooseCallTheme('light')}><Sun size={13}/>Light</button><button aria-pressed={callTheme==='dark'} onClick={()=>chooseCallTheme('dark')}><Moon size={13}/>Dark</button></div><button className="call-header-panel-toggle" aria-label="Participants" aria-expanded={panel==='participants'} onClick={event=>openPanel('participants',event.currentTarget)}><Users size={15}/><span>{participants.length}</span>{waitingCount>0&&<b>{waitingCount}</b>}</button><button className="call-header-panel-toggle" aria-label={chat.unread?`Chat (${chat.unread} unread)`:'Chat'} aria-expanded={panel==='chat'} onClick={event=>openPanel('chat',event.currentTarget)}><MessageSquare size={15}/>{chat.unread>0&&<b>{chat.unread}</b>}</button></div>
    </header>
    <main className="live-meeting-main">
      <RecordingNotice recording={recording} onLeave={leave} connected={state === 'connected'} />
      {management.data?.locked && <div className="studio-lock-status"><Lock size={13} />Meeting locked</div>}
      {waitingCount > 0 && <button id="live-waiting-request-notice" className="live-meeting-notice live-waiting-alert" aria-live="polite" aria-controls="live-meeting-panel" aria-expanded={panel === 'participants'} onClick={event => openPanel('participants', event.currentTarget)}><Users size={17} />Waiting room ({waitingCount}) — review admission requests</button>}
      {muteRequest && <div className="live-meeting-notice" role="status"><p>The host or a co-host asks you to mute your microphone.</p><div><button className="secondary-button" onClick={() => { if (micOn) void toggle('microphone'); setMuteRequest(false); }}>Mute my microphone</button><button className="secondary-button" onClick={() => setMuteRequest(false)}>Dismiss</button></div></div>}
      {management.error && <div role="alert" className="live-meeting-notice is-error">{management.error}<button className="live-dismiss" onClick={management.clearError}>Dismiss</button></div>}
      {management.refreshError && <div role="alert" className="live-meeting-notice is-error"><p>{management.refreshError}</p><button className="secondary-button" onClick={() => void management.refresh()}><RefreshCw size={15} />Retry meeting controls</button></div>}
      {!management.refreshError && management.data?.participantSync === 'unavailable' && <p role="status" className="live-meeting-notice">Participant presence is temporarily unavailable. {management.data.role === 'member' ? 'Your meeting access and media permissions are still enforced.' : 'Waiting-room requests and admission controls are still available.'}</p>}
      {state === 'connected' && (management.data?.canAudio === false || management.data?.canVideo === false) && <p className="live-meeting-notice" role="status">The host has restricted {management.data?.canAudio === false ? 'microphone publishing' : ''}{management.data?.canAudio === false && management.data?.canVideo === false ? ' and ' : ''}{management.data?.canVideo === false ? 'camera and screen publishing' : ''}. Restoring permission will not turn your devices on.</p>}
      {message && participants.length > 0 && <div className={`live-meeting-notice${state === 'error' ? ' is-error' : ''}`} role={state === 'error' ? 'alert' : 'status'}><p>{message}</p>{(state === 'error' || state === 'disconnected') && retryActions}</div>}
      {mediaError && <p role="alert" className="live-meeting-notice is-error">{mediaError}</p>}
      {audioBlocked && <button className="primary-button live-enable-audio" onClick={() => void enableAudio()}><Volume2 size={17} />Enable meeting audio</button>}
      <div className={`live-meeting-workspace${panel ? ' with-panel' : ''}`}>
        <section className={`live-meeting-stage${whiteboardOpen?' wb-stage':''}`} aria-label="Meeting canvas" data-solo={participants.length === 1}>
          {whiteboardOpen&&whiteboardAvailable&&!['waiting','uncreated','ended'].includes(state)&&<Suspense fallback={<div className="wb-loading">Opening whiteboard…</div>}><Whiteboard meetingId={roomId} room={instance} canStart={management.data?.role==='host'||management.data?.role==='cohost'} onClose={()=>setWhiteboardOpen(false)}/></Suspense>}
          {document.fullscreenEnabled && <button className="studio-fullscreen" aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} title={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} onClick={() => void toggleFullscreen()}>{fullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button>}
          {participants.length > 0 ? <div className={whiteboardOpen?'wb-video-strip':'wb-video-normal'}>
            {presenters.length > 0 && <div className="live-view-options"><label className="live-presenter-choice"><MonitorUp size={15} /><span>Presenting</span><select aria-label="Current presentation" value={currentPresentation || ''} onChange={event => { setPresentationIdentity(event.target.value); setPinnedIdentity(null); }}>{presenters.map(participant => <option key={participant.identity} value={participant.identity}>{participant.name || 'Talk member'}</option>)}</select></label></div>}
            <MeetingCanvas members={management.data?.members} reactions={management.data?.reactions.filter(item => (management.data?.serverTime ?? reactionClock) + reactionClock - (management.data?.receivedAt ?? reactionClock) - item.at < 6000)} participants={participants} localIdentity={instance?.localParticipant.identity || ''} hostIdentity={hostIdentity} cohostIdentities={cohostIdentities} raisedHands={raisedHands} pinnedIdentity={pinnedIdentity} activeSpeakerIdentity={activeSpeakerIdentity} layout={layout} presentationIdentity={currentPresentation} onPin={pin} onShowPresentation={() => setPinnedIdentity(null)} />
          </div> : <div className="studio-empty-stage">
            <div className="studio-state-avatar"><Avatar avatar={user?.avatar} name={preferences.current?.displayName || user?.name || 'Talk member'} /><span>{state === 'connecting' || state === 'reconnecting' ? <LoaderCircle size={17} className="auth-loading-icon" /> : state === 'waiting' || state === 'uncreated' ? <Users size={17} /> : state === 'ended' ? <PhoneOff size={17} /> : <VideoOff size={17} />}</span></div>
            {state === 'connecting' || state === 'reconnecting' ? <><h2>{state === 'connecting' ? 'Joining your Talk meeting…' : 'Reconnecting to your meeting…'}</h2><p>Your meeting will appear here once the connection is ready.</p></>
              : state === 'ended' ? <><h2>Meeting ended</h2><p>{message || 'This meeting session has ended.'}</p><a href={`/device-test?room=${encodeURIComponent(roomId)}${guestMeeting()?'&guest=1':''}`} className="secondary-button"><ArrowLeft size={15} />Back to pre-join</a></>
                : state === 'waiting' ? <><h2>Waiting for host to let you in.</h2><p>Your camera, audio and chat are not shared with the meeting before admission.</p><div className="studio-state-pill"><LoaderCircle size={14} className="auth-loading-icon" />Waiting for admission</div><a className="secondary-button" href={`/device-test?room=${encodeURIComponent(roomId)}${guestMeeting()?'&guest=1':''}`}>Back to pre-join</a></>
                  : state === 'uncreated' ? <><h2>Create this Talk meeting</h2><p>No meeting creator has started this room. Creating it assigns ownership to your signed-in Talk account.</p><button className="primary-button" disabled={management.busy || !management.data} onClick={async () => { if (await management.create()) setAttempt(value => value + 1); }}>Create meeting as host</button><p>Host approval will be required for new participants.</p></>
                    : <><h2>{state === 'error' ? 'Unable to join the meeting' : 'You’re disconnected'}</h2><p role={state === 'error' ? 'alert' : 'status'}>{message || 'Reconnect to continue your conversation.'}</p>{retryActions}</>}
          </div>}
          {state === 'connected' && participants.length === 1 && <p className="live-meeting-waiting"><Users size={14} />Waiting for others to join this meeting.</p>}
        </section>
        {panel && <MeetingPanels onOpenWhiteboard={whiteboardAvailable?()=>setWhiteboardOpen(true):undefined} onPanelChange={next => setPanel(next)} recording={recording} background={background} cameraEnabled={cameraOn} floatingReactions={floatingReactions} onFloatingReactions={enabled => { setFloatingReactions(enabled); try { localStorage.setItem('talk-floating-reactions', enabled ? 'on' : 'off'); } catch { /* Optional preference. */ } }} panel={panel} onClose={() => setPanel(null)} participants={participants} localIdentity={instance?.localParticipant.identity || ''} hostIdentity={hostIdentity} management={management} onNewMeeting={async () => { const result = await management.newMeeting(); if (result) { stopConnection.current(); navigateToMeeting(`/device-test?room=${encodeURIComponent(result.meeting.id)}`); } }} pinnedIdentity={pinnedIdentity} onPin={pin} title={title} roomId={roomId} link={meetingLink} duration={duration} copyStatus={copyStatus} onCopy={() => void copyLink()} devices={{ devices, ...selectedDevices, speakerSupported: supportsAudioOutputSelection(), busy: deviceBusy, onChange: (kind, id) => void changeDevice(kind, id) }} chat={chat} connected={state === 'connected'} trigger={panelTrigger} />}
      </div>
    </main>
    <div className="live-reactions" aria-live="polite" aria-label="Meeting reactions">{state === 'connected' && floatingReactions && management.data?.reactions.filter(item => (management.data?.serverTime ?? reactionClock) + reactionClock - (management.data?.receivedAt ?? reactionClock) - item.at < 6000).map(reaction => <span key={reaction.id} className="live-reaction" role="img" aria-label={`${management.data?.members.find(member => member.accountId === reaction.accountId)?.name || 'A participant'} reacted ${reaction.emoji}`}>{reaction.emoji}<small>{management.data?.members.find(member => member.accountId === reaction.accountId)?.name || 'Talk member'}</small></span>)}</div>
    <footer className="room-dock live-meeting-controls" aria-label="Meeting controls">
      <span className="call-audio-output"><Volume2 size={14}/><span>System audio</span></span>
      <div className="room-device-controls">
        <div className={`call-device-group ${micOn?'on':'off'}`}><button title={micOn?'Mute microphone':'Enable microphone'} aria-label={micOn?'Mute microphone':'Enable microphone'} aria-pressed={micOn} disabled={state!=='connected'||deviceBusy||management.data?.canAudio===false} onClick={()=>void toggle('microphone')}>{micOn?<Mic size={17}/>:<MicOff size={17}/>}<span>Mic</span></button><button className="call-device-chevron" aria-label="Choose microphone" onClick={event=>openPanel('settings',event.currentTarget)}><ChevronUp size={11}/></button></div>
        <div className={`call-device-group ${cameraOn?'on':'off'}`}><button title={cameraOn?'Turn camera off':'Enable camera'} aria-label={cameraOn?'Turn camera off':'Enable camera'} aria-pressed={cameraOn} disabled={state!=='connected'||deviceBusy||management.data?.canVideo===false} onClick={()=>void toggle('camera')}>{cameraOn?<Video size={17}/>:<VideoOff size={17}/>}<span>Camera</span></button><button className="call-device-chevron" aria-label="Choose camera" onClick={event=>openPanel('settings',event.currentTarget)}><ChevronUp size={11}/></button></div>
      </div>
      <div className="live-toolbar-tools"><button className={screenOn?'is-selected':''} title={screenOn?'Stop sharing':'Share screen'} aria-label={screenOn?'Stop sharing':'Share screen'} aria-pressed={screenOn} disabled={state!=='connected'||shareBusy||management.data?.canVideo===false} onClick={()=>void toggleScreen()}><MonitorUp size={17}/><span>{screenOn?'Stop sharing':'Share screen'}</span></button>
        <button className="call-captions" disabled title="Live captions are not configured" aria-label="Live captions unavailable"><Captions size={17}/><span>Captions</span></button>
        <button title={management.data?.handAt?'Lower hand':'Raise hand'} aria-label={management.data?.handAt?'Lower hand':'Raise hand'} aria-pressed={Boolean(management.data?.handAt)} disabled={state!=='connected'||management.busy} onClick={()=>void management.action(management.data?.handAt?'lower_hand':'raise_hand')}><Hand size={17}/><span>{management.data?.handAt?'Lower hand':'Raise hand'}</span></button>
        <button title="More options" aria-label="More options" aria-expanded={panel==='more'} aria-controls={panel==='more'?'live-meeting-panel':undefined} onClick={event=>openPanel('more',event.currentTarget)}><MoreHorizontal size={17}/><span>More</span></button>
      </div><button className="leave-button" onClick={leave} disabled={leaving} aria-label="Leave Meeting"><PhoneOff size={16}/><span>{leaving?'Leaving\u2026':'Leave'}</span></button>
    </footer>

  </div>;
}
