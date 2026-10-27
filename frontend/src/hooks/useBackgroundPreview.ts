import { useEffect, useRef, useState, type RefObject } from 'react';
import type { LocalVideoTrack } from 'livekit-client';
import { useBackgroundPreference } from './useBackgroundPreference';
import { applyCameraBackground, releaseCameraBackground, type BackgroundStatus } from '../lib/cameraBackground';
import { hasCameraEffects } from '../lib/backgroundCatalog';

// The preview clone never owns/stops the original capture handed to the meeting.
export function useBackgroundPreview(video: RefObject<HTMLVideoElement | null>, stream: MediaStream | null, enabled: boolean) {
  const { preference } = useBackgroundPreference();
  const [status, setStatus] = useState<BackgroundStatus>({state:'off',message:'No camera effects.'});
  const session = useRef<{ raw: MediaStreamTrack; track?: LocalVideoTrack; alive: boolean; version: number } | null>(null);
  useEffect(() => {
    const raw=stream?.getVideoTracks()[0];if(!raw||!enabled)return;
    const current={raw,alive:true,version:0,track:undefined as LocalVideoTrack|undefined};session.current=current;
    return()=>{current.alive=false;if(video.current)current.track?.detach(video.current);void releaseCameraBackground(current.track).catch(()=>{});current.track?.stop();if(session.current===current)session.current=null;};
  },[stream,enabled,video]);
  useEffect(()=>{
    const current=session.current,element=video.current;
    if(!current||!element||!stream){setStatus({state:'off',message:'Enable your camera to preview effects.'});return;}
    const version=++current.version;
    const active=()=>current.alive&&current.version===version;
    setStatus({state:hasCameraEffects(preference)?'loading':'off',message:hasCameraEffects(preference)?'Preparing camera effects…':'No camera effects.'});
    const timer=window.setTimeout(()=>{
      void import('livekit-client').then(async({LocalVideoTrack})=>{
        if(!active())return;
        if(!hasCameraEffects(preference)&&!current.track){element.srcObject=stream;void element.play().catch(()=>{});return;}
        current.track ||= new LocalVideoTrack(current.raw.clone());const track=current.track;
        await applyCameraBackground(track,preference,value=>{if(active())setStatus(value);});
        if(!current.alive){await releaseCameraBackground(track);track.stop();return;}
        if(!active())return;
        // LiveKit mutates an element's srcObject when attaching a track. Keep
        // that presentation stream separate from the original capture that
        // Stop devices and the existing Join handoff still own.
        if(element.srcObject===stream)element.srcObject=new MediaStream();
        track.attach(element);element.muted=true;void element.play().catch(()=>{});
      }).catch(()=>{if(active())setStatus({state:'error',message:'The camera effects could not start. Use Reset All Effects or try again. Your meeting camera stays off if the selected effects cannot be prepared.'});if(!current.alive){void releaseCameraBackground(current.track).catch(()=>{});current.track?.stop();}});
    },200);
    return()=>{window.clearTimeout(timer);};
  },[stream,enabled,preference,video]);
  return status;
}
