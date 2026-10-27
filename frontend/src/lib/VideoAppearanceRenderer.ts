import { filterPresets, type VideoEffects } from './videoEffects';

const vertex = `#version 300 es
in vec2 position; out vec2 uv;
void main(){ uv=vec2(position.x*.5+.5, .5-position.y*.5); gl_Position=vec4(position,0.,1.); }`;
const fragment = `#version 300 es
precision highp float;
uniform sampler2D source; uniform vec2 texel; uniform vec4 adjustments;
uniform float smoothing; uniform float exposure; uniform float shadows;
uniform float portrait; uniform float enhance; uniform float detail; uniform int preset;
in vec2 uv; out vec4 outputColor;
float luma(vec3 c){return dot(c,vec3(.2126,.7152,.0722));}
vec3 sampleAt(vec2 p){return texture(source,clamp(p,vec2(0.),vec2(1.))).rgb;}
void main(){
 vec3 c=sampleAt(uv), base=c;
 float smoothAmount=max(smoothing,enhance*.12)*detail;
 if(smoothAmount>0. || (preset==6 && detail>0.)){
   vec3 sum=c; float weight=1.;
   for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++){
     if(x==0&&y==0)continue;
     vec3 n=sampleAt(uv+vec2(float(x),float(y))*texel*2.);
     float w=exp(-dot(n-c,n-c)*35.); sum+=n*w;weight+=w;
   }
   vec3 soft=sum/weight;
   // Broad skin-colour mask, not face recognition. Protect strong edges.
   float cb=.5-.168736*c.r-.331264*c.g+.5*c.b;
   float cr=.5+.5*c.r-.418688*c.g-.081312*c.b;
   float skin=smoothstep(.28,.34,cb)*(1.-smoothstep(.51,.56,cb))*smoothstep(.50,.56,cr)*(1.-smoothstep(.72,.79,cr));
   c=mix(c,soft,skin*smoothAmount);
   if(preset==6)c=mix(c,soft,.22)+soft*.035;
 }
 c*=exposure;
 c+=shadows*(1.-c)*(1.-c);
 float centre=exp(-dot((uv-vec2(.5,.43))*vec2(1.2,1.),(uv-vec2(.5,.43))*vec2(1.2,1.))*5.);
 c+=portrait*.12*centre*(1.-c);
 if(enhance>0.){ c=pow(max(c,vec3(0.)),vec3(.96)); c=mix(vec3(luma(c)),c,1.035); }
 if(preset==1)c=vec3(luma(c));
 if(preset==2)c*=vec3(1.09,1.015,.90);
 if(preset==3)c*=vec3(.90,1.015,1.10);
 if(preset==4){vec3 sep=vec3(dot(c,vec3(.393,.769,.189)),dot(c,vec3(.349,.686,.168)),dot(c,vec3(.272,.534,.131)));c=mix(c,sep,.4);c=c*.88+.055;}
 if(preset==5){float l=luma(c);c=mix(vec3(l),c,.82);c=(c-.5)*1.13+.5;c+=vec3(-.018,.012,.025)*(1.-l);c*=1.-.13*dot(uv-.5,uv-.5);}
 if(preset==6)c=(c-.5)*.93+.54;
 if(preset==7)c=(c-.5)*1.35+.5;
 if(preset==8){c=(c-.5)*1.035+.5;c=mix(vec3(luma(c)),c,1.07);}
 c*=adjustments.x;
 c=(c-.5)*adjustments.y+.5;
 c=mix(vec3(luma(c)),c,adjustments.z);
 c*=vec3(1.+adjustments.w*.16,1.+adjustments.w*.025,1.-adjustments.w*.16);
 outputColor=vec4(clamp(c,0.,1.),1.);
}`;

