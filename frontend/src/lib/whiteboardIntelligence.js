import {validateElement,validObjectId,boardBounds,whiteboardTextLines} from './whiteboardModel.js';

export const diagramLayouts=['horizontal','vertical','grid','flowchart','mindmap','swot','kanban','roadmap','architecture'];
export const diagramTemplates=['swot','authentication','mindmap','roadmap','planning','architecture','brainstorm','kanban'];
const bad=()=>{throw new Error('The proposal contains invalid or unsupported canvas data.');};
const keys=(value,allowed)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>allowed.includes(k));
const text=(value,max=600)=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const colors=['#d7ecff','#d8f2e3','#fff0ad','#ffe1ed'];

// Semantic layout instructions are transient, not a second saved canvas model.
// Model-supplied coordinates, colors, executable content and permissions cannot
// enter this format. Every output is validated again as a native board element.
export function validateDiagram(input){
  if(!keys(input,['schemaVersion','title','layout','nodes','edges'])||input.schemaVersion!==1||!text(input.title,160)||!diagramLayouts.includes(input.layout)
    ||!Array.isArray(input.nodes)||!input.nodes.length||input.nodes.length>24||!Array.isArray(input.edges)||input.edges.length>24)bad();
  const ids=new Set();
  for(const node of input.nodes){
    if(!keys(node,['id','type','text','section'])||!validObjectId(node.id)||ids.has(node.id)||!['rectangle','rounded','ellipse','text','sticky'].includes(node.type)||!text(node.text,160)
      ||node.section!==undefined&&(!Number.isInteger(node.section)||node.section<0||node.section>3))bad();
    ids.add(node.id);
  }
  for(const edge of input.edges)if(!keys(edge,['from','to','type'])||!ids.has(edge.from)||!ids.has(edge.to)||edge.from===edge.to||!['arrow','line'].includes(edge.type))bad();
  if(['swot','kanban'].includes(input.layout)&&input.nodes.some(n=>n.section===undefined||n.section>=(input.layout==='swot'?4:3)))bad();
  return structuredClone(input);
}

export function templateDiagram(template,prompt=''){
  if(!diagramTemplates.includes(template)||!text(prompt,2000))bad();
  const title=prompt.trim().slice(0,140)||'Untitled planning board';let nodes=[],edges=[],layout='grid';
  const make=(label,index,section)=>({id:'n'+index,type:'sticky',text:label,...(section===undefined?{}:{section})});
  if(template==='swot'){layout='swot';nodes=['Add a verified strength','Add a verified weakness','Explore an opportunity','Identify a possible threat'].map((s,i)=>make(s,i,i));}
  else if(template==='kanban'){layout='kanban';nodes=['Add a task to do','Add work in progress','Add completed work'].map((s,i)=>make(s,i,i));}
  else if(template==='authentication'){layout='flowchart';nodes=['Enter email and password','Validate credentials','Verify email if needed','Create secure session','Open dashboard'].map((s,i)=>({...make(s,i),type:'rounded'}));}
  else if(template==='architecture'){layout='architecture';nodes=['React frontend','Node.js backend','PostgreSQL storage','LiveKit media'].map((s,i)=>({...make(s,i),type:'rounded'}));edges=[{from:'n0',to:'n1',type:'arrow'},{from:'n1',to:'n2',type:'arrow'},{from:'n1',to:'n3',type:'arrow'}];}
  else if(template==='mindmap'){layout='mindmap';nodes=['Central idea','People','Product','Process','Next steps'].map((s,i)=>make(s,i));edges=nodes.slice(1).map(n=>({from:'n0',to:n.id,type:'line'}));}
  else if(template==='roadmap'){layout='roadmap';nodes=['Discover','Plan','Build','Validate','Launch'].map((s,i)=>make(s,i));}
  else if(template==='planning')nodes=['Goal: add your goal','Scope: describe the work','Owners: add confirmed names','Risks: identify blockers','Next steps: agree actions'].map((s,i)=>make(s,i));
  else nodes=['What is working?','What needs improvement?','New ideas','Questions to explore'].map((s,i)=>make(s,i));
  if(['authentication','roadmap'].includes(template))edges=nodes.slice(1).map((n,i)=>({from:nodes[i].id,to:n.id,type:'arrow'}));
  return validateDiagram({schemaVersion:1,title,layout,nodes,edges});
}

