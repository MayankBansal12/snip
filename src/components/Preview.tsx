import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent, RefObject } from 'react';
import { clamp, cropPixels, canvasSize, placement, ratios, uid } from '../types';
import type { Annotation, Crop, Edits, Source, Tool } from '../types';
import { drawAnnotation, svgMatrix } from '../effects';
export type DrawMode = 'select' | 'arrow' | 'rectangle' | 'pen';
type Props={source:Source;edits:Edits;url:string;tool:Tool;videoRef:RefObject<HTMLVideoElement|null>;drawMode:DrawMode;drawColor:string;selectedAnnotation:string|null;onAnnotation:(id:string|null)=>void;onDrawMode:(mode:DrawMode)=>void;onUpdate:(patch:Partial<Edits>,record?:boolean)=>void;onCheckpoint:()=>void;onPlay:()=>void;onPause:()=>void;onLoaded:()=>void;onToggle:()=>void};
function bounds(a:Annotation){
  if(a.type==='text')return {x:a.x-.35,y:a.y-a.size*.8,width:.7,height:a.size*1.6*Math.max(1,a.text.split('\n').length)};
  const points=a.type==='pen'?(a.points||[]):[{x:0,y:0},{x:a.width,y:a.height}];
  const xs=points.map(p=>p.x),ys=points.map(p=>p.y);const x=Math.min(...xs),y=Math.min(...ys);
  return {x:a.x+x-.012,y:a.y+y-.012,width:Math.max(...xs)-x+.024,height:Math.max(...ys)-y+.024};
}
export default function Preview(p:Props){
  const {source,edits,url,tool,videoRef,onUpdate,onCheckpoint}=p;
  const frame=useRef<HTMLDivElement>(null),overlay=useRef<HTMLCanvasElement>(null);
  const [size,setSize]=useState({width:1,height:1});
  const cropDrag=useRef<{pointer:number;crop:Crop;x:number;y:number;width:number;height:number;mode:string}|null>(null);
  const annotationDrag=useRef<{pointer:number;start:{x:number;y:number};annotation:Annotation;kind:'move'|'draw';all:Annotation[]}|null>(null);
  const output=canvasSize(source,edits),crop=cropPixels(source,edits.crop),pos=placement(source,edits,output);
  const ratio=tool==='crop'?source.width/source.height:output.width/output.height;
  useEffect(()=>{const element=frame.current;if(!element)return;const observer=new ResizeObserver(entries=>{const r=entries[0].contentRect;setSize({width:r.width,height:r.height});});observer.observe(element);return()=>observer.disconnect();},[]);
  useEffect(()=>{const c=overlay.current;if(!c)return;const dpr=Math.min(2,window.devicePixelRatio||1);c.width=Math.round(size.width*dpr);c.height=Math.round(size.height*dpr);const ctx=c.getContext('2d')!;ctx.scale(dpr,dpr);edits.annotations.forEach(a=>drawAnnotation(ctx,a,size.width,size.height));},[edits.annotations,size,tool]);
  const cropStart=(e:PointerEvent,mode:string)=>{if(cropDrag.current||e.button!==0)return;e.preventDefault();e.stopPropagation();onCheckpoint();const b=frame.current!.getBoundingClientRect();cropDrag.current={pointer:e.pointerId,crop:{...edits.crop},x:e.clientX,y:e.clientY,width:b.width,height:b.height,mode};e.currentTarget.setPointerCapture(e.pointerId);};
  const cropMove=(e:PointerEvent)=>{
    const d=cropDrag.current;if(!d||d.pointer!==e.pointerId)return;const dx=(e.clientX-d.x)/d.width,dy=(e.clientY-d.y)/d.height,c=d.crop;
    if(d.mode==='move'){onUpdate({crop:{...c,x:clamp(c.x+dx,0,1-c.width),y:clamp(c.y+dy,0,1-c.height)}},false);return;}
    const left=d.mode.includes('w'),top=d.mode.includes('n'),ax=left?c.x+c.width:c.x,ay=top?c.y+c.height:c.y,maxW=left?ax:1-ax,maxH=top?ay:1-ay;
    let width=clamp(c.width+dx*(left?-1:1),Math.min(.04,maxW),maxW),height=clamp(c.height+dy*(top?-1:1),Math.min(.04,maxH),maxH);
    const ratio=edits.cropAspect==='Original'?1:ratios[edits.cropAspect]?ratios[edits.cropAspect]/(source.width/source.height):0;
    if(ratio){width=Math.min(Math.abs(dx)>Math.abs(dy)?width:height*ratio,maxW,maxH*ratio);height=width/ratio;}
    onUpdate({crop:{x:left?ax-width:ax,y:top?ay-height:ay,width,height}},false);
  };
  const point=(e:PointerEvent)=>{const b=frame.current!.getBoundingClientRect();return{x:clamp((e.clientX-b.left)/b.width,0,1),y:clamp((e.clientY-b.top)/b.height,0,1)};};
  const annotationStart=(e:PointerEvent)=>{
    if(annotationDrag.current||e.button!==0)return;e.preventDefault();const pt=point(e);
    if(p.drawMode==='select'){
      const hit=[...edits.annotations].reverse().find(a=>{const b=bounds(a);return pt.x>=b.x&&pt.x<=b.x+b.width&&pt.y>=b.y&&pt.y<=b.y+b.height;});
      p.onAnnotation(hit?.id||null);if(!hit)return;onCheckpoint();annotationDrag.current={pointer:e.pointerId,start:pt,annotation:{...hit},kind:'move',all:edits.annotations};
    }else{
      const a:Annotation={id:uid(),type:p.drawMode,x:pt.x,y:pt.y,width:0,height:0,text:'',size:.006,color:p.drawColor,points:p.drawMode==='pen'?[{x:0,y:0}]:undefined};
      onCheckpoint();p.onAnnotation(a.id);annotationDrag.current={pointer:e.pointerId,start:pt,annotation:a,kind:'draw',all:edits.annotations};onUpdate({annotations:[...edits.annotations,a]},false);
    }
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const annotationMove=(e:PointerEvent)=>{
    const d=annotationDrag.current;if(!d||d.pointer!==e.pointerId)return;const pt=point(e);let a={...d.annotation};
    if(d.kind==='move')a={...a,x:clamp(d.annotation.x+pt.x-d.start.x,0,1),y:clamp(d.annotation.y+pt.y-d.start.y,0,1)};
    else if(a.type==='pen'){a.points=[...(a.points||[]),{x:pt.x-d.start.x,y:pt.y-d.start.y}];d.annotation=a;}
    else a={...a,width:pt.x-d.start.x,height:pt.y-d.start.y};
    onUpdate({annotations:d.kind==='draw'?[...d.all,a]:d.all.map(item=>item.id===a.id?a:item)},false);
  };
  const annotationEnd=(e:PointerEvent)=>{if(annotationDrag.current?.pointer===e.pointerId){const d=annotationDrag.current;annotationDrag.current=null;if(d.kind==='draw')p.onDrawMode('select');}};
  const selected=edits.annotations.find(a=>a.id===p.selectedAnnotation);const selection=selected?bounds(selected):null;
  const sourceStyle:CSSProperties=tool==='crop'?{inset:0}:{width:`${pos.width/output.width*100}%`,height:`${pos.height/output.height*100}%`,left:`${pos.x/output.width*100}%`,top:`${pos.y/output.height*100}%`};
  const videoStyle:CSSProperties=tool==='crop'?{width:'100%',height:'100%'}:{width:`${source.width/crop.width*100}%`,height:`${source.height/crop.height*100}%`,left:`${-crop.x/crop.width*100}%`,top:`${-crop.y/crop.height*100}%`,filter:'url(#video-treatment)'};
  return <div className={`preview-stage ${tool==='annotate'&&p.drawMode!=='select'?'drawing':''}`}>
    <svg width="0" height="0" className="filter-definitions" aria-hidden="true"><defs><filter id="video-treatment" colorInterpolationFilters="sRGB"><feColorMatrix type="matrix" values={svgMatrix(edits)}/></filter></defs></svg>
    <div className="preview-boundary"><div ref={frame} className="composition" style={{aspectRatio:ratio,'--ratio':ratio,background:edits.canvas.background} as CSSProperties}>
      <div className="source-window" style={sourceStyle}><video ref={videoRef} src={url||undefined} style={videoStyle} playsInline preload="auto" onLoadedMetadata={p.onLoaded} onPlay={p.onPlay} onPause={p.onPause} onEnded={p.onPause} onClick={tool!=='crop'&&tool!=='annotate'?p.onToggle:undefined}/></div>
      {tool!=='crop'&&<canvas ref={overlay} className="annotation-overlay" aria-hidden="true"/>}
      {tool==='annotate'&&<div className="annotation-surface" onPointerDown={annotationStart} onPointerMove={annotationMove} onPointerUp={annotationEnd} onPointerCancel={annotationEnd}>{selection&&<div className="annotation-selection" style={{left:`${selection.x*100}%`,top:`${selection.y*100}%`,width:`${selection.width*100}%`,height:`${selection.height*100}%`}}/>}</div>}
      {tool==='crop'&&<div className="crop-selection" tabIndex={0} role="group" aria-label="Crop area. Drag to move or resize; arrow keys move the crop." style={{left:`${edits.crop.x*100}%`,top:`${edits.crop.y*100}%`,width:`${edits.crop.width*100}%`,height:`${edits.crop.height*100}%`}} onPointerDown={e=>cropStart(e,'move')} onPointerMove={cropMove} onPointerUp={()=>{cropDrag.current=null;}} onPointerCancel={()=>{cropDrag.current=null;}} onKeyDown={e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();e.stopPropagation();const step=e.shiftKey?.05:.005;onUpdate({crop:{...edits.crop,x:clamp(edits.crop.x+(e.key==='ArrowRight'?step:e.key==='ArrowLeft'?-step:0),0,1-edits.crop.width),y:clamp(edits.crop.y+(e.key==='ArrowDown'?step:e.key==='ArrowUp'?-step:0),0,1-edits.crop.height)}});}}><div className="crop-grid"/>{['nw','ne','sw','se'].map(c=><span key={c} className={`crop-handle ${c}`} onPointerDown={e=>cropStart(e,c)}/>)}</div>}
    </div></div>
    {tool==='crop'&&<span className="stage-hint">Drag corners to crop · change the canvas in Frame</span>}
    {tool==='annotate'&&<span className="stage-hint">{p.drawMode==='select'?'Click an annotation to select and move it':`Drag to ${p.drawMode==='pen'?'draw':`add an ${p.drawMode}`}`}</span>}
  </div>;
}
