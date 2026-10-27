import type { LocalVideoTrack, ProcessorOptions, Track, TrackProcessor } from 'livekit-client';
import type { BackgroundTransformer, ProcessorWrapper, VideoTransformerInitOptions } from '@livekit/track-processors';
import { backgroundImage, hasCameraEffects, normalizeBackground, type BackgroundPreference } from './backgroundCatalog';
import { applyNativeFraming, hasVideoEffects, normalizeVideoEffects, supportsVideoAppearance } from './videoEffects';
import { VideoAppearanceRenderer } from './VideoAppearanceRenderer';

export type BackgroundStatus = { state: 'off' | 'loading' | 'active' | 'error' | 'unsupported'; message: string; processingMs?: number; fpsLimit?: number; quality?: number };
let processorModule: Promise<typeof import('@livekit/track-processors')> | undefined;
const load = () => processorModule ||= import('@livekit/track-processors');
export async function supportsCameraBackgrounds() {
  try { return window.isSecureContext && (await load()).supportsBackgroundProcessors(); } catch { return false; }
}

/** One input reader and output generator. Segmentation and grading share each frame. */
class CoordinatedTransformer {
  transformer = new TransformStream<VideoFrame, VideoFrame>({ transform: (frame, controller) => this.transform(frame, controller) });
  private background?: BackgroundTransformer;
  private renderer?: VideoAppearanceRenderer;
  private options?: VideoTransformerInitOptions;
  private destroyed = false;
  private busy = false;
  private lastFrame = -Infinity;
  private lastReport = 0;
  private average = 0;
  private slowFrames = 0;
  private quality = 0;
  private resize = new OffscreenCanvas(2,2);
  private resizeContext = this.resize.getContext('2d');
  constructor(private preference: BackgroundPreference, private report: (status: BackgroundStatus) => void) {}
  async init(options: VideoTransformerInitOptions) {
    this.options = options;
    if (hasVideoEffects(this.preference.effects)) this.renderer = new VideoAppearanceRenderer();
    await this.prepareBackground(this.preference);
    if(this.destroyed) { await this.destroy(); throw new Error('Camera stopped'); }
  }
  private async prepareBackground(next: BackgroundPreference) {
    if(next.mode==='none') { const old=this.background;this.background=undefined;await old?.destroy();return; }
    const imagePath=backgroundImage(next);
    if(imagePath) { const image=new Image();image.src=imagePath;await image.decode(); }
    if(this.destroyed)throw new Error('Camera stopped');
    const configuration={blurRadius:next.mode==='blur'?next.blur:undefined,imagePath,backgroundDisabled:false};
    if(this.background){await this.background.update(configuration);return;}
    const sdk=await load();
    if(!sdk.supportsBackgroundProcessors())throw new Error('Background processing is unavailable.');
    const stage=new sdk.BackgroundTransformer({...configuration,assetPaths:{tasksVisionFileSet:'/vendor/backgrounds',modelAssetPath:'/vendor/backgrounds/selfie-segmenter-v1.tflite'}});
    const canvas=new OffscreenCanvas(this.options!.outputCanvas.width,this.options!.outputCanvas.height);
    try {
      await stage.init({...this.options!,outputCanvas:canvas});stage.isFirstFrame=false;
      if(this.destroyed)throw new Error('Camera stopped');
      this.background=stage;
    }catch(error){await stage.destroy();throw error;}
  }
  async update(options: { preference: BackgroundPreference }) {
    const next=normalizeBackground(options.preference);
    // Keep the previous processed stream while new assets initialize.
    const before=this.preference;
    if(before.mode!==next.mode||before.blur!==next.blur||before.presetId!==next.presetId||before.customVersion!==next.customVersion)await this.prepareBackground(next);
    if(this.destroyed)throw new Error('Camera stopped');
    if(hasVideoEffects(next.effects)&&!this.renderer)this.renderer=new VideoAppearanceRenderer();
    this.preference=next;
  }
  async transform(frame: VideoFrame, controller: TransformStreamDefaultController<VideoFrame>) {
    const now=performance.now(),fps=this.quality===0?24:this.quality===1?15:10;
    if(this.destroyed||this.busy||now-this.lastFrame<1000/fps-2){frame.close();return;}
    this.busy=true;this.lastFrame=now;
    const effects=normalizeVideoEffects(this.preference.effects);
    let callbackFailure:unknown,frameOwned=true;
    const output=(processed:VideoFrame)=>{
      if(this.destroyed){processed.close();return;}
      if(this.renderer&&hasVideoEffects(effects)){
        try{controller.enqueue(this.renderer.render(processed,effects,this.quality));}catch(error){callbackFailure=error;}finally{processed.close();}
      }else controller.enqueue(processed);
    };
    try {
      if(effects.studio.autoLight||effects.studio.lowLight)this.renderer?.measure(frame,now);
      const cap=this.quality===0?1280:this.quality===1?960:640;
      if(frame.displayWidth>cap&&this.resizeContext){
        this.resize.width=cap;this.resize.height=Math.round(frame.displayHeight*cap/frame.displayWidth);
        this.resizeContext.drawImage(frame,0,0,this.resize.width,this.resize.height);
        const smaller=new VideoFrame(this.resize,{timestamp:frame.timestamp});frame.close();frame=smaller;
      }
      frameOwned=false;
      if(this.background)await this.background.transform(frame,{enqueue:output} as TransformStreamDefaultController);
      else output(frame);
      if(callbackFailure)throw callbackFailure;
    }catch(error){this.report({state:'error',message:'Video processing stopped. Reset All Effects or enable your camera again.'});throw error;}
    finally{
      this.busy=false;
      if(frameOwned)frame.close();
      const duration=performance.now()-now;this.average=this.average?this.average*.9+duration*.1:duration;
      if(this.average>(this.quality===0?48:80))this.slowFrames++;else this.slowFrames=Math.max(0,this.slowFrames-1);
      if(this.slowFrames>=20&&this.quality<2){this.quality++;this.slowFrames=0;}
      if(now-this.lastReport>1500&&!this.destroyed){this.lastReport=now;this.report({state:'active',message:this.quality?'Camera effects active. Reduced processing quality to keep your meeting responsive.':'Camera effects active.',processingMs:Math.round(this.average),fpsLimit:this.quality===0?24:this.quality===1?15:10,quality:this.quality});}
    }
  }
  async restart(options: VideoTransformerInitOptions){await this.destroy();this.destroyed=false;await this.init(options);}
  async destroy(){this.destroyed=true;const stage=this.background;this.background=undefined;await stage?.destroy();this.renderer?.destroy();this.renderer=undefined;this.resize.width=this.resize.height=1;}
}

