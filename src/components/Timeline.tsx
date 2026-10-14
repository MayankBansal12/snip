import { useEffect, useId, useRef, useState } from 'react';
import type { PointerEvent, ReactNode, RefObject } from 'react';
import { Scissors, ZoomIn, Trash2, RotateCcw, Merge, Undo2, Redo2 } from 'lucide-react';
import { Kbd } from './ui/kbd';
import { Button } from './ui/button';
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from './ui/menu';
import { Tooltip, TooltipPopup, TooltipTrigger } from './ui/tooltip';
import ClipActions from './ClipActions';
import IconButton from './IconButton';
import { useClipReorder } from '../hooks/useClipReorder';
import { useClipLayout } from '../hooks/useClipLayout';
import ClipThumbnails from './ClipThumbnails';
import ClipDragPreview from './ClipDragPreview';
import { mergeBlockReason, canMergeClips, trimBounds, clamp, clipDuration, clipSpeed, formatTime, sequenceDuration, toSequenceTime, toSourceTime } from '../types';
import type { Clip, Edits, Source } from '../types';
type Props = { onMoveClip: (id: string, index: number) => void; onMoveStart: () => void; chatActive: boolean; chatEditor: ReactNode; modeSwitch: ReactNode; videoRef: RefObject<HTMLVideoElement | null>; zoom:number; onZoom:(zoom:number)=>void; source: Source; edits: Edits; time: number; selected: string; frames: { url: string; time: number }[]; onSelect: (id: string) => void; onSeek: (time: number) => void; onClips: (clips: Clip[]) => void; onCheckpoint: () => void; onSplit: () => void; onDelete: () => void; onResetTrim: () => void; onUndo: () => void; onRedo: () => void; canUndo: boolean; canRedo: boolean; canSplit: boolean; actionsOpen: boolean; onActionsOpen: (open: boolean) => void; onOpenClip: (id: string) => void; onChangeClip: (patch: Partial<Clip>, record?: boolean) => void; onMerge: (index: number) => void };
export default function Timeline({onMoveClip,onMoveStart,chatActive,chatEditor,modeSwitch,videoRef,zoom,onZoom,source,edits,time,selected,frames,onSelect,onSeek,onClips,onCheckpoint,onSplit,onDelete,canSplit,actionsOpen,onActionsOpen,onOpenClip,onChangeClip,onMerge,onResetTrim,onUndo,onRedo,canUndo,canRedo}:Props){
  const track=useRef<HTMLDivElement>(null),scroll=useRef<HTMLDivElement>(null);const [trackWidth,setTrackWidth]=useState(900);const [trimming,setTrimming]=useState<string|null>(null);
  const drag=useRef<{pointer:number;x:number;width:number;duration:number;clips:Clip[];index:number;edge:'start'|'end'}|null>(null);
  const reorder=useClipReorder({edits,track,scroll,onSelect,onStart:onMoveStart,onMove:onMoveClip});
  const touch=useRef<{pointer:number;x:number;y:number}|null>(null);
  const scrubbing=useRef<number|null>(null);const duration=sequenceDuration(edits);
  useEffect(()=>{const observer=new ResizeObserver(entries=>setTrackWidth(entries[0].contentRect.width));if(track.current)observer.observe(track.current);return()=>observer.disconnect();},[]);
  useEffect(()=>{const el=scroll.current;if(!el||!track.current||drag.current||reorder.drop||reorder.landing||scrubbing.current!==null)return;const x=time/Math.max(duration,.001)*track.current.clientWidth;if(x<el.scrollLeft+12||x>el.scrollLeft+el.clientWidth-18)el.scrollLeft=Math.max(0,x-el.clientWidth/2);},[zoom,time,duration]);
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
    clip[edge]=edge==='start'?clamp(value,trimBounds(next,clip,source.duration).start,clip.end-minClip):clamp(value,clip.start+minClip,trimBounds(next,clip,source.duration).end);
    onClips(next);
    // Show the retained frame at the dragged edge; stay inside an end boundary
    // so an adjoining clip does not replace the frame being trimmed.
    const previewTime=edge==='start'?clip.start:Math.max(clip.start,clip.end-.001);
    onSeek(toSequenceTime(previewTime,{...edits,clips:next},index));
  };
  const trimMove=(e:PointerEvent)=>{const d=drag.current;if(!d||d.pointer!==e.pointerId)return;trimTo(d.clips,d.index,d.edge,d.clips[d.index][d.edge]+(e.clientX-d.x)/d.width*d.duration);};
  const end=(e:PointerEvent)=>{if(drag.current?.pointer===e.pointerId){drag.current=null;setTrimming(null);}if(scrubbing.current===e.pointerId)scrubbing.current=null;};

  const mergeTooltipId=useId();
  const selectedIndex=edits.clips.findIndex(c=>c.id===selected);
  const mergeIndex=canMergeClips(edits.clips[selectedIndex],edits.clips[selectedIndex+1],edits)?selectedIndex:canMergeClips(edits.clips[selectedIndex-1],edits.clips[selectedIndex],edits)?selectedIndex-1:-1;
  const trimmed=Math.max(0,source.duration-edits.clips.reduce((sum,c)=>sum+c.end-c.start,0));
  const mergeReasons=[
    ...(selectedIndex>0?[`previous clip: ${mergeBlockReason(edits.clips[selectedIndex-1],edits.clips[selectedIndex],edits)}`]:[]),
    ...(selectedIndex<edits.clips.length-1?[`next clip: ${mergeBlockReason(edits.clips[selectedIndex],edits.clips[selectedIndex+1],edits)}`]:[]),
  ];
  const originalLeft=new Map<string,number>(),previewLeft=new Map<string,number>();
  let offset=0;
  edits.clips.forEach(c=>{originalLeft.set(c.id,offset);offset+=clipDuration(c,edits)/duration*100;});
  const previewOrder=[...edits.clips];
  if(reorder.drop?.valid){const [moved]=previewOrder.splice(reorder.drop.from,1);previewOrder.splice(reorder.drop.to,0,moved);}
  offset=0;previewOrder.forEach(c=>{previewLeft.set(c.id,offset);offset+=clipDuration(c,edits)/duration*100;});
  useClipLayout(track,edits.clips.map(c=>({id:c.id,base:originalLeft.get(c.id)!/100*trackWidth,target:previewLeft.get(c.id)!/100*trackWidth})),!!reorder.drop,trackWidth);
  const ghost=reorder.drop??reorder.landing,ghostClip=ghost?edits.clips.find(c=>c.id===ghost.id):undefined;
  return <section aria-label="video timeline" className="timeline" data-sortable={edits.clips.length>1} data-reordering={!!reorder.drop}>
    <div className="timeline-toolbar mb-3 flex gap-2" data-chat={chatActive}>
      <div id="editor-controls" className="min-w-0 flex-1">
        <div hidden={chatActive} className="manual-controls flex items-center justify-between gap-2">
          <div className="timeline-actions flex items-center gap-1"><Button size="xs" variant="ghost" disabled={!canSplit} onClick={onSplit} aria-label="split" aria-keyshortcuts="S"><Scissors /><span className="hidden sm:inline">split</span><Kbd aria-hidden="true" className="hidden sm:inline-flex">s</Kbd></Button><ClipActions source={source} videoRef={videoRef} edits={edits} selected={selected} open={actionsOpen} onOpenChange={onActionsOpen} onChange={onChangeClip} onCheckpoint={onCheckpoint} /></div>
          <div className="timeline-actions flex shrink-0 items-center gap-1">
            {edits.clips.length>1 && <Tooltip><TooltipTrigger render={<Button size="xs" variant="ghost" aria-label="merge" aria-disabled={mergeIndex<0} aria-describedby={mergeTooltipId} className={mergeIndex<0?'cursor-default opacity-64':undefined} aria-keyshortcuts="M" onClick={()=>{if(mergeIndex>=0)onMerge(mergeIndex);}} />}><Merge /><span className="hidden sm:inline">merge</span><Kbd aria-hidden="true" className="hidden sm:inline-flex">m</Kbd></TooltipTrigger><TooltipPopup id={mergeTooltipId} role="tooltip" className="max-w-72">{mergeIndex>=0?`merge with ${mergeIndex===selectedIndex?'next':'previous'} clip`: <div className="space-y-1">{mergeReasons.map(reason=><p key={reason}>{reason}</p>)}</div>}</TooltipPopup></Tooltip>}
            <IconButton label="undo" size="icon-xs" aria-keyshortcuts="Control+Z Meta+Z" disabled={!canUndo} onClick={onUndo}><Undo2 /></IconButton>
            <IconButton label="redo" size="icon-xs" aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z" disabled={!canRedo} onClick={onRedo}><Redo2 /></IconButton>
            <Button size="xs" variant="ghost" aria-label="delete clip" aria-keyshortcuts="Delete Backspace" onClick={onDelete}><Trash2 /><span className="hidden sm:inline">delete</span></Button>
          </div>
        </div>
        <div hidden={!chatActive}>{chatEditor}</div>
      </div>
      {modeSwitch}
    </div>
    <div ref={scroll} className="timeline-scroll"><div className="timeline-inner" style={{width:`${zoom*100}%`}}><div className="ruler" onPointerDown={startScrub} onPointerMove={e=>{if(scrubbing.current===e.pointerId)seek(e);}} onPointerUp={end} onPointerCancel={end}>{ticks.map(t=><span key={t} style={{left:`${t/Math.max(duration,.001)*100}%`}}>{formatTime(t,tickStep<1)}</span>)}</div>
      <div ref={track} className="clip-track" onContextMenu={e=>{e.preventDefault();const box=e.currentTarget.getBoundingClientRect();const position=toSourceTime(clamp((e.clientX-box.left)/box.width,0,1)*duration,edits);onOpenClip(edits.clips[position.index].id);}} onDoubleClick={e=>{const box=e.currentTarget.getBoundingClientRect();const position=toSourceTime(clamp((e.clientX-box.left)/box.width,0,1)*duration,edits);onOpenClip(edits.clips[position.index].id);}}>
        {edits.clips.map((clip,index)=>{
          const width=clipDuration(clip,edits)/duration*100;const left=originalLeft.get(clip.id)!;
          const count=Math.max(1,Math.ceil(width/100*16*zoom));
          return <div key={clip.id} className={`timeline-clip ${selected===clip.id?'selected':''} ${reorder.drop?.id===clip.id?'reordering':''}`} style={{left:`${left}%`,width:`${width}%`}} role="button" data-clip-id={clip.id} tabIndex={selected===clip.id?0:-1} aria-keyshortcuts="ArrowUp ArrowDown" onFocus={e=>{if(e.target===e.currentTarget)onSelect(clip.id);}} aria-label={`clip ${index+1}, ${formatTime(clipDuration(clip,edits))}`} aria-pressed={selected===clip.id} onContextMenu={e=>{e.preventDefault();e.stopPropagation();onOpenClip(clip.id);}} onClick={()=>onSelect(clip.id)} onPointerDown={e=>{if(e.pointerType==='touch'){if(!touch.current)touch.current={pointer:e.pointerId,x:e.clientX,y:e.clientY};return;}if(edits.clips.length>1)reorder.start(e,clip.id);else{onSelect(clip.id);startScrub(e);}}} onPointerMove={e=>{reorder.move(e);if(scrubbing.current===e.pointerId)seek(e);}} onPointerUp={e=>{const t=touch.current;if(t?.pointer===e.pointerId){if(Math.hypot(e.clientX-t.x,e.clientY-t.y)<10){onSelect(clip.id);seek(e);}touch.current=null;}else if(reorder.end(e)==='tap')seek(e);end(e);}} onPointerCancel={e=>{touch.current=null;reorder.cancel();end(e);}} onLostPointerCapture={reorder.cancel} onKeyDown={e=>{if(e.target!==e.currentTarget)return;if(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10')){e.preventDefault();e.stopPropagation();onOpenClip(clip.id);return;}if(e.key==='Enter'){e.preventDefault();e.stopPropagation();onSeek(left/100*duration);if(e.key==='Enter')onOpenClip(clip.id);}}}>
            <ClipThumbnails clip={clip} frames={frames} count={count} />
            {edits.clips.length>1 && (selected===clip.id||width/100*trackWidth>76) ? <button type="button" className="clip-number clip-reorder" data-compact={width/100*trackWidth<=76} tabIndex={selected===clip.id?0:-1} aria-label={`drag clip ${index+1} to reorder`} onPointerDown={e=>reorder.start(e,clip.id)} onPointerMove={reorder.move} onPointerUp={e=>{if(reorder.end(e)==='tap')seek(e);}} onPointerCancel={reorder.cancel} onLostPointerCapture={reorder.cancel} onClick={e=>e.stopPropagation()} onDoubleClick={e=>e.stopPropagation()}>{String(index+1).padStart(2,'0')}{clipSpeed(clip,edits)!==1?` · ${clipSpeed(clip,edits)}×`:''}</button> : <span className="clip-number">{String(index+1).padStart(2,'0')}{clipSpeed(clip,edits)!==1?` · ${clipSpeed(clip,edits)}×`:''}</span>}
            {(['start','end'] as const).map(edge=><div key={edge} className={`clip-handle ${edge}`} role="slider" tabIndex={selected===clip.id?0:-1} aria-label={`Clip ${index+1} ${edge}`} aria-valuemin={edge==='start'?trimBounds(edits.clips,clip,source.duration).start:clip.start+minClip} aria-valuemax={edge==='start'?clip.end-minClip:trimBounds(edits.clips,clip,source.duration).end} aria-valuenow={clip[edge]} aria-valuetext={formatTime(clip[edge])} onPointerDown={e=>trimStart(e,index,edge)} onPointerMove={trimMove} onPointerUp={end} onPointerCancel={end} onClick={e=>e.stopPropagation()} onDoubleClick={e=>e.stopPropagation()} onKeyDown={e=>{if(e.altKey||e.ctrlKey||e.metaKey)return;if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();e.stopPropagation();onCheckpoint();trimTo(edits.clips,index,edge,clip[edge]+(e.key==='ArrowRight'?1:-1)*(e.shiftKey?1:.1));}}}><i/>{trimming===`${clip.id}-${edge}`&&<span className="trim-tooltip">{formatTime(clip[edge])}</span>}</div>)}
          </div>;
        })}
        {reorder.drop?.valid && <div className="clip-drop-slot" style={{left:`${reorder.drop.marker}%`,width:`${clipDuration(edits.clips[reorder.drop.from],edits)/duration*100}%`}} aria-hidden="true"><span>{String(reorder.drop.to+1).padStart(2,'0')}</span></div>}
        <div className="playhead" role="slider" tabIndex={0} aria-label="seek video" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={time} aria-valuetext={formatTime(time)} onKeyDown={e=>{if(e.altKey||e.ctrlKey||e.metaKey)return;if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();e.stopPropagation();onSeek(e.key==='Home'?0:e.key==='End'?duration:clamp(time+(e.key==='ArrowRight'?1:-1)*(e.shiftKey?1:1/30),0,duration));}}} style={{left:`${clamp(time/Math.max(duration,.001),0,1)*100}%`}} onPointerDown={startScrub} onPointerMove={e=>{if(scrubbing.current===e.pointerId)seek(e);}} onPointerUp={end} onPointerCancel={end}><span/><i/></div>
      </div>
    </div></div>
    {ghost && ghostClip && <ClipDragPreview element={reorder.preview} drop={ghost} landing={reorder.landing} clip={ghostClip} edits={edits} frames={frames} onFinish={reorder.finishLanding} />}
    <p className="sr-only" aria-live="polite">{reorder.drop?.valid?`move clip ${reorder.drop.from+1} to position ${reorder.drop.to+1}`:''}</p>
    <div className="timeline-foot flex items-center justify-between gap-2">
      <div className="ml-auto flex items-center gap-2">{trimmed>1e-7 && <><span className="tabular-nums">{formatTime(trimmed)} trimmed</span><Button size="xs" variant="ghost" disabled={!edits.clips.some(c=>{const b=trimBounds(edits.clips,c,source.duration);return c.start>b.start+.001||c.end<b.end-.001;})} onClick={onResetTrim}><RotateCcw />reset trim</Button></>}<Menu><MenuTrigger render={<IconButton label="timeline zoom" size="icon-xs"><ZoomIn /></IconButton>} /><MenuPopup side="top" align="end"><MenuRadioGroup value={String(zoom)} onValueChange={value => onZoom(Number(value))}>{[1,2,4,8].map(level => <MenuRadioItem closeOnClick key={level} value={String(level)}>{level === 1 ? 'fit timeline' : `${level}× closer`}</MenuRadioItem>)}</MenuRadioGroup></MenuPopup></Menu></div>
    </div>
  </section>;
}