export function layoutDiagram(raw){
  const plan=validateDiagram(raw),result=[],positions=new Map();
  const add=(value)=>{const e=validateElement({...value,id:'proposal-'+result.length});result.push(e);return e;};
  const titleHeight=Math.max(60,whiteboardTextLines({width:1000,fontSize:30,text:plan.title}).length*36+20);
  add({type:'text',x:0,y:0,width:1000,height:titleHeight,fontSize:30,text:plan.title,stroke:'#17496d'});
  const columns=plan.layout==='swot'?2:plan.layout==='kanban'?3:Math.ceil(Math.sqrt(plan.nodes.length));
  const counts=[0,0,0,0];
  let levels=new Map();
  if(['flowchart','architecture'].includes(plan.layout)){
    const remaining=new Set(plan.nodes.map(n=>n.id));
    while(remaining.size){const ready=[...remaining].filter(id=>!plan.edges.some(e=>e.to===id&&remaining.has(e.from)));if(!ready.length)bad();
      for(const id of ready){levels.set(id,Math.max(0,...plan.edges.filter(e=>e.to===id).map(e=>(levels.get(e.from)||0)+1)));remaining.delete(id);}}
  }
  const rankCounts=new Map();
  for(let i=0;i<plan.nodes.length;i++){
    const n=plan.nodes[i];let x=0,y=90,w=240,h=Math.max(110,whiteboardTextLines({width:240,fontSize:18,text:n.text}).length*22+24);
    if(['swot','kanban'].includes(plan.layout)){
      const s=n.section,col=s%columns,row=plan.layout==='swot'?Math.floor(s/2):0,index=counts[s]++;
      const max=Math.max(...[0,1,2,3].map(section=>plan.nodes.filter(node=>node.section===section).length));
      x=col*310+20;y=150+row*(max*330+100)+index*330;
    }else if(plan.layout==='mindmap'){
      if(i===0){x=420;y=180+Math.ceil((plan.nodes.length-1)/2)*165;}
      else {const side=i%2?0:840,branch=Math.floor((i-1)/2);x=side;y=100+branch*330;}
    }else if(['flowchart','architecture'].includes(plan.layout)){
      const rank=levels.get(n.id)||0,index=rankCounts.get(rank)||0;rankCounts.set(rank,index+1);x=rank*330;y=100+index*330;
    }else if(['horizontal','roadmap'].includes(plan.layout)){x=i*330;y=100;}
    else if(plan.layout==='vertical'){x=0;y=100+i*330;}
    else{x=(i%columns)*330;y=100+Math.floor(i/columns)*330;}
    positions.set(n.id,{x,y,w,h});
  }
  if(['swot','kanban'].includes(plan.layout)){
    const headings=plan.layout==='swot'?['Strengths','Weaknesses','Opportunities','Threats']:['To Do','In Progress','Done'];
    const max=Math.max(1,...counts);
    headings.forEach((label,s)=>{const x=(s%columns)*310,y=90+(plan.layout==='swot'?Math.floor(s/2)*(max*330+100):0);
      add({type:'rounded',x,y,width:290,height:max*330+65,stroke:'#b9d0e5',fill:'#f4f8fc',strokeWidth:1});add({type:'text',x:x+15,y:y+10,width:260,height:45,fontSize:24,text:label});});
  }
  // Orthogonal paths are routed in rank gutters. Connectors are ordinary lines
  // or arrows; moving a node does not yet provide persistent connector binding.
  for(const edge of plan.edges){const a=positions.get(edge.from),b=positions.get(edge.to),right=b.x>=a.x;
    const start={x:a.x+(right?a.w:0),y:a.y+a.h/2},end={x:b.x+(right?0:b.w),y:b.y+b.h/2},mx=(start.x+end.x)/2;
    add({type:edge.type,x:start.x,y:start.y,width:Math.max(1,Math.abs(end.x-start.x)),height:Math.max(1,Math.abs(end.y-start.y)),points:[0,0,mx-start.x,0,mx-start.x,end.y-start.y,end.x-start.x,end.y-start.y],stroke:'#6b8fae',strokeWidth:2});
  }
  for(const n of plan.nodes){const p=positions.get(n.id);add({type:n.type,x:p.x,y:p.y,width:p.w,height:p.h,text:n.text,fill:n.type==='text'?'none':colors[n.section??0],fontSize:18,stroke:'#204563',strokeWidth:1});
    if(['rectangle','rounded','ellipse'].includes(n.type))add({type:'text',x:p.x+8,y:p.y+8,width:p.w-16,height:p.h-16,fontSize:18,text:n.text,stroke:'#204563'});
  }
  if(result.length>80)bad();return result.map((e,i)=>i?validateElement({...e,y:e.y+titleHeight-60}):e);
}

