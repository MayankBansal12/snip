import { useEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { Minus, Plus, Scissors, Trash2 } from 'lucide-react';
import { clamp, formatTime, sequenceDuration } from '../types';
import type { Clip, Edits, Source } from '../types';
type Props = { source: Source; edits: Edits; time: number; selected: string; frames: { url: string; time: number }[]; onSelect: (id: string) => void; onSeek: (time: number) => void; onClips: (clips: Clip[]) => void; onCheckpoint: () => void; onSplit: () => void; onDelete: () => void; canSplit: boolean };
export default function Timeline({source,edits,time,selected,frames,onSelect,onSeek,onClips,onCheckpoint,onSplit,onDelete,canSplit}:Props){
  const track=useRef<HTMLDivElement>(null);const [zoom,setZoom]=useState(1);const [trackWidth,setTrackWidth]=useState(900);const [trimming,setTrimming]=useState<string|null>(null);
  const drag=useRef<{pointer:number;x:number;width:number;duration:number;clips:Clip[];index:number;edge:'start'|'end'}|null>(null);
  const scrubbing=useRef<number|null>(null);const duration=sequenceDuration(edits);
  useEffect(()=>{const observer=new ResizeObserver(entries=>setTrackWidth(entries[0].contentRect.width));if(track.current)observer.observe(track.current);return()=>observer.disconnect();},[]);
  const wanted=duration/Math.max(2,trackWidth/85);const tickStep=[.1,.2,.5,1,2,5,10,15,30,60,120,300,600,1800,3600].find(n=>n>=wanted)||Math.ceil(wanted/3600)*3600;
  const ticks=Array.from({length:Math.floor(duration/tickStep)+1},(_,i)=>i*tickStep);if(duration-(ticks.at(-1)||0)>tickStep*.6)ticks.push(duration);
  const minClip=Math.min(.1,source.duration/2);
  const seek=(e:PointerEvent)=>{const box=track.current!.getBoundingClientRect();onSeek(clamp((e.clientX-box.left)/box.width,0,1)*duration);};
  const startScrub=(e:PointerEvent)=>{if(e.button!==0||scrubbing.current!==null)return;e.preventDefault();scrubbing.current=e.pointerId;e.currentTarget.setPointerCapture(e.pointerId);seek(e);};
  const trimStart=(e:PointerEvent,index:number,edge:'start'|'end')=>{
    if(drag.current||e.button!==0)return;e.stopPropagation();e.preventDefault();onSelect(edits.clips[index].id);onCheckpoint();
    drag.current={pointer:e.pointerId,x:e.clientX,width:track.current!.getBoundingClientRect().width,duration:duration*edits.speed,clips:edits.clips.map(c=>({...c})),index,edge};
    setTrimming(`${edits.clips[index].id}-${edge}`);e.currentTarget.setPointerCapture(e.pointerId);
  };
  const trimTo=(clips:Clip[],index:number,edge:'start'|'end',value:number)=>{
    const next=clips.map(c=>({...c}));const clip=next[index];
    clip[edge]=edge==='start'?clamp(value,index?next[index-1].end:0,clip.end-minClip):clamp(value,clip.start+minClip,index<next.length-1?next[index+1].start:source.duration);
    onClips(next);
  };
  const trimMove=(e:PointerEvent)=>{const d=drag.current;if(!d||d.pointer!==e.pointerId)return;trimTo(d.clips,d.index,d.edge,d.clips[d.index][d.edge]+(e.clientX-d.x)/d.width*d.duration);};
  const end=(e:PointerEvent)=>{if(drag.current?.pointer===e.pointerId){drag.current=null;setTrimming(null);}if(scrubbing.current===e.pointerId)scrubbing.current=null;};
  const removed=source.duration-duration*edits.speed;
  let offset=0;
  return <section className="timeline" aria-label="Video timeline">
    <div className="timeline-toolbar"><div className="timeline-actions"><button className="quiet-button" disabled={!canSplit} onClick={onSplit} title="Split at playhead (S)"><Scissors size={14}/>Split<kbd>S</kbd></button><button className="quiet-button" disabled={edits.clips.length<2} onClick={onDelete} title="Delete selected clip (Delete)"><Trash2 size={14}/>Delete clip</button></div><div className="timeline-meta"><span>{edits.clips.length} {edits.clips.length===1?'clip':'clips'}</span><span className="divider"/><button className="icon-button" aria-label="Zoom timeline out" disabled={zoom===1} onClick={()=>setZoom(Math.max(1,zoom-1))}><Minus size={13}/></button><span className="zoom-label">{zoom}×</span><button className="icon-button" aria-label="Zoom timeline in" disabled={zoom===4} onClick={()=>setZoom(Math.min(4,zoom+1))}><Plus size={13}/></button></div></div>
    <div className="timeline-scroll"><div className="timeline-inner" style={{width:`${zoom*100}%`}}><div className="ruler" onPointerDown={startScrub} onPointerMove={e=>{if(scrubbing.current===e.pointerId)seek(e);}} onPointerUp={end} onPointerCancel={end}>{ticks.map(t=><span key={t} style={{left:`${t/Math.max(duration,.001)*100}%`}}>{formatTime(t,tickStep<1)}</span>)}</div>
      <div ref={track} className="clip-track">
        {edits.clips.map((clip,index)=>{
          const width=(clip.end-clip.start)/(duration*edits.speed)*100;const left=offset;offset+=width;
          const count=Math.max(1,Math.ceil(width/100*16*zoom));
          return <div key={clip.id} className={`timeline-clip ${selected===clip.id?'selected':''}`} style={{left:`${left}%`,width:`${width}%`}} role="button" tabIndex={0} aria-label={`Clip ${index+1}, ${formatTime((clip.end-clip.start)/edits.speed)}`} aria-pressed={selected===clip.id} onClick={()=>onSelect(clip.id)} onPointerDown={e=>{onSelect(clip.id);startScrub(e);}} onPointerMove={e=>{if(scrubbing.current===e.pointerId)seek(e);}} onPointerUp={end} onPointerCancel={end} onKeyDown={e=>{if(e.key==='Enter'){onSelect(clip.id);onSeek(left/100*duration);}}}>
            <div className="clip-thumbnails">{Array.from({length:count},(_,i)=>{const sample=clip.start+(i+.5)/count*(clip.end-clip.start);const image=frames.reduce<{url:string;time:number}|undefined>((best,f)=>!best||Math.abs(f.time-sample)<Math.abs(best.time-sample)?f:best,undefined);return image?<img key={i} src={image.url} alt="" draggable={false}/>:<span key={i}/>;})}</div><span className="clip-number">{String(index+1).padStart(2,'0')}</span>
            {(['start','end'] as const).map(edge=><div key={edge} className={`clip-handle ${edge}`} role="slider" tabIndex={selected===clip.id?0:-1} aria-label={`Clip ${index+1} ${edge}`} aria-valuemin={edge==='start'?(index?edits.clips[index-1].end:0):clip.start+minClip} aria-valuemax={edge==='start'?clip.end-minClip:index<edits.clips.length-1?edits.clips[index+1].start:source.duration} aria-valuenow={clip[edge]} aria-valuetext={formatTime(clip[edge])} onPointerDown={e=>trimStart(e,index,edge)} onPointerMove={trimMove} onPointerUp={end} onPointerCancel={end} onClick={e=>e.stopPropagation()} onKeyDown={e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();e.stopPropagation();onCheckpoint();trimTo(edits.clips,index,edge,clip[edge]+(e.key==='ArrowRight'?1:-1)*(e.shiftKey?1:.1));}}}><i/>{trimming===`${clip.id}-${edge}`&&<span className="trim-tooltip">{formatTime(clip[edge])}</span>}</div>)}
          </div>;
        })}
        <div className="playhead" style={{left:`${clamp(time/Math.max(duration,.001),0,1)*100}%`}} onPointerDown={startScrub} onPointerMove={e=>{if(scrubbing.current===e.pointerId)seek(e);}} onPointerUp={end} onPointerCancel={end}><span/><i/></div>
      </div>
    </div></div>
    <div className="timeline-foot"><span>Drag clip edges to trim. Split to cut out the middle.</span><span>{removed>.05?`${formatTime(removed)} removed`:'Your original stays untouched'}</span></div>
  </section>;
}
