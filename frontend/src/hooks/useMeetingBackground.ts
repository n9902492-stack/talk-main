import { useEffect, useState } from 'react';
import { LocalVideoTrack, RoomEvent, Track, type Room } from 'livekit-client';
import { useBackgroundPreference } from './useBackgroundPreference';
import { applyCameraBackground, releaseCameraBackground, type BackgroundStatus } from '../lib/cameraBackground';
import { hasCameraEffects } from '../lib/backgroundCatalog';

export function useMeetingBackground(room: Room|null, enabled: boolean) {
  const {preference}=useBackgroundPreference();
  const [status,setStatus]=useState<BackgroundStatus>({state:'off',message:'No camera effects.'});
  const [track,setTrack]=useState<LocalVideoTrack|null>(null);
  useEffect(()=>{
    const sync=()=>{const camera=room?.localParticipant.getTrackPublication(Track.Source.Camera)?.videoTrack;setTrack(camera instanceof LocalVideoTrack?camera:null);};
    sync();room?.on(RoomEvent.LocalTrackPublished,sync).on(RoomEvent.LocalTrackUnpublished,sync);
    return()=>{room?.off(RoomEvent.LocalTrackPublished,sync).off(RoomEvent.LocalTrackUnpublished,sync);};
  },[room]);
  useEffect(()=>()=>{void releaseCameraBackground(track||undefined).catch(()=>{});},[track]);
  useEffect(()=>{
    if(!track)return;let active=true;
    if(!enabled){void releaseCameraBackground(track).catch(()=>{});setStatus(previous=>previous.state==='error'&&hasCameraEffects(preference)?previous:{state:'off',message:'Camera off. Effect processing stopped.'});return;}
    const timer=window.setTimeout(()=>{
      if(hasCameraEffects(preference))setStatus({state:'loading',message:'Preparing camera effects…'});
      void applyCameraBackground(track,preference,value=>{if(active)setStatus(value);}).catch(async()=>{
        // Keep unexpected initialization failures from publishing a raw camera silently.
        if(active){setStatus({state:'error',message:'The effects could not start. Camera paused. Use Reset All Effects, then enable your camera to continue.'});await room?.localParticipant.setCameraEnabled(false).catch(()=>{});}
      });
    },180);
    return()=>{active=false;window.clearTimeout(timer);};
  },[track,enabled,preference,room]);
  return {track,status};
}
