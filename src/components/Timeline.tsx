import { useEffect, useRef, useState } from 'react';
import type { PointerEvent, RefObject } from 'react';
import { Scissors, ZoomIn } from 'lucide-react';
import { Button } from './ui/button';
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from './ui/menu';
import { Card } from './ui/card';
import ClipActions from './ClipActions';
import IconButton from './IconButton';
import { clamp, clipDuration, clipSpeed, formatTime, sequenceDuration, toSequenceTime, toSourceTime } from '../types';
import type { Clip, Edits, Source } from '../types';
type Props = { videoRef: RefObject<HTMLVideoElement | null>; zoom:number; onZoom:(zoom:number)=>void; source: Source; edits: Edits; time: number; selected: string; frames: { url: string; time: number }[]; onSelect: (id: string) => void; onSeek: (time: number) => void; onClips: (clips: Clip[]) => void; onCheckpoint: () => void; onSplit: () => void; onDelete: () => void; canSplit: boolean; actionsOpen: boolean; onActionsOpen: (open: boolean) => void; onOpenClip: (id: string) => void; onChangeClip: (patch: Partial<Clip>, record?: boolean) => void; onMerge: (index: number) => void };
export default function Timeline({videoRef,zoom,onZoom,source,edits,time,selected,frames,onSelect,onSeek,onClips,onCheckpoint,onSplit,onDelete,canSplit,actionsOpen,onActionsOpen,onOpenClip,onChangeClip,onMerge}:Props){
  const track=useRef<HTMLDivElement>(null),scroll=useRef<HTMLDivElement>(null);const [trackWidth,setTrackWidth]=useState(900);const [trimming,setTrimming]=useState<string|null>(null);
  const drag=useRef<{pointer:number;x:number;width:number;duration:number;clips:Clip[];index:number;edge:'start'|'end'}|null>(null);
  const touch=useRef<{pointer:number;x:number;y:number}|null>(null);
  const scrubbing=useRef<number|null>(null);const duration=sequenceDuration(edits);
  useEffect(()=>{const observer=new ResizeObserver(entries=>setTrackWidth(entries[0].contentRect.width));if(track.current)observer.observe(track.current);return()=>observer.disconnect();},[]);
  useEffect(()=>{const el=scroll.current;if(!el||!track.current||drag.current||scrubbing.current!==null)return;const x=time/Math.max(duration,.001)*track.current.clientWidth;if(x<el.scrollLeft+12||x>el.scrollLeft+el.clientWidth-18)el.scrollLeft=Math.max(0,x-el.clientWidth/2);},[zoom,time,duration]);
  const wanted=duration/Math.max(2,trackWidth/85);const tickStep=[.1,.2,.5,1,2,5,10,15,30,60,120,300,600,1800,3600].find(n=>n>=wanted)||Math.ceil(wanted/3600)*3600;
  const ticks=Array.from({length:Math.floor(duration/tickStep)+1},(_,i)=>i*tickStep);if(duration-(ticks.at(-1)||0)>tickStep*.6)ticks.push(duration);
  const minClip=Math.min(.1,source.duration/2);
  const seek=(e:PointerEvent)=>{const box=track.current!.getBoundingClientRect();onSeek(clamp((e.clientX-box.left)/box.width,0,1)*duration);};
  const startScrub=(e:PointerEvent)=>{if(e.button!==0||scrubbing.current!==null)return;e.preventDefault();scrubbing.current=e.pointerId;e.currentTarget.setPointerCapture(e.pointerId);seek(e);};
  const trimStart=(e:PointerEvent,index:number,edge:'start'|'end')=>{
    if(drag.current||e.button!==0)return;e.stopPropagation();e.preventDefault();onSelect(edits.clips[index].id);onCheckpoint();
    drag.current={pointer:e.pointerId,x:e.clientX,width:track.current!.getBoundingClientRect().width,duration:duration*clipSpeed(edits.clips[index],edits),clips:edits.clips.map(c=>({...c})),index,edge};
    setTrimming(`${edits.clips[index].id}-${edge}`);e.currentTarget.setPointerCapture(e.pointerId);
  };
  const trimTo=(clips:Clip[],index:number,edge:'start'|'end',value:number)=>{
    const next=clips.map(c=>({...c}));const clip=next[index];
    clip[edge]=edge==='start'?clamp(value,index?next[index-1].end:0,clip.end-minClip):clamp(value,clip.start+minClip,index<next.length-1?next[index+1].start:source.duration);
    onClips(next);
    // Show the retained frame at the dragged edge; stay inside an end boundary
    // so an adjoining clip does not replace the frame being trimmed.
    const previewTime=edge==='start'?clip.start:Math.max(clip.start,clip.end-.001);
    onSeek(toSequenceTime(previewTime,{...edits,clips:next}));
  };
  const trimMove=(e:PointerEvent)=>{const d=drag.current;if(!d||d.pointer!==e.pointerId)return;trimTo(d.clips,d.index,d.edge,d.clips[d.index][d.edge]+(e.clientX-d.x)/d.width*d.duration);};
  const end=(e:PointerEvent)=>{if(drag.current?.pointer===e.pointerId){drag.current=null;setTrimming(null);}if(scrubbing.current===e.pointerId)scrubbing.current=null;};

  let offset=0;
  return <Card render={<section aria-label="Video timeline" />} className="timeline">
    <div className="timeline-toolbar mb-3 flex items-center justify-between gap-2">
      <div className="timeline-actions flex items-center gap-1"><Button size="sm" variant="ghost" disabled={!canSplit} onClick={onSplit} aria-keyshortcuts="S"><Scissors />Split</Button><ClipActions source={source} videoRef={videoRef} edits={edits} selected={selected} open={actionsOpen} onOpenChange={onActionsOpen} onChange={onChangeClip} onCheckpoint={onCheckpoint} onMerge={onMerge} onDelete={onDelete} /></div>
      <Menu><MenuTrigger render={<IconButton label="Timeline zoom"><ZoomIn /></IconButton>} /><MenuPopup side="top" align="end"><MenuRadioGroup value={String(zoom)} onValueChange={value => onZoom(Number(value))}>{[1,2,4,8].map(level => <MenuRadioItem closeOnClick key={level} value={String(level)}>{level === 1 ? 'Fit timeline' : `${level}× closer`}</MenuRadioItem>)}</MenuRadioGroup></MenuPopup></Menu>
    </div>
    <div ref={scroll} className="timeline-scroll"><div className="timeline-inner" style={{width:`${zoom*100}%`}}><div className="ruler" onPointerDown={startScrub} onPointerMove={e=>{if(scrubbing.current===e.pointerId)seek(e);}} onPointerUp={end} onPointerCancel={end}>{ticks.map(t=><span key={t} style={{left:`${t/Math.max(duration,.001)*100}%`}}>{formatTime(t,tickStep<1)}</span>)}</div>
      <div ref={track} className="clip-track" onContextMenu={e=>{e.preventDefault();const box=e.currentTarget.getBoundingClientRect();const position=toSourceTime(clamp((e.clientX-box.left)/box.width,0,1)*duration,edits);onOpenClip(edits.clips[position.index].id);}} onDoubleClick={e=>{const box=e.currentTarget.getBoundingClientRect();const position=toSourceTime(clamp((e.clientX-box.left)/box.width,0,1)*duration,edits);onOpenClip(edits.clips[position.index].id);}}>
        {edits.clips.map((clip,index)=>{
          const width=clipDuration(clip,edits)/duration*100;const left=offset;offset+=width;
          const count=Math.max(1,Math.ceil(width/100*16*zoom));
          return <div key={clip.id} className={`timeline-clip ${selected===clip.id?'selected':''}`} style={{left:`${left}%`,width:`${width}%`}} role="button" tabIndex={0} aria-label={`Clip ${index+1}, ${formatTime(clipDuration(clip,edits))}`} aria-pressed={selected===clip.id} onContextMenu={e=>{e.preventDefault();e.stopPropagation();onOpenClip(clip.id);}} onClick={()=>onSelect(clip.id)} onPointerDown={e=>{if(e.pointerType==='touch'){if(!touch.current)touch.current={pointer:e.pointerId,x:e.clientX,y:e.clientY};return;}onSelect(clip.id);startScrub(e);}} onPointerMove={e=>{if(scrubbing.current===e.pointerId)seek(e);}} onPointerUp={e=>{const t=touch.current;if(t?.pointer===e.pointerId){if(Math.hypot(e.clientX-t.x,e.clientY-t.y)<10){onSelect(clip.id);seek(e);}touch.current=null;}end(e);}} onPointerCancel={e=>{touch.current=null;end(e);}} onKeyDown={e=>{if(e.target!==e.currentTarget)return;if(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10')){e.preventDefault();e.stopPropagation();onOpenClip(clip.id);return;}if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();onSeek(left/100*duration);if(e.key==='Enter')onOpenClip(clip.id);}}}>
            <div className="clip-thumbnails">{Array.from({length:count},(_,i)=>{const sample=clip.start+(i+.5)/count*(clip.end-clip.start);const image=frames.reduce<{url:string;time:number}|undefined>((best,f)=>!best||Math.abs(f.time-sample)<Math.abs(best.time-sample)?f:best,undefined);return image?<img key={i} src={image.url} alt="" draggable={false}/>:<span key={i}/>;})}</div><span className="clip-number">{String(index+1).padStart(2,'0')}{clipSpeed(clip,edits)!==1?` · ${clipSpeed(clip,edits)}×`:''}</span>
            {(['start','end'] as const).map(edge=><div key={edge} className={`clip-handle ${edge}`} role="slider" tabIndex={selected===clip.id?0:-1} aria-label={`Clip ${index+1} ${edge}`} aria-valuemin={edge==='start'?(index?edits.clips[index-1].end:0):clip.start+minClip} aria-valuemax={edge==='start'?clip.end-minClip:index<edits.clips.length-1?edits.clips[index+1].start:source.duration} aria-valuenow={clip[edge]} aria-valuetext={formatTime(clip[edge])} onPointerDown={e=>trimStart(e,index,edge)} onPointerMove={trimMove} onPointerUp={end} onPointerCancel={end} onClick={e=>e.stopPropagation()} onDoubleClick={e=>e.stopPropagation()} onKeyDown={e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();e.stopPropagation();onCheckpoint();trimTo(edits.clips,index,edge,clip[edge]+(e.key==='ArrowRight'?1:-1)*(e.shiftKey?1:.1));}}}><i/>{trimming===`${clip.id}-${edge}`&&<span className="trim-tooltip">{formatTime(clip[edge])}</span>}</div>)}
          </div>;
        })}
        <div className="playhead" role="slider" tabIndex={0} aria-label="Seek video" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={time} aria-valuetext={formatTime(time)} onKeyDown={e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();e.stopPropagation();onSeek(e.key==='Home'?0:e.key==='End'?duration:clamp(time+(e.key==='ArrowRight'?1:-1)*(e.shiftKey?1:1/30),0,duration));}}} style={{left:`${clamp(time/Math.max(duration,.001),0,1)*100}%`}} onPointerDown={startScrub} onPointerMove={e=>{if(scrubbing.current===e.pointerId)seek(e);}} onPointerUp={end} onPointerCancel={end}><span/><i/></div>
      </div>
    </div></div>
    <div className="timeline-foot"><span className="hidden sm:inline">Double-click or right-click to edit · Drag edges to trim</span><span className="sm:hidden">Select a clip for actions · Drag edges to trim</span></div>
  </Card>;
}