/** A single GPU grading pass after segmentation. No extra capture or published track. */
export class VideoAppearanceRenderer {
  private canvas = new OffscreenCanvas(2, 2);
  private gl: WebGL2RenderingContext;
  private program!: WebGLProgram;
  private texture!: WebGLTexture;
  private buffer!: WebGLBuffer;
  private uniforms = new Map<string,WebGLUniformLocation|null>();
  private meter = new OffscreenCanvas(32, 18);
  private meterContext = this.meter.getContext('2d', { willReadFrequently: true });
  private luminance = .45;
  private lastMeter = -Infinity;
  constructor() {
    const gl = this.canvas.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('Video appearance processing is unavailable.'); this.gl = gl;
    const shaders:WebGLShader[]=[];
    try {
    const compile = (type: number, text: string) => {
      const shader = gl.createShader(type)!; gl.shaderSource(shader, text); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { gl.deleteShader(shader); throw new Error('Video effects shader could not start.'); } shaders.push(shader);return shader;
    };
    const vs = compile(gl.VERTEX_SHADER, vertex), fs = compile(gl.FRAGMENT_SHADER, fragment);
    this.program = gl.createProgram()!; gl.attachShader(this.program, vs); gl.attachShader(this.program, fs); gl.linkProgram(this.program);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error('Video effects shader could not link.');
    for(const name of ['texel','adjustments','smoothing','detail','exposure','shadows','portrait','enhance','preset'])this.uniforms.set(name,gl.getUniformLocation(this.program,name));
    gl.useProgram(this.program);
    this.buffer = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(this.program, 'position'); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    this.texture = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }catch(error){this.destroy();throw error;}finally{shaders.forEach(shader=>gl.deleteShader(shader));}
  }
  measure(frame: VideoFrame, now: number) {
    if (now-this.lastMeter < 500 || !this.meterContext) return;
    this.lastMeter = now; this.meterContext.drawImage(frame, 0, 0, 32, 18);
    const pixels = this.meterContext.getImageData(0, 0, 32, 18).data; let sum = 0;
    for (let i=0; i<pixels.length; i+=4) sum += pixels[i]*.2126 + pixels[i+1]*.7152 + pixels[i+2]*.0722;
    const measured=sum/(32*18*255); this.luminance=this.luminance*.35+measured*.65;
  }
  render(frame: VideoFrame, effects: VideoEffects, quality: number) {
    const gl=this.gl, cap=quality===0?1280:quality===1?960:640;
    if(gl.isContextLost())throw new Error('Video effects graphics context was lost.');
    const scale=Math.min(1,cap/frame.displayWidth);
    const width=Math.max(2,Math.round(frame.displayWidth*scale)), height=Math.max(2,Math.round(frame.displayHeight*scale));
    if(this.canvas.width!==width||this.canvas.height!==height){this.canvas.width=width;this.canvas.height=height;}
    gl.viewport(0,0,width,height); gl.useProgram(this.program); gl.bindTexture(gl.TEXTURE_2D,this.texture);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,frame);
    const uniform=(name:string)=>this.uniforms.get(name)!, a=effects.appearance,s=effects.studio;
    gl.uniform2f(uniform('texel'),1/frame.displayWidth,1/frame.displayHeight);
    gl.uniform4f(uniform('adjustments'),a.brightness/100,a.contrast/100,a.saturation/100,a.warmth/50);
    gl.uniform1f(uniform('smoothing'),quality<2?a.smoothing/100:0);
    gl.uniform1f(uniform('detail'),quality<2?1:0);
    gl.uniform1f(uniform('exposure'),s.autoLight?Math.max(.75,Math.min(1.65,.46/Math.max(.08,this.luminance))):1);
    gl.uniform1f(uniform('shadows'),s.lowLight?Math.max(.03,Math.min(.24,(.52-this.luminance)*.5)):0);
    gl.uniform1f(uniform('portrait'),s.portraitLight?1:0);gl.uniform1f(uniform('enhance'),s.enhance?1:0);
    gl.uniform1i(uniform('preset'),filterPresets.findIndex(p=>p.id===effects.filter));
    gl.drawArrays(gl.TRIANGLES,0,6);
    return new VideoFrame(this.canvas,{timestamp:frame.timestamp,...(frame.duration?{duration:frame.duration}:{})});
  }
  destroy(){const gl=this.gl;if(this.texture)gl.deleteTexture(this.texture);if(this.buffer)gl.deleteBuffer(this.buffer);if(this.program)gl.deleteProgram(this.program);gl.getExtension('WEBGL_lose_context')?.loseContext();this.canvas.width=this.canvas.height=1;this.meter.width=this.meter.height=1;}
}
