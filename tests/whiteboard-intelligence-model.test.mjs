import test from 'node:test';import assert from 'node:assert/strict';import {performance} from 'node:perf_hooks';
import {templateDiagram,layoutDiagram,validateDiagram,sourceAnalysis,validateAnalysis,clusterEdits,diagramTemplates,offsetProposal} from '../frontend/src/lib/whiteboardIntelligence.js';
import {recognizeStroke} from '../frontend/src/lib/whiteboardGeometry.js';
import {validateElement} from '../frontend/src/lib/whiteboardModel.js';
const stroke=points=>validateElement({id:'ink',type:'pen',x:20,y:30,stroke:'#123456',strokeWidth:4,points});
const path=vertices=>vertices.flatMap((p,i)=>i?Array.from({length:20},(_,j)=>[vertices[i-1][0]+(p[0]-vertices[i-1][0])*(j+1)/20,vertices[i-1][1]+(p[1]-vertices[i-1][1])*(j+1)/20]).flat():p);
test('all templates produce bounded editable native objects; repeated layout is deterministic',()=>{
  for(const type of diagramTemplates){const plan=templateDiagram(type,'Synthetic planning topic'),elements=layoutDiagram(plan);assert.deepEqual(elements,layoutDiagram(plan));assert.ok(elements.length<=80);for(const e of elements)assert.deepEqual(e,validateElement(e));}
  const plan=templateDiagram('authentication');assert.ok(layoutDiagram(plan).some(e=>e.type==='arrow'));
  const map=layoutDiagram(templateDiagram('mindmap'));assert.ok(map.filter(e=>e.type==='sticky').some(e=>e.x>600));
  const swot=layoutDiagram(templateDiagram('swot'));assert.equal(swot.filter(e=>e.type==='rounded').length,4);
});
test('unsafe model fields, IDs, coordinates, connectors and cyclic rank graphs are rejected',()=>{
  const plan=templateDiagram('architecture');assert.throws(()=>validateDiagram({...plan,script:'alert(1)'}));assert.throws(()=>validateDiagram({...plan,nodes:plan.nodes.map(n=>({...n,x:123}))}));
  assert.throws(()=>validateDiagram({...plan,edges:[{from:'missing',to:'n1',type:'arrow'}]}));assert.throws(()=>validateDiagram({...plan,nodes:[{id:'__proto__',type:'text',text:'unsafe'}]}));
  assert.throws(()=>layoutDiagram({...plan,edges:[{from:'n0',to:'n1',type:'arrow'},{from:'n1',to:'n0',type:'arrow'}]}));
});
test('free-area placement does not overlap existing content',()=>{const elements=layoutDiagram(templateDiagram('swot')),current=[validateElement({id:'old',type:'sticky',x:0,y:0,width:800,height:600})];const placed=offsetProposal(elements,current);assert.ok(Math.min(...placed.map(e=>e.x))>800);});
const notes=[{id:'a',text:'Rahul will complete payment API integration by Friday.',version:1},{id:'b',text:'Decision: keep the current UI design.',version:1},{id:'c',text:'Login is blocked by slow authentication.',version:1},{id:'d',text:'TODO: fix latency',version:1}];
test('rule analysis preserves literal sources, themes, unknown owners and unresolved deadlines',()=>{
  const result=sourceAnalysis(notes);assert.equal(result.actions[0].owner,'Rahul');assert.equal(result.actions[0].deadline,'Friday');assert.equal(result.actions[1].owner,null);assert.equal(result.actions[1].deadline,null);assert.equal(result.decisions.length,1);
  const grouped=clusterEdits(result,notes);assert.ok(grouped.edits.every(e=>e.kind==='patch'&&Object.keys(e.patch).every(k=>['x','y'].includes(k))));assert.deepEqual(notes[0].text,'Rahul will complete payment API integration by Friday.');
});
test('model interpretations need valid sources; unsupported confirmed decisions and actions are rejected',()=>{
  const candidate={schemaVersion:1,title:'Review',executive:[{text:notes[0].text,sourceIds:['a']}],themes:[{title:'Work',sourceIds:notes.map(n=>n.id)}],actionIds:['a'],decisionIds:['b'],blockerIds:['c'],questionIds:[],suggestions:[]};
  assert.equal(validateAnalysis(candidate,notes).actions[0].owner,'Rahul');assert.throws(()=>validateAnalysis({...candidate,decisionIds:['c']},notes));assert.throws(()=>validateAnalysis({...candidate,actionIds:['c']},notes));assert.throws(()=>validateAnalysis({...candidate,executive:[{text:'Bad',sourceIds:['missing']}]},notes));
});
test('geometric recognition detects actual sampled rectangles, squares, triangles, lines and single-stroke arrows',()=>{
  for(const [kind,vertices] of [['rectangle',[[0,0],[180,1],[182,100],[0,102],[0,0]]],['square',[[0,0],[100,1],[102,100],[0,102],[0,0]]],['triangle',[[80,0],[160,140],[0,140],[80,0]]],['line',[[0,0],[70,25],[160,60]]],['arrow',[[0,0],[180,0],[150,-30],[180,0],[150,30]]]]){
    const original=stroke(path(vertices)),result=recognizeStroke(original);assert.ok(result,'Expected '+kind);assert.equal(result.kind,kind);assert.equal(result.element.stroke,'#123456');assert.equal(result.element.strokeWidth,4);assert.equal(original.type,'pen');assert.ok(result.confidence>=.88);
  }
});
test('sampled circles and ellipses fit; scribbles, dots and handwriting remain original ink',()=>{
  for(const [rx,ry,kind] of [[100,100,'circle'],[150,65,'ellipse']]){const pts=Array.from({length:100},(_,i)=>{const a=i/99*Math.PI*2,r=1+.01*Math.sin(i*3);return [rx+rx*Math.cos(a)*r,ry+ry*Math.sin(a)*r];}).flat();const result=recognizeStroke(stroke(pts));assert.ok(result);assert.equal(result.kind,kind);}
  assert.equal(recognizeStroke(stroke(path([[0,0],[80,100],[5,90],[100,5],[80,120],[0,5]]))),null);assert.equal(recognizeStroke(stroke([0,0,1,1,2,0,1,2])),null);
});
test('shape matching is independent of viewport zoom and has bounded latency',()=>{
  const e=stroke(path([[0,0],[180,0],[180,100],[0,100],[0,0]])),start=performance.now();for(let i=0;i<500;i++)assert.equal(recognizeStroke({...e,x:20*i}).kind,'rectangle');const elapsed=performance.now()-start;assert.ok(elapsed<5000);console.log('Geometry: '+(elapsed/500).toFixed(3)+' ms/stroke (500 synthetic strokes).');
});
