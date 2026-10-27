import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultVideoEffects, normalizeVideoEffects, hasVideoEffects, filterPresets, supportsNativeFraming, applyNativeFraming } from '../frontend/src/lib/videoEffects';
import { TalkCameraProcessor } from '../frontend/src/lib/cameraBackground';
import type { ProcessorOptions, Track } from 'livekit-client';

test('appearance defaults are neutral and malformed preferences cannot enable effects', () => {
  assert.equal(hasVideoEffects(defaultVideoEffects), false);
  for (const value of [undefined, null, false, 'bad', {}, {filter:'https://untrusted.invalid/filter'}]) {
    assert.deepEqual(normalizeVideoEffects(value), defaultVideoEffects);
  }
  const first=normalizeVideoEffects(null), second=normalizeVideoEffects(null);
  first.appearance.brightness=140;
  assert.equal(second.appearance.brightness,100);
  assert.equal(defaultVideoEffects.appearance.brightness,100);
});

test('appearance preferences clamp finite numeric values and discard arbitrary fields', () => {
  const value=normalizeVideoEffects({filter:'warm',appearance:{brightness:999,contrast:-1,saturation:999,warmth:-999,smoothing:100},studio:{autoLight:true,lowLight:false,portraitLight:true,enhance:false,autoFrame:true},externalSource:'https://untrusted.invalid/'});
  assert.deepEqual(value.appearance,{brightness:150,contrast:50,saturation:200,warmth:-50,smoothing:30});
  assert.equal(value.filter,'warm');
  assert.equal(hasVideoEffects(value),true);
  assert.equal('externalSource' in value,false);
  const invalid=normalizeVideoEffects({appearance:{brightness:NaN,contrast:Infinity,saturation:'150',warmth:null,smoothing:-Infinity}});
  assert.deepEqual(invalid.appearance,defaultVideoEffects.appearance);
});

test('every advertised filter can be selected, and studio switches are opt in', () => {
  const ids=['none','black-white','warm','cool','vintage','cinematic','soft-glow','high-contrast','natural'];
  assert.deepEqual(new Set(filterPresets.map(preset=>preset.id)),new Set(ids));
  for(const filter of ids) {
    const value=normalizeVideoEffects({filter});
    assert.equal(value.filter,filter);
    assert.equal(hasVideoEffects(value),filter!=='none');
  }
  for(const setting of ['autoLight','lowLight','portraitLight','enhance','autoFrame']) {
    assert.equal(hasVideoEffects(normalizeVideoEffects({studio:{[setting]:true}})),true);
  }
  assert.deepEqual(normalizeVideoEffects({studio:{autoLight:'true',lowLight:1,portraitLight:{},enhance:null,autoFrame:false}}).studio,defaultVideoEffects.studio);
});

test('native framing requires both browser and camera capabilities and confirmed application (API stubs)', async () => {
  // This checks capability handling with stubs, not real camera framing hardware.
  const original=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  let browserSupports=true,cameraSupports=true,enabled=false,confirm=true;
  const applied:MediaTrackConstraints[]=[];
  const track={
    getCapabilities:()=>({autoFraming:cameraSupports?[false,true]:[false]}),
    getConstraints:()=>({deviceId:{exact:'test-camera'},frameRate:{max:24}}),
    getSettings:()=>({autoFraming:confirm&&enabled}),
    applyConstraints:async(value:MediaTrackConstraints&{autoFraming?:boolean})=>{applied.push(value);enabled=value.autoFraming===true;},
  } as unknown as MediaStreamTrack;
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getSupportedConstraints:()=>({autoFraming:browserSupports})}}});
  try{
    assert.equal(supportsNativeFraming(),false,'browser support alone cannot advertise camera support');
    const legacyTrack={} as MediaStreamTrack;
    assert.equal(supportsNativeFraming(legacyTrack),false);
    await applyNativeFraming(legacyTrack,false);
    await assert.rejects(applyNativeFraming(legacyTrack,true),/not supported/);
    assert.equal(supportsNativeFraming(track),true);
    browserSupports=false;assert.equal(supportsNativeFraming(track),false);browserSupports=true;
    cameraSupports=false;assert.equal(supportsNativeFraming(track),false);
    await assert.rejects(applyNativeFraming(track,true),/not supported/);
    await applyNativeFraming(track,false);assert.equal(applied.length,0);
    cameraSupports=true;await applyNativeFraming(track,true);
    assert.deepEqual(applied[0],{deviceId:{exact:'test-camera'},frameRate:{max:24},autoFraming:true});
    confirm=false;await assert.rejects(applyNativeFraming(track,true),/could not enable/);
    await applyNativeFraming(track,false);assert.equal(enabled,false);
  }finally{if(original)Object.defineProperty(globalThis,'navigator',original);else delete(globalThis as any).navigator;}
});

test('camera restart cannot resurrect processing after external cancellation during teardown (lifecycle stubs)', async () => {
  // Exercise asynchronous resource disposal without claiming a physical camera test.
  const processor=new TalkCameraProcessor({mode:'none',blur:12});
  let finishCleanup!:()=>void,stopped=false;
  const cleanup=new Promise<void>(resolve=>{finishCleanup=resolve;});
  (processor as unknown as {delegate:{destroy:()=>Promise<void>}}).delegate={destroy:()=>cleanup};
  const options={track:{stop:()=>{stopped=true;}}} as unknown as ProcessorOptions<Track.Kind.Video>;
  const restarting=processor.restart(options);
  await processor.suspend();finishCleanup();
  await assert.rejects(restarting,/Camera stopped/);
  assert.equal(stopped,true);assert.equal(processor.suspended,true);
  assert.equal(processor.processedTrack,undefined);
  stopped=false;await assert.rejects(processor.restart(options),/Camera stopped/);assert.equal(stopped,true);
  const uninterrupted=new TalkCameraProcessor({mode:'none',blur:12});
  await uninterrupted.restart(options);
  assert.equal(uninterrupted.processedTrack,options.track);assert.equal(uninterrupted.suspended,false);
});
