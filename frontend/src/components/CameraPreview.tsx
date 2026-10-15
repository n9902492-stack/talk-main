import { Mic, MicOff, ShieldCheck, UserRound, Video, VideoOff } from 'lucide-react';
import { useMediaPreview } from '../hooks/useMediaPreview';

export default function CameraPreview() {
  const media = useMediaPreview();
  return <div className="webinar-camera-preview">
    <div className="camera-preview">
      <video ref={media.videoRef} autoPlay playsInline muted className={media.cameraOn ? 'visible' : 'invisible'} aria-label="Your camera preview" />
      {!media.cameraOn && <div className="camera-placeholder"><span className="preview-avatar"><UserRound size={42} /></span><h3>Your camera is off</h3><p>Enable your camera to see your preview.</p></div>}
      <div className="preview-name">You<span>Preview</span></div>
      <div className="camera-controls">
        <button aria-label={media.micOn ? 'Mute microphone' : 'Enable microphone'} aria-pressed={media.micOn} disabled={media.busy} onClick={media.toggleMic}>{media.micOn ? <Mic size={21} /> : <MicOff size={21} />}</button>
        <button aria-label={media.cameraOn ? 'Turn camera off' : 'Enable camera'} aria-pressed={media.cameraOn} disabled={media.busy} onClick={media.toggleCamera}>{media.cameraOn ? <Video size={21} /> : <VideoOff size={21} />}</button>
      </div>
    </div>
    <div className="camera-under"><ShieldCheck size={16} /><span>Your preview stays on this device.</span><button onClick={media.stop} disabled={!media.stream}>Stop devices</button></div>
    {media.error && <p role="alert" className="inline-error">{media.error}</p>}
  </div>;
}
