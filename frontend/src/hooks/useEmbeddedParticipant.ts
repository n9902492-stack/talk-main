import { useEffect, type RefObject } from 'react';

type Slot = { x: number; y: number; width: number; height: number };

// Coordinates from the participant frames in the supplied 1280 x 720 recording.
// The small inset overlap covers the original participant and their name label.
function participantSlot(time: number): Slot | null {
  const frame = Math.floor(time * 24 + .0001);
  if (frame < 242) return null;
  if (frame >= 370 && frame < 410) return { x: 1013, y: 444, width: 244, height: 153 };
  const animation = [450, 451, 455, 464, 469, 474, 476, 478, 479, 478];
  const top = frame < 441 ? 450 : frame > 450 ? 478 : animation[frame - 441];
  return { x: 1013, y: top - 1, width: 244, height: 148 };
}

export function useEmbeddedParticipant(recording: RefObject<HTMLVideoElement | null>, tile: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const video = recording.current;
    const participant = tile.current;
    if (!video || !participant) return;
    let frame = 0;
    let lastPosition = '';
    const position = (time: number) => {
      const slot = participantSlot(time);
      participant.hidden = !slot;
      if (!slot) { lastPosition = ''; return; }
      const nextPosition = `${slot.x},${slot.y},${slot.width},${slot.height}`;
      if (nextPosition === lastPosition) return;
      lastPosition = nextPosition;
      participant.style.left = `${slot.x / 1280 * 100}%`;
      participant.style.top = `${slot.y / 720 * 100}%`;
      participant.style.width = `${slot.width / 1280 * 100}%`;
      participant.style.height = `${slot.height / 720 * 100}%`;
    };
    const synchronize = () => position(video.currentTime);
    const updateFrame: VideoFrameRequestCallback = (_now, metadata) => {
      position(metadata.mediaTime);
      frame = video.requestVideoFrameCallback(updateFrame);
    };
    synchronize();
    if (typeof video.requestVideoFrameCallback === 'function') frame = video.requestVideoFrameCallback(updateFrame);
    const events = ['loadeddata', 'seeking', 'seeked', 'timeupdate'];
    events.forEach(event => video.addEventListener(event, synchronize));
    return () => {
      if (frame) video.cancelVideoFrameCallback(frame);
      events.forEach(event => video.removeEventListener(event, synchronize));
    };
  }, [recording, tile]);
}
