import {useEffect,useRef,useState} from 'react';
import Konva from 'konva';
import {boardBounds,validateElement,whiteboardTextLines} from '../lib/whiteboardModel.js';
import {objectId,type BoardEdit,type BoardElement,type BoardState} from '../lib/whiteboard';

export type CanvasView={scale:number;x:number;y:number};
export type CanvasCommand='delete'|'duplicate'|'copy'|'paste'|'fit'|'reset'|'zoomIn'|'zoomOut';
type Props={elements:BoardElement[];tool:string;color:string;fill:string;width:number;fontSize:number;editable:boolean;busy:boolean;
  cursors:BoardState['cursors'];accountId?:string;onEdit:(edits:BoardEdit[])=>Promise<boolean>;onCursor:(x:number|null,y?:number)=>void;
  onSelection:(ids:string[])=>void;onView:(view:CanvasView)=>void;register:(run:(command:CanvasCommand)=>void)=>void;base:string;
  onStroke?:(element:BoardElement)=>void;shapePreview?:BoardElement|null;focusRequest?:{id:string;nonce:number}|null};

export default function WhiteboardCanvas(props:Props){
  const host=useRef<HTMLDivElement|null>(null),stage=useRef<Konva.Stage|null>(null),layer=useRef<Konva.Layer|null>(null),overlay=useRef<Konva.Layer|null>(null),transformer=useRef<Konva.Transformer|null>(null);
  const latest=useRef(props);latest.current=props;
  const selected=useRef<string[]>([]),clipboard=useRef<BoardElement[]>([]),view=useRef<CanvasView>({scale:1,x:0,y:0});
  const groups=useRef(new Map<string,Konva.Group>()),cache=useRef(new Map<string,{url:string;image:HTMLImageElement}>()),fetching=useRef(new Set<string>()),imageAbort=useRef<AbortController|null>(null);
  const [imageRevision,setImageRevision]=useState(0),[textEdit,setTextEdit]=useState<{element:BoardElement;isNew:boolean}|null>(null),[textValue,setTextValue]=useState('');
  const textEditing=useRef(false);textEditing.current=!!textEdit;
  const [notice,setNotice]=useState('');
  const draft=useRef<BoardElement|null>(null),drawing=useRef<Konva.Group|null>(null),origin=useRef<{x:number;y:number}|null>(null);
  const selection=(ids:string[])=>{selected.current=ids;latest.current.onSelection(ids);transformer.current?.nodes(ids.map(id=>groups.current.get(id)).filter(Boolean) as Konva.Group[]);transformer.current?.keepRatio(ids.some(id=>latest.current.elements.find(e=>e.id===id)?.type==='image'));};
  const pointer=()=>{const s=stage.current,p=s?.getPointerPosition();return p&&s?{x:(p.x-s.x())/s.scaleX(),y:(p.y-s.y())/s.scaleY()}:null;};
  const publishView=()=>{const s=stage.current;if(s){view.current={x:s.x(),y:s.y(),scale:s.scaleX()};latest.current.onView(view.current);}};
  const setView=(scale:number,x:number,y:number)=>{const s=stage.current;if(!s)return;scale=Math.min(4,Math.max(.0001,scale));s.scale({x:scale,y:scale});s.position({x,y});s.batchDraw();publishView();};
  function draw(element:BoardElement){
    const group=new Konva.Group({id:element.id,x:element.x,y:element.y,rotation:element.rotation,opacity:element.opacity,draggable:latest.current.editable&&latest.current.tool==='select'&&!latest.current.busy});
    group.setAttr('boardObject',element.id);
    const common={stroke:element.stroke==='none'?undefined:element.stroke,strokeWidth:element.strokeWidth,fill:element.fill==='none'?undefined:element.fill};
    if(['pen','highlighter','line','arrow'].includes(element.type)){
      const config={...common,fill:undefined,points:element.points,tension:element.type==='pen'||element.type==='highlighter'?.25:0,lineCap:'round' as const,lineJoin:'round' as const,hitStrokeWidth:Math.max(12,element.strokeWidth)};
      group.add(element.type==='arrow'?new Konva.Arrow({...config,fill:element.stroke,pointerLength:12,pointerWidth:10}):new Konva.Line(config));
    }else if(element.type==='ellipse')group.add(new Konva.Ellipse({...common,x:element.width/2,y:element.height/2,radiusX:element.width/2,radiusY:element.height/2}));
    else if(element.type==='image'){
      const cached=cache.current.get(element.imageId||'');
      group.add(cached?new Konva.Image({image:cached.image,width:element.width,height:element.height}):new Konva.Rect({width:element.width,height:element.height,fill:'#e8eff7',stroke:'#8196aa'}));
    }else{
      if(element.type!=='text')group.add(new Konva.Rect({...common,width:element.width,height:element.height,cornerRadius:element.type==='rounded'?16:element.type==='sticky'?4:0}));
      if(['text','sticky'].includes(element.type)){
        const text=new Konva.Group({clipX:0,clipY:0,clipWidth:element.width,clipHeight:element.height});
        text.add(new Konva.Text({text:whiteboardTextLines(element).join('\n'),x:8,y:8,width:Math.max(1,element.width-16),fontSize:element.fontSize,fontFamily:'Arial, sans-serif',fill:element.stroke==='none'?'#172435':element.stroke,wrap:'none',lineHeight:1.2}));group.add(text);
      }
    }
    group.on('dragstart',()=>{if(!selected.current.includes(element.id))selection([element.id]);});
    group.on('dragend',event=>{event.cancelBubble=true;if(!latest.current.editable||latest.current.busy)return;void latest.current.onEdit([{kind:'patch',id:element.id,expectedVersion:element.version,patch:{x:group.x(),y:group.y()}}]);});
    group.on('transformend',()=>{
      if(!latest.current.editable||latest.current.busy)return;
      const edits=selected.current.map(id=>{const item=latest.current.elements.find(e=>e.id===id),node=groups.current.get(id);if(!item||!node)return null;
        const sx=node.scaleX(),sy=node.scaleY(),patch:Partial<BoardElement>={x:node.x(),y:node.y(),rotation:node.rotation(),width:Math.max(1,Math.min(10000,item.width*sx)),height:Math.max(1,Math.min(10000,item.height*sy))};
        if(item.points.length)patch.points=item.points.map((p,i)=>p*(i%2?sy:sx));
        node.scale({x:1,y:1});return {kind:'patch' as const,id,expectedVersion:item.version,patch};
      }).filter(Boolean) as BoardEdit[];
      if(edits.length)void latest.current.onEdit(edits);
    });
    group.on('dblclick dbltap',()=>{if(latest.current.editable&&!latest.current.busy&&['text','sticky'].includes(element.type)){setTextValue(element.text);setTextEdit({element,isNew:false});}});
    return group;
  }
  function run(command:CanvasCommand){
    const p=latest.current,s=stage.current;if(!s)return;
    if(command==='fit'){const b=boardBounds(p.elements),scale=Math.min(2,(s.width()-40)/b.width,(s.height()-40)/b.height);setView(scale,(s.width()-b.width*scale)/2-b.x*scale,(s.height()-b.height*scale)/2-b.y*scale);return;}
    if(command==='reset'){setView(1,0,0);return;}
    if(command==='zoomIn'||command==='zoomOut'){const next=Math.min(4,Math.max(.0001,s.scaleX()*(command==='zoomIn'?1.2:1/1.2))),cx=s.width()/2,cy=s.height()/2;setView(next,cx-(cx-s.x())/s.scaleX()*next,cy-(cy-s.y())/s.scaleY()*next);return;}
    const items=p.elements.filter(e=>selected.current.includes(e.id));
    if(command==='copy'){clipboard.current=items.map(e=>({...e,points:[...e.points]}));return;}
    if(!p.editable||p.busy)return;
    if(command==='delete'&&items.length)void p.onEdit(items.map(e=>({kind:'delete',id:e.id,expectedVersion:e.version})));
    if(command==='duplicate'||command==='paste'){
      const source=command==='duplicate'?items:clipboard.current;if(!source.length)return;
      const copies=source.slice(0,20).map(e=>({...e,id:objectId(),x:e.x+30,y:e.y+30}));
      void p.onEdit(copies.map(element=>({kind:'create',id:element.id,element})));selection(copies.map(e=>e.id));
    }
  }
  useEffect(()=>{
    if(!host.current)return;
    imageAbort.current=new AbortController();
    const s=new Konva.Stage({container:host.current,width:host.current.clientWidth,height:host.current.clientHeight}),l=new Konva.Layer(),o=new Konva.Layer();s.add(l,o);stage.current=s;layer.current=l;overlay.current=o;
    const tr=new Konva.Transformer({rotateEnabled:true,flipEnabled:false,padding:5,anchorSize:10,borderStroke:'#2678b7',boundBoxFunc:(old,next)=>next.width<8||next.height<8?old:next});transformer.current=tr;o.add(tr);
    const resize=new ResizeObserver(()=>{if(host.current){s.size({width:host.current.clientWidth,height:host.current.clientHeight});s.batchDraw();}});resize.observe(host.current);
    s.on('wheel',event=>{event.evt.preventDefault();const point=s.getPointerPosition();if(!point)return;const previous=s.scaleX(),next=Math.min(4,Math.max(.0001,previous*(event.evt.deltaY>0?1/1.08:1.08)));setView(next,point.x-(point.x-s.x())/previous*next,point.y-(point.y-s.y())/previous*next);});
    s.on('dragend',event=>{if(event.target===s)publishView();});
    s.on('pointerdown',event=>{
      host.current?.parentElement?.focus({preventScroll:true});
      if(event.target.getClassName()==='Transformer'||event.target.getParent()===transformer.current)return;
      const p=latest.current,pos=pointer();if(!pos||textEditing.current)return;
      const object=event.target.findAncestor((node:Konva.Node)=>!!node.getAttr('boardObject'),true)?.getAttr('boardObject') as string|undefined;
      if(p.tool==='hand')return;
      if(p.tool==='select'){selection(object?(event.evt.shiftKey?[...new Set([...selected.current,object])].slice(0,20):[object]):[]);return;}
      if(!p.editable||p.busy)return;
      selection([]);
      if(p.tool==='eraser'){const item=p.elements.find(e=>e.id===object);if(item)void p.onEdit([{kind:'delete',id:item.id,expectedVersion:item.version}]);return;}
      if(p.tool==='image')return;
      const element=validateElement({id:objectId(),type:p.tool,x:pos.x,y:pos.y,stroke:p.color,fill:p.tool==='sticky'?(p.fill==='none'?'#fff0ad':p.fill):p.fill,strokeWidth:p.width,opacity:p.tool==='highlighter'?.35:1,fontSize:p.fontSize}) as BoardElement;
      if(p.tool==='text'||p.tool==='sticky'){element.width=p.tool==='sticky'?220:280;element.height=p.tool==='sticky'?180:120;setTextValue('');setTextEdit({element,isNew:true});return;}
      origin.current=pos;element.points=['pen','highlighter','line','arrow'].includes(p.tool)?[0,0,1,1]:[];
      if((p.tool==='pen'||p.tool==='highlighter')&&event.evt.pointerType==='pen')element.strokeWidth=Math.max(1,p.width*(.5+(event.evt.pressure||.5)));
      element.width=1;element.height=1;draft.current=element;drawing.current=draw(element);o.add(drawing.current);o.batchDraw();
      // Capture guarantees pointerup cleanup when drawing outside the canvas.
      (event.evt.target as HTMLElement)?.setPointerCapture?.(event.evt.pointerId);
    });
    s.on('pointermove',()=>{
      const pos=pointer();if(!pos)return;void latest.current.onCursor(pos.x,pos.y);
      const e=draft.current,start=origin.current;if(!e||!start)return;
      const dx=pos.x-start.x,dy=pos.y-start.y;
      if(['pen','highlighter'].includes(e.type)){let points=e.points;if(points.length>=4094){const reduced:number[]=[];for(let i=0;i<points.length;i+=4)reduced.push(points[i],points[i+1]);e.points=points=reduced;}if(Math.hypot(dx-points.at(-2)!,dy-points.at(-1)!)>1/view.current.scale)points.push(dx,dy);}
      else if(['line','arrow'].includes(e.type))e.points=[0,0,dx,dy];
      else{e.x=Math.min(start.x,pos.x);e.y=Math.min(start.y,pos.y);e.width=Math.max(1,Math.abs(dx));e.height=Math.max(1,Math.abs(dy));}
      const preview=drawing.current;
      if(preview){preview.position({x:e.x,y:e.y});const shape=preview.getChildren()[0];
        if(shape instanceof Konva.Line)shape.points([...e.points]);
        else if(shape instanceof Konva.Ellipse){shape.position({x:e.width/2,y:e.height/2});shape.radius({x:e.width/2,y:e.height/2});}
        else if(shape instanceof Konva.Rect)shape.size({width:e.width,height:e.height});
      }overlay.current?.batchDraw();
    });
    const finish=()=>{const e=draft.current;draft.current=null;origin.current=null;drawing.current?.destroy();drawing.current=null;if(e&&latest.current.editable&&!latest.current.busy)void(async()=>{if(await latest.current.onEdit([{kind:'create',id:e.id,element:e}])&&e.type==='pen')latest.current.onStroke?.(e);})();};
    s.on('pointerup',finish);s.on('pointercancel',()=>{draft.current=null;drawing.current?.destroy();drawing.current=null;});
    const key=(event:KeyboardEvent)=>{const target=event.target as HTMLElement;if(!host.current?.parentElement?.contains(target)||target.closest('input,textarea,select'))return;
      const meta=event.ctrlKey||event.metaKey;let command:CanvasCommand|undefined;
      if(event.key==='Delete'||event.key==='Backspace')command='delete';else if(meta&&event.key==='d')command='duplicate';else if(meta&&event.key==='c')command='copy';else if(meta&&event.key==='v')command='paste';
      if(command){event.preventDefault();run(command);}
    };document.addEventListener('keydown',key);
    latest.current.register(run);
    return()=>{resize.disconnect();document.removeEventListener('keydown',key);imageAbort.current?.abort();for(const cached of cache.current.values())URL.revokeObjectURL(cached.url);cache.current.clear();fetching.current.clear();s.destroy();stage.current=null;};
  },[]);
  useEffect(()=>{
    const l=layer.current,o=overlay.current,s=stage.current;if(!l||!o||!s)return;
    // Retain unchanged canvas objects so another editor's edit does not interrupt
    // local dragging or rebuild the entire canvas. Pointer previews use a layer.
    const ids=new Set(props.elements.map(e=>e.id));
    for(const [id,node] of groups.current)if(!ids.has(id)){node.destroy();groups.current.delete(id);}
    props.elements.forEach((e,index)=>{
      const signature=JSON.stringify(e)+(e.imageId&&cache.current.has(e.imageId)?':loaded':''),existing=groups.current.get(e.id);
      let node=existing;if(!node||node.getAttr('savedSignature')!==signature){node?.destroy();node=draw(e);node.setAttr('savedSignature',signature);l.add(node);groups.current.set(e.id,node);}
      node.draggable(props.editable&&props.tool==='select'&&!props.busy);node.zIndex(index);
    });
    selected.current=selected.current.filter(id=>groups.current.has(id));
    transformer.current?.nodes(selected.current.map(id=>groups.current.get(id)!));transformer.current?.enabledAnchors(props.editable&&!props.busy?['top-left','top-right','bottom-left','bottom-right']:[]);
    transformer.current?.rotateEnabled(props.editable&&!props.busy);transformer.current?.keepRatio(selected.current.some(id=>props.elements.find(e=>e.id===id)?.type==='image'));
    s.draggable(props.tool==='hand');s.container().style.cursor=props.tool==='hand'?'grab':props.tool==='select'?'default':'crosshair';l.batchDraw();o.batchDraw();
    for(const e of props.elements)if(e.imageId&&!cache.current.has(e.imageId)&&!fetching.current.has(e.imageId)){
      const id=e.imageId;fetching.current.add(id);
      void fetch(`${props.base}/images/${id}`,{credentials:'same-origin',signal:imageAbort.current?.signal}).then(async response=>{if(!response.ok)throw new Error();const url=URL.createObjectURL(await response.blob()),image=new Image();image.src=url;try{await image.decode();}catch{URL.revokeObjectURL(url);throw new Error('Image decode failed.');}if(imageAbort.current?.signal.aborted){URL.revokeObjectURL(url);return;}cache.current.set(id,{url,image});setImageRevision(n=>n+1);}).catch(()=>{if(!imageAbort.current?.signal.aborted)setNotice('An image could not be loaded. Reopen the board to retry.');});
    }
  },[props.elements,props.tool,props.editable,props.busy,imageRevision]);
  useEffect(()=>{
    const o=overlay.current;if(!o)return;o.find('.peer-cursor').forEach(node=>node.destroy());
    for(const cursor of props.cursors.filter(c=>c.accountId!==props.accountId)){
      const g=new Konva.Group({name:'peer-cursor',x:cursor.x,y:cursor.y,listening:false,scaleX:1/view.current.scale,scaleY:1/view.current.scale});g.add(new Konva.Line({points:[0,0,5,18,9,11,17,9,0,0],closed:true,fill:cursor.color,stroke:'white',strokeWidth:1}));g.add(new Konva.Text({x:14,y:15,text:cursor.name.slice(0,35),fontSize:12,fill:cursor.color,padding:3}));o.add(g);
    }o.batchDraw();
  },[props.cursors,props.accountId]);
  useEffect(()=>{
    const o=overlay.current;if(!o)return;o.find('.recognition-preview').forEach(node=>node.destroy());
    if(props.shapePreview){const node=draw(props.shapePreview);node.name('recognition-preview');node.opacity(.55);node.listening(false);o.add(node);}o.batchDraw();
  },[props.shapePreview]);
  useEffect(()=>{
    const item=props.elements.find(e=>e.id===props.focusRequest?.id),s=stage.current;if(!item||!s)return;
    selection([item.id]);const scale=Math.min(1.5,s.width()/(item.width+100),s.height()/(item.height+100));setView(scale,s.width()/2-(item.x+item.width/2)*scale,s.height()/2-(item.y+item.height/2)*scale);
  },[props.focusRequest]);
  const saveText=async()=>{if(!textEdit)return;const {element,isNew}=textEdit;const success=await props.onEdit([{kind:isNew?'create':'patch',id:element.id,expectedVersion:element.version,...(isNew?{element:{...element,text:textValue}}:{patch:{text:textValue}})}]);if(success)setTextEdit(null);};
  return <div className="wb-canvas-wrap" tabIndex={0} aria-label="Collaborative whiteboard canvas. Use tools to draw. Shift-click selects multiple objects.">
    <div className="wb-canvas" ref={host}/>
    {notice&&<button className="wb-image-notice" onClick={()=>setNotice('')}>{notice} Dismiss</button>}
    {textEdit&&<div className="wb-text-editor" role="dialog" aria-label="Edit whiteboard text"><label htmlFor="wb-text-content">{textEdit.element.type==='sticky'?'Sticky note':'Text'}</label><textarea id="wb-text-content" autoFocus maxLength={4000} rows={5} value={textValue} onChange={event=>setTextValue(event.target.value)} onKeyDown={event=>{if(event.key==='Escape')setTextEdit(null);if((event.ctrlKey||event.metaKey)&&event.key==='Enter')void saveText();}}/><div><button disabled={props.busy||!props.editable} onClick={()=>void saveText()}>Save text</button><button onClick={()=>setTextEdit(null)}>Cancel</button></div><small>Multiline text · Ctrl/⌘ + Enter to save</small></div>}
  </div>;
}
