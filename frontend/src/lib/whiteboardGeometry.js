import {validateElement} from './whiteboardModel.js';
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const segmentDistance=(p,a,b)=>{const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);};
export function simplifyStroke(points,epsilon){
  if(points.length<3)return points;
  // Iterative RDP avoids recursion depth problems for long pen strokes.
  const keep=new Set([0,points.length-1]),stack=[[0,points.length-1]];
  while(stack.length){const [a,b]=stack.pop();let max=epsilon,index=-1;for(let i=a+1;i<b;i++){const d=segmentDistance(points[i],points[a],points[b]);if(d>max){max=d;index=i;}}
    if(index!==-1){keep.add(index);stack.push([a,index],[index,b]);}}
  return [...keep].sort((a,b)=>a-b).map(i=>points[i]);
}
export function sampleStroke(points,count=80){
  if(points.length<2)return points;
  const cumulative=[0];for(let i=1;i<points.length;i++)cumulative.push(cumulative.at(-1)+distance(points[i],points[i-1]));
  const length=cumulative.at(-1);if(!length)return [points[0]];const result=[];let j=1;
  for(let i=0;i<count;i++){const t=length*i/(count-1);while(j<points.length-1&&cumulative[j]<t)j++;const ratio=(t-cumulative[j-1])/(cumulative[j]-cumulative[j-1]||1);result.push({x:points[j-1].x+(points[j].x-points[j-1].x)*ratio,y:points[j-1].y+(points[j].y-points[j-1].y)*ratio});}
  return result;
}
export function recognizeStroke(stroke){
  if(stroke?.type!=='pen'||stroke.rotation||!Array.isArray(stroke.points)||stroke.points.length<8||stroke.points.length>4096||stroke.points.some(v=>!Number.isFinite(v)))return null;
  const raw=[];for(let i=0;i<stroke.points.length;i+=2){const p={x:stroke.points[i],y:stroke.points[i+1]};if(!raw.length||distance(p,raw.at(-1))>.01)raw.push(p);}if(raw.length<4)return null;
  const points=sampleStroke(raw),minX=Math.min(...points.map(p=>p.x)),maxX=Math.max(...points.map(p=>p.x)),minY=Math.min(...points.map(p=>p.y)),maxY=Math.max(...points.map(p=>p.y));
  const w=maxX-minX,h=maxY-minY,diag=Math.hypot(w,h);if(diag<15)return null;
  const first=raw[0],last=raw.at(-1),length=raw.slice(1).reduce((n,p,i)=>n+distance(p,raw[i]),0),closed=distance(first,last)<diag*.20;
  const base={...stroke,version:undefined,x:stroke.x+minX,y:stroke.y+minY,width:Math.max(1,w),height:Math.max(1,h),points:[]};
  const finish=(kind,confidence,patch)=>confidence>=.88?{kind,confidence:Math.min(.99,confidence),element:validateElement({...base,...patch})}:null;
  if(!closed){
    const direct=distance(first,last),error=points.reduce((n,p)=>n+segmentDistance(p,first,last),0)/points.length/diag;
    if(direct/length>.94&&error<.025)return finish('line',1-error*3,{type:'line',points:[first.x-minX,first.y-minY,last.x-minX,last.y-minY]});
    // Single-stroke arrow: shaft to tip, one wing back, tip, other wing.
    const corner=simplifyStroke(raw,diag*.035);if(corner.length>=5&&corner.length<=7){
      const tip=corner[1],shaft=distance(first,tip),ux=(tip.x-first.x)/(shaft||1),uy=(tip.y-first.y)/(shaft||1);
      const head=corner.slice(2),projections=head.map(p=>({back:(tip.x-p.x)*ux+(tip.y-p.y)*uy,side:(p.x-tip.x)*(-uy)+(p.y-tip.y)*ux}));
      if(shaft>diag*.65&&distance(corner[3],tip)<diag*.12&&projections.every(p=>p.back>-diag*.08&&p.back<shaft*.5)
        &&projections.some(p=>p.side>diag*.08)&&projections.some(p=>p.side<-diag*.08))return finish('arrow',.95,{type:'arrow',points:[first.x-minX,first.y-minY,tip.x-minX,tip.y-minY]});
    }
    return null;
  }
  if(w<12||h<12||length>diag*5)return null;
  let corners=simplifyStroke([...raw.slice(0,-1),first],diag*.065);if(distance(corners[0],corners.at(-1))<diag*.15)corners=corners.slice(0,-1);
  // Remove redundant collinear vertices, including at the closure seam.
  let changed=true;while(changed&&corners.length>3){changed=false;for(let i=0;i<corners.length;i++)if(segmentDistance(corners[i],corners[(i+corners.length-1)%corners.length],corners[(i+1)%corners.length])<diag*.04){corners.splice(i,1);changed=true;break;}}
  const borderError=points.reduce((n,p)=>n+Math.min(Math.abs(p.x-minX),Math.abs(p.x-maxX),Math.abs(p.y-minY),Math.abs(p.y-maxY)),0)/points.length/diag;
  const hasCorners=[[minX,minY],[maxX,minY],[maxX,maxY],[minX,maxY]].every(([x,y])=>points.some(p=>Math.hypot(p.x-x,p.y-y)<diag*.13));
  if(corners.length===4&&hasCorners&&borderError<.04)return finish(Math.abs(w-h)/Math.max(w,h)<.12?'square':'rectangle',1-borderError*2,{type:'rectangle'});
  if(corners.length===3){const area=Math.abs(corners.reduce((n,p,i)=>{const q=corners[(i+1)%3];return n+p.x*q.y-q.x*p.y;},0))/2;
    const error=points.reduce((n,p)=>n+Math.min(...corners.map((a,i)=>segmentDistance(p,a,corners[(i+1)%3]))),0)/points.length/diag;
    if(area>w*h*.3&&error<.035){const polygon=[...corners,corners[0]].flatMap(p=>[p.x-minX,p.y-minY]);return finish('triangle',1-error*3,{type:'line',points:polygon});}}
  const cx=(maxX+minX)/2,cy=(maxY+minY)/2;
  const radialError=points.reduce((n,p)=>n+Math.abs(Math.hypot((p.x-cx)/(w/2),(p.y-cy)/(h/2))-1),0)/points.length;
  const areaCoverage=new Set(points.map(p=>Math.floor((Math.atan2(p.y-cy,p.x-cx)+Math.PI)/(2*Math.PI)*12)%12)).size;
  if(radialError<.08&&areaCoverage>=11&&corners.length>=5)return finish(Math.abs(w-h)/Math.max(w,h)<.15?'circle':'ellipse',1-radialError,{type:'ellipse'});
  return null;
}