export class TalkCameraProcessor implements TrackProcessor<Track.Kind.Video> {
  name='talk-camera-effects'; processedTrack?:MediaStreamTrack;
  private delegate?:ProcessorWrapper<{preference:BackgroundPreference},CoordinatedTransformer>;
  private source?:MediaStreamTrack;
  private original?:MediaStreamTrack;
  private ended=false;
  private revision=0;
  private transformer?:CoordinatedTransformer;
  preference:BackgroundPreference; suspended=false;
  constructor(preference:BackgroundPreference,private report:(status:BackgroundStatus)=>void=()=>{}){this.preference=normalizeBackground(preference);}
  setReporter(report?:(status:BackgroundStatus)=>void){if(report)this.report=report;}
  getSourceTrack(){return this.original;}
  async init(options:ProcessorOptions<Track.Kind.Video>){
    this.original=options.track;
    if(this.ended){options.track.stop();throw new Error('Camera stopped');}
    if(!hasCameraEffects(this.preference)){this.processedTrack=options.track;return;}
    this.report({state:'loading',message:'Preparing camera effects…'});
    const sdk=await load();
    if(this.ended)throw new Error('Camera stopped');
    if(!sdk.ProcessorWrapper.isSupported||!supportsVideoAppearance()){this.report({state:'unsupported',message:'Camera effects unavailable. Reset All Effects to use your regular camera.'});throw new Error('Camera effects unsupported');}
    let prepared:typeof this.delegate;
    try{
      await applyNativeFraming(options.track,normalizeVideoEffects(this.preference.effects).studio.autoFrame);
      try{await options.track.applyConstraints({...options.track.getConstraints(),frameRate:{ideal:24,max:24}});}catch{/* Some cameras cannot cap FPS. */}
      if(this.ended)throw new Error('Camera stopped');
      const transformer=new CoordinatedTransformer(this.preference,value=>{if(!this.ended)this.report(value);});this.transformer=transformer;
      const delegate=new sdk.ProcessorWrapper<{preference:BackgroundPreference},CoordinatedTransformer>(transformer,this.name,{maxFps:24});this.delegate=delegate;prepared=delegate;
      this.source=options.track.clone();
      await delegate.init({...options,track:this.source});
      if(this.ended)throw new Error('Camera stopped');
      this.processedTrack=delegate.processedTrack;this.report({state:'active',message:'Camera effects active.'});
    }catch(error){
      await this.destroy();
      // Pinned SDK 0.8.2 skips destroy while initializing, including partial setup.
      // Stop those allocated outputs as well, so failed/canceled initialization leaks none.
      prepared?.trackGenerator?.stop();prepared?.processedTrack?.stop();
      (prepared as unknown as {capturedStream?:MediaStream})?.capturedStream?.getTracks().forEach(track=>track.stop());
      prepared?.displayCanvas?.remove();
      throw error;
    }
  }
  async switchTo(preference:BackgroundPreference){
    const next=normalizeBackground(preference);
    if(!this.delegate||this.suspended||this.ended||!hasCameraEffects(next))return false;
    await applyNativeFraming(this.original!,normalizeVideoEffects(next.effects).studio.autoFrame);
    await this.transformer!.update({preference:next});
    if(this.ended)throw new Error('Camera stopped');
    this.preference=next;this.report({state:'active',message:'Camera effects active.'});return true;
  }
  async suspend(){this.suspended=true;await this.destroy();}
  async restart(options:ProcessorOptions<Track.Kind.Video>){
    if(this.ended||this.suspended){options.track.stop();throw new Error('Camera stopped');}
    const cleanup=this.destroy(),revision=this.revision;
    await cleanup;
    if(revision!==this.revision){options.track.stop();throw new Error('Camera stopped');}
    this.ended=false;this.suspended=false;
    try{await this.init(options);}catch(error){options.track.stop();throw error;}
  }
  async destroy(){
    this.revision++;this.ended=true;this.source?.stop();this.source=undefined;this.processedTrack?.stop();
    const delegate=this.delegate;this.delegate=undefined;
    await delegate?.destroy();
    // Wrapper.destroy does nothing during failed initialization: clean the stage too.
    await this.transformer?.destroy();this.transformer=undefined;
  }
}
const queues=new WeakMap<LocalVideoTrack,Promise<unknown>>();
const pending=new WeakMap<LocalVideoTrack,TalkCameraProcessor>();
const generations=new WeakMap<LocalVideoTrack,number>();
export function applyCameraBackground(track:LocalVideoTrack,preference:BackgroundPreference,report?:(status:BackgroundStatus)=>void){
  const generation=generations.get(track)||0;
  const operation=(queues.get(track)||Promise.resolve()).catch(()=>{}).then(async()=>{
    if(generation!==(generations.get(track)||0))throw new Error('Camera stopped');
    const current=track.getProcessor();if(current instanceof TalkCameraProcessor)current.setReporter(report);
    if(track.mediaStreamTrack.readyState==='ended'&&!(current instanceof TalkCameraProcessor&&current.suspended))throw new Error('Camera stopped');
    const next=normalizeBackground(preference);
    if(!hasCameraEffects(next)){
      if(current instanceof TalkCameraProcessor&&current.getSourceTrack())await applyNativeFraming(current.getSourceTrack()!,false);
      if(current)await track.stopProcessor();report?.({state:'off',message:'No camera effects.'});return;
    }
    if(current instanceof TalkCameraProcessor&&JSON.stringify(current.preference)===JSON.stringify(next)&&!current.suspended){report?.({state:'active',message:'Camera effects active.'});return;}
    if(current instanceof TalkCameraProcessor&&await current.switchTo(next))return;
    const processor=new TalkCameraProcessor(next,report);pending.set(track,processor);
    try{await track.setProcessor(processor);if(generation!==(generations.get(track)||0)){await processor.suspend();throw new Error('Camera stopped');}}
    catch(error){await processor.destroy();throw error;}finally{if(pending.get(track)===processor)pending.delete(track);}
  });queues.set(track,operation);return operation;
}
export async function releaseCameraBackground(track?:LocalVideoTrack){
  if(!track)return;generations.set(track,(generations.get(track)||0)+1);
  const current=track.getProcessor(),initializing=pending.get(track);
  await Promise.all([current instanceof TalkCameraProcessor?current.suspend():undefined,initializing?.suspend()]);
}
