import { useEffect, useRef, useState } from 'react';

import { useBackgroundPreview } from './useBackgroundPreview';

export function useMediaPreview() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const frameRef = useRef(0);
  const requestRef = useRef(0);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [cameraId, setCameraId] = useState('');
  const [micId, setMicId] = useState('');
  const [cameraOn, setCameraOn] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [level, setLevel] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const backgroundStatus = useBackgroundPreview(videoRef, stream, cameraOn);
  const release = () => {
    cancelAnimationFrame(frameRef.current);
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    void contextRef.current?.close().catch(() => {});
    contextRef.current = null;
  };
  useEffect(() => () => { requestRef.current++; release(); }, []);
  useEffect(() => { if (videoRef.current) { videoRef.current.srcObject = stream; if (stream) void videoRef.current.play().catch(() => {}); } }, [stream]);
  const enable = async (camera = true, microphone = true, nextCamera = cameraId, nextMic = micId) => {
    const request = ++requestRef.current;
    setBusy(true); setError('');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Media devices are unavailable. Open this page on localhost in Chrome or Edge.');
      const next = await navigator.mediaDevices.getUserMedia({ video: camera ? { ...(nextCamera ? { deviceId: { exact: nextCamera } } : {}), width: { ideal: 1280 }, height: { ideal: 720 } } : false, audio: microphone ? { ...(nextMic ? { deviceId: { exact: nextMic } } : {}), echoCancellation: true, noiseSuppression: true } : false });
      if (request !== requestRef.current) { next.getTracks().forEach(track => track.stop()); return; }
      release(); streamRef.current = next; setStream(next);
      setCameraOn(next.getVideoTracks().length > 0); setMicOn(next.getAudioTracks().length > 0);
      setCameraId(next.getVideoTracks()[0]?.getSettings().deviceId || nextCamera);
      setMicId(next.getAudioTracks()[0]?.getSettings().deviceId || nextMic);
      setDevices(await navigator.mediaDevices.enumerateDevices());
      if (next.getAudioTracks().length) {
        const context = new AudioContext(); contextRef.current = context;
        await context.resume();
        if (request !== requestRef.current) return;
        const analyser = context.createAnalyser(); analyser.fftSize = 256;
        context.createMediaStreamSource(next).connect(analyser);
        const values = new Uint8Array(analyser.fftSize);
        const sample = () => {
          analyser.getByteTimeDomainData(values);
          const rms = Math.sqrt(values.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / values.length);
          setLevel(Math.min(100, rms * 400)); frameRef.current = requestAnimationFrame(sample);
        };
        sample();
      }
    } catch (cause) {
      if (request !== requestRef.current) return;
      const name = cause instanceof DOMException ? cause.name : '';
      setError(name === 'NotAllowedError' ? 'Camera or microphone access was blocked. Allow access in your browser’s site settings, then try again. You can also enable each device separately.' : name === 'NotFoundError' ? 'No matching camera or microphone was found. Connect a device, or try enabling just your microphone.' : name === 'NotReadableError' ? 'Another app may be using this device. Close that app, then try again.' : cause instanceof Error ? cause.message : 'Unable to access your devices. Please try again.');
    } finally { if (request === requestRef.current) setBusy(false); }
  };
  const toggleCamera = () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) { void enable(true, micOn); return; }
    track.enabled = !track.enabled; setCameraOn(track.enabled);
  };
  const toggleMic = () => {
    const track = streamRef.current?.getAudioTracks()[0];
    if (!track) { void enable(cameraOn, true); return; }
    track.enabled = !track.enabled; setMicOn(track.enabled);
  };
  const stop = () => { requestRef.current++; release(); setStream(null); setCameraOn(false); setMicOn(false); setLevel(0); setBusy(false); };
  const takeStream = () => {
    requestRef.current++;
    cancelAnimationFrame(frameRef.current);
    void contextRef.current?.close().catch(() => {}); contextRef.current = null;
    const value = streamRef.current;
    streamRef.current = null;
    return value;
  };
  return { videoRef, backgroundStatus, stream, devices, cameraId, micId, cameraOn, micOn, level, busy, error, enable, toggleCamera, toggleMic, stop, takeStream };
}
