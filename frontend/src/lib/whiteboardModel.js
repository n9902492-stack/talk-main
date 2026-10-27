// Shared wire-format validation. Whiteboard data is never executable markup.
export const whiteboardTools = ['select','hand','pen','highlighter','eraser','text','sticky','rectangle','rounded','ellipse','line','arrow','image'];
export const elementTypes = whiteboardTools.filter(value => !['select','hand','eraser'].includes(value));
export const elementFields = ['x','y','width','height','rotation','stroke','fill','strokeWidth','opacity','fontSize','text','points','imageId'];
export const boardLimits = Object.freeze({ elements: 1200, points: 2048, stateBytes: 3 * 1024 * 1024, historyBytes: 32 * 1024 * 1024, operations: 20000 });
const invalid = () => { const error = new Error('Invalid whiteboard data.'); error.code = 'invalid_whiteboard'; throw error; };
export const validObjectId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value) && !['__proto__','constructor','prototype'].includes(value);
const number = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
export function validateElement(input, partial = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => ![...elementFields,'id','type','version'].includes(key))) invalid();
  if (!partial && (!validObjectId(input.id) || !elementTypes.includes(input.type))) invalid();
  const result = partial ? {} : { id: input.id, type: input.type, x: 0, y: 0, width: 160, height: 100, rotation: 0,
    stroke: '#2678b7', fill: 'none', strokeWidth: 3, opacity: 1, fontSize: 22, text: '', points: [], imageId: null };
  for (const key of Object.keys(input)) {
    const value = input[key];
    if (['id','type','version'].includes(key)) { if (partial) invalid(); continue; }
    if (['x','y'].includes(key) && !number(value,-100000,100000)
      || ['width','height'].includes(key) && !number(value,1,10000)
      || key === 'rotation' && !number(value,-360,360)
      || key === 'strokeWidth' && !number(value,1,50)
      || key === 'opacity' && !number(value,0.05,1)
      || key === 'fontSize' && !number(value,10,96)
      || ['stroke','fill'].includes(key) && !(value === 'none' || typeof value === 'string' && /^#[a-f\d]{6}$/i.test(value))
      || key === 'text' && !(typeof value === 'string' && value.length <= 4000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))
      || key === 'imageId' && !(value === null || validObjectId(value))
      || key === 'points' && !(Array.isArray(value) && value.length <= boardLimits.points * 2 && value.length % 2 === 0 && value.every(point => number(point,-200000,200000)))) invalid();
    result[key] = value;
  }
  return result;
}
export function boardBounds(elements) {
  if (!elements.length) return { x: 0, y: 0, width: 1000, height: 650 };
  const boxes = elements.map(element => {
    const pts = element.points?.length ? element.points : [0,0,element.width,element.height];
    // Rotation-safe enclosing square (conservative, keeps exports unclipped).
    const xs = pts.filter((_,i) => i % 2 === 0), ys = pts.filter((_,i) => i % 2 === 1);
    let x = Math.min(...xs), y = Math.min(...ys), width = Math.max(1, Math.max(...xs)-x), height = Math.max(1,Math.max(...ys)-y);
    if (element.rotation) { const radius = Math.hypot(Math.max(Math.abs(x),Math.abs(x+width)),Math.max(Math.abs(y),Math.abs(y+height))); x = -radius; y = -radius; width = height = radius * 2; }
    return { x: element.x+x, y: element.y+y, width, height };
  });
  const x = Math.min(...boxes.map(box=>box.x))-40, y = Math.min(...boxes.map(box=>box.y))-40;
  return { x, y, width: Math.max(...boxes.map(box=>box.x+box.width))-x+40, height: Math.max(...boxes.map(box=>box.y+box.height))-y+40 };
}
// Deterministic line breaks shared by canvas and server exports. Font rendering
// may differ slightly across operating systems; content and wrapping do not.
export function whiteboardTextLines(element) {
  const available=Math.max(10,element.width-16),lines=[];
  const advance=char=>element.fontSize*(/[\p{Mark}]/u.test(char)?0:/[ilI.,'!:;| ]/.test(char)?.28:/[MW@#%]/.test(char)?.9:/[\u0000-\u007f]/.test(char)?.56:.85);
  for(const paragraph of element.text.split('\n')){
    let line='',width=0;
    for(const word of paragraph.split(/(\s+)/)){
      const wordWidth=[...word].reduce((sum,char)=>sum+advance(char),0);
      if(line&&width+wordWidth>available){lines.push(line.trimEnd());line='';width=0;}
      for(const char of word){const size=advance(char);if(line&&width+size>available){lines.push(line);line='';width=0;}if(!line&&/\s/.test(char))continue;line+=char;width+=size;}
    }lines.push(line);
  }return lines;
}