export function offsetProposal(elements,current,mode='new-area',point={x:0,y:0}){
  const old=boardBounds(current),generated=boardBounds(elements);
  const dx=mode==='new-area'?(current.length?old.x+old.width+100:100)-generated.x:point.x-generated.x;
  const dy=mode==='new-area'?100-generated.y:point.y-generated.y;
  return elements.map(e=>validateElement({...e,x:e.x+dx,y:e.y+dy}));
}

// Offline theme classification is explicitly labelled rules, not model output.
const themes=[['Authentication',/login|sign.?in|password|auth|otp|लॉगिन|पासवर्ड/i],['User Interface',/\bui\b|design|layout|interface|button|डिजाइन/i],['Payments',/payment|billing|invoice|checkout|भुगतान/i],['Customer Experience',/customer|feedback|support|ग्राहक/i],['Performance',/performance|slow|latency|speed|memory|धीम/i]];
export function sourceAnalysis(sources,title='Brainstorm review'){
  const groups=new Map(),actions=[],decisions=[],blockers=[],questions=[];
  for(const note of sources){
    const theme=themes.find(([,pattern])=>pattern.test(note.text))?.[0]||'Other ideas';if(!groups.has(theme))groups.set(theme,[]);groups.get(theme).push(note.id);
    const item={text:note.text,sourceIds:[note.id],owner:null,deadline:null,status:'proposed'};
    if(/^(?:decision\s*:|we (?:have )?decided\b|agreed\s*:|निर्णय\s*:|फैसला\s*:)/i.test(note.text.trim()))decisions.push(item);
    if(/^(?:action\s*:|todo\s*:|task\s*:|कार्य\s*:)|\bwill\s+\w|\bkar(?:ega|egi|enge)\b/i.test(note.text)){
      const owner=/^(?:action:\s*)?([\p{L}][\p{L} .'-]{0,55}?)\s+will\s/iu.exec(note.text)?.[1]?.trim()||null;
      const deadline=/\bby\s+([^.!?\n]{1,70})/i.exec(note.text)?.[1]?.trim()||null;
      actions.push({...item,owner,deadline});
    }
    if(/block(?:ed|er)|risk|waiting on|बाधा|जोखिम|ruka/i.test(note.text))blockers.push(item);
    if(note.text.trim().endsWith('?'))questions.push(item);
  }
  return {schemaVersion:1,title,executive:sources.slice(0,4).map(s=>({text:s.text,sourceIds:[s.id]})),points:sources.map(s=>({text:s.text,sourceIds:[s.id]})),
    themes:[...groups].map(([title,sourceIds])=>({title,sourceIds})),actions,decisions,blockers,questions,suggestions:['Review source notes and confirm any proposed actions with the team.']};
}

export function validateAnalysis(input,sources){
  if(!keys(input,['schemaVersion','title','executive','themes','actionIds','decisionIds','blockerIds','questionIds','suggestions'])||input.schemaVersion!==1||!text(input.title,160))bad();
  const notes=new Map(sources.map(s=>[s.id,s])),ids=values=>Array.isArray(values)&&values.length<=sources.length&&new Set(values).size===values.length&&values.every(id=>notes.has(id));
  if(!Array.isArray(input.executive)||input.executive.length>8||!Array.isArray(input.themes)||input.themes.length>12)bad();
  for(const entry of input.executive)if(!keys(entry,['text','sourceIds'])||!text(entry.text,1000)||!entry.text.trim()||!ids(entry.sourceIds)||!entry.sourceIds.length||!entry.sourceIds.some(id=>notes.get(id).text.includes(entry.text)))bad();
  for(const group of input.themes)if(!keys(group,['title','sourceIds'])||!text(group.title,100)||!ids(group.sourceIds)||!group.sourceIds.length)bad();
  const flattened=input.themes.flatMap(t=>t.sourceIds);if(new Set(flattened).size!==flattened.length||flattened.length!==sources.length)bad();
  for(const key of ['actionIds','decisionIds','blockerIds','questionIds'])if(!ids(input[key]))bad();
  if(!Array.isArray(input.suggestions)||input.suggestions.length>5||!input.suggestions.every(s=>text(s,400)))bad();
  const derived=sourceAnalysis(sources,input.title);
  // Never promote model guesses to supported decisions/owners/deadlines.
  if(input.decisionIds.some(id=>!derived.decisions.some(d=>d.sourceIds.includes(id)))||input.actionIds.some(id=>!derived.actions.some(d=>d.sourceIds.includes(id))))bad();
  return {...derived,executive:input.executive,themes:input.themes,suggestions:input.suggestions,
    actions:derived.actions.filter(a=>input.actionIds.includes(a.sourceIds[0])),decisions:derived.decisions.filter(a=>input.decisionIds.includes(a.sourceIds[0])),
    blockers:input.blockerIds.map(id=>({text:notes.get(id).text,sourceIds:[id]})),questions:input.questionIds.map(id=>({text:notes.get(id).text,sourceIds:[id]}))};
}

export function clusterEdits(analysis,sources){
  const edits=[],headings=[];let column=0,x=0;
  for(const group of analysis.themes){let y=90;
    const notes=group.sourceIds.map(id=>sources.find(s=>s.id===id));if(notes.some(n=>!n))bad();
    const footprint=note=>boardBounds([{...note,width:note.width??220,height:note.height??180,x:0,y:0,points:[]}]);
    const width=Math.max(260,...notes.map(n=>footprint(n).width));
    headings.push(validateElement({id:'heading-'+column,type:'text',x,y:0,width:Math.min(10000,width),height:60,fontSize:26,text:group.title}));
    for(const note of notes){const bounds=footprint(note);edits.push({kind:'patch',id:note.id,expectedVersion:note.version,patch:{x:x-bounds.x,y:y-bounds.y}});y+=bounds.height+50;}
    column++;x+=width+80;
  }
  return {edits,headings};
}

export function analysisText(result,review=null,sourceRevision=null){
  const list=items=>items.map(i=>`- ${i.text}\n  Source: ${i.sourceIds.join(', ')}${'owner'in i?` | Owner: ${i.owner||'Not specified'} | Deadline: ${i.deadline?i.deadline+' (date unresolved)':'Not specified'}`:''}`).join('\n');
  const actions=result.actions.map(item=>{const edited=review?.actions?.find(a=>a.sourceId===item.sourceIds[0]);return edited?{...item,text:edited.title,owner:edited.owner||null,deadline:edited.deadline||null}:item;});
  return `${result.title}\n${sourceRevision===null?'':`Source whiteboard revision: ${sourceRevision}\n`}${review?.approved?'Reviewed and approved':'Draft — review required'}\n\nEXECUTIVE SUMMARY (source excerpts)\n${list(result.executive)}\n\nKEY DISCUSSION POINTS\n${list(result.points)}\n\nMAIN THEMES\n${result.themes.map(t=>`${t.title}: ${t.sourceIds.join(', ')}`).join('\n')}\n\nEXPLICIT DECISIONS\n${list(result.decisions)||'None identified.'}\n\nPROPOSED ACTION ITEMS (reviewed fields are manager input; no automatic assignments)\n${list(actions)||'None identified.'}\n\nBLOCKERS\n${list(result.blockers)||'None identified.'}\n\nOPEN QUESTIONS\n${list(result.questions)||'None identified.'}\n\nSUGGESTED NEXT STEPS (not agreements)\n${result.suggestions.join('\n')}\n\nMANAGER-EDITED SUMMARY (interpretation)\n${review?.editedSummary||'Not supplied.'}\n\nREVIEW NOTES\n${review?.notes||'Not reviewed.'}`;
}
