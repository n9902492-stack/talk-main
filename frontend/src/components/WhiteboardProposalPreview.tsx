import {useId} from 'react';
import {boardBounds,whiteboardTextLines} from '../lib/whiteboardModel.js';
import type {BoardElement} from '../lib/whiteboard';
export default function WhiteboardProposalPreview({elements}:{elements:BoardElement[]}){
  const bounds=boardBounds(elements),marker=useId().replace(/:/g,'');
  return <svg className="wb-proposal-preview" viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`} role="img" aria-label="Editable diagram proposal preview">
    <defs><marker id={marker} markerWidth="9" markerHeight="9" refX="8" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="none" stroke="#6b8fae"/></marker></defs>
    {elements.map(e=><g key={e.id} transform={`translate(${e.x} ${e.y}) rotate(${e.rotation})`} opacity={e.opacity}>
      {['line','arrow'].includes(e.type)?<polyline points={e.points.reduce((s,n,i)=>s+(i%2?',':' ')+n,'')} stroke={e.stroke} strokeWidth={e.strokeWidth} fill="none" markerEnd={e.type==='arrow'?`url(#${marker})`:undefined}/>
        :e.type==='ellipse'?<ellipse cx={e.width/2} cy={e.height/2} rx={e.width/2} ry={e.height/2} fill={e.fill} stroke={e.stroke} strokeWidth={e.strokeWidth}/>
          :e.type!=='text'?<rect width={e.width} height={e.height} rx={e.type==='rounded'?16:4} fill={e.fill} stroke={e.stroke} strokeWidth={e.strokeWidth}/>:null}
      {['sticky','text'].includes(e.type)&&<text fontSize={e.fontSize} fill={e.stroke} fontFamily="Arial, sans-serif">{whiteboardTextLines(e).map((line:string,i:number)=><tspan key={i} x={8} y={e.fontSize+8+i*e.fontSize*1.2}>{line}</tspan>)}</text>}
    </g>)}
  </svg>;
}
