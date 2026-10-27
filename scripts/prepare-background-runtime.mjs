import fs from 'node:fs';
import {createHash} from 'node:crypto';
const directory=new URL('../frontend/public/vendor/backgrounds/',import.meta.url);
fs.mkdirSync(directory,{recursive:true});
const source=new URL('../node_modules/@mediapipe/tasks-vision/wasm/',import.meta.url);
for(const name of fs.readdirSync(source).filter(name=>/\.(js|wasm)$/.test(name)))fs.copyFileSync(new URL(name,source),new URL(name,directory));
const files=fs.readdirSync(directory).filter(name=>/\.(wasm|js|tflite)$/.test(name));
fs.writeFileSync(new URL('SHA256SUMS',directory),files.map(name=>createHash('sha256').update(fs.readFileSync(new URL(name,directory))).digest('hex')+'  '+name).join('\n')+'\n');
fs.writeFileSync(new URL('NOTICE.txt',directory),'MediaPipe Tasks Vision 0.10.14 runtime: Copyright Google LLC, Apache License 2.0.\nSelfie Segmenter float16 v1: Google MediaPipe, Apache License 2.0.\nModel: https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite\nModel card: https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Selfie%20Segmentation.pdf\nSources: https://github.com/google-ai-edge/mediapipe\nSee LICENSE.txt for the Apache 2.0 license. No model modifications.\n');
const license=new URL('../node_modules/sharp/LICENSE',import.meta.url);
// Sharp and MediaPipe use Apache 2.0; copy only the standard license text.
fs.copyFileSync(license,new URL('LICENSE.txt',directory));
console.log('Local background runtime assets prepared.');
