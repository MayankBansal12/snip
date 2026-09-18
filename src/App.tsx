import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpRight, Crop as CropIcon, Film, Frame, Gauge, LoaderCircle, Maximize2, Moon, Palette, Pause, PenLine, Play, Plus, Redo2, SkipBack, SkipForward, Sun, Trash2, Undo2, Volume2, VolumeX, X } from 'lucide-react';
import { cancelExport, exportVideo } from './export';
import { clearProject, restoreProject, saveEdits, saveProject } from './storage';
import { defaults, formatTime, migrateEdits, outputSize, sequenceDuration, toSequenceTime, toSourceTime, uid } from './types';
import type { Clip, Edits, Source, Tool } from './types';
import { readMetadata, thumbnails } from './media';
import Preview from './components/Preview';
import type { DrawMode } from './components/Preview';
import Timeline from './components/Timeline';
import ToolPanel from './components/ToolPanel';
import ExportDialog from './components/ExportDialog';
import ScissorsMark from './components/ScissorsMark';
import type { Download } from './components/ExportDialog';
const tools=[{id:'canvas',name:'Frame',icon:Frame},{id:'crop',name:'Crop',icon:CropIcon},{id:'filters',name:'Filters',icon:Palette},{id:'annotate',name:'Annotate',icon:PenLine},{id:'speed',name:'Speed',icon:Gauge}] as const;
function initialTheme(){try{return localStorage.getItem('snip-theme')|| (matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');}catch{return'light';}}
export default function App(){
  const [source,setSource]=useState<Source|null>(null),[edits,setEdits]=useState<Edits>(()=>defaults(0));
  const editsRef=useRef(edits);editsRef.current=edits;
  const [url,setUrl]=useState(''),[tool,setTool]=useState<Tool>('canvas'),[ready,setReady]=useState(false),[loading,setLoading]=useState(false);
  const [error,setError]=useState(''),[saved,setSaved]=useState('Saved on this device'),[draggingFile,setDraggingFile]=useState(false);
  const [playing,setPlaying]=useState(false),[time,setTime]=useState(0),[selectedClip,setSelectedClip]=useState('');
  const [showExport,setShowExport]=useState(false),[busy,setBusy]=useState(false),[progress,setProgress]=useState(0),[stage,setStage]=useState(''),[download,setDownload]=useState<Download|null>(null);
  const [offline,setOffline]=useState(false),[confirmClear,setConfirmClear]=useState(false),[theme,setTheme]=useState(initialTheme);
  const [frames,setFrames]=useState<{url:string;time:number}[]>([]),[selectedAnnotation,setSelectedAnnotation]=useState<string|null>(null),[drawMode,setDrawMode]=useState<DrawMode>('select'),[drawColor,setDrawColor]=useState('#ffffff');
  const videoRef=useRef<HTMLVideoElement>(null),inputRef=useRef<HTMLInputElement>(null),clearRef=useRef<HTMLDialogElement>(null),previewRef=useRef<HTMLElement>(null);
  const dragDepth=useRef(0),cancelled=useRef(false),loadLock=useRef(false),activeClip=useRef(0);
  const history=useRef<{past:Edits[];future:Edits[]}>({past:[],future:[]});const [,refreshHistory]=useState(0);
  const duration=sequenceDuration(edits),output=source?outputSize(source,edits):{width:0,height:0};

  useEffect(()=>{let active=true;restoreProject().then(project=>{if(active&&project){const next=migrateEdits(project.edits,project.source.duration);setSource(project.source);setEdits(next);editsRef.current=next;setSelectedClip(next.clips[0].id);}}).catch(()=>{if(active)setSaved('Local saving is unavailable');}).finally(()=>{if(active)setReady(true);});return()=>{active=false;};},[]);
  useEffect(()=>{if(!source){setUrl('');return;}const next=URL.createObjectURL(source.file);setUrl(next);return()=>URL.revokeObjectURL(next);},[source]);
  useEffect(()=>{setFrames([]);if(!url||!source)return;const controller=new AbortController();void thumbnails(url,source.duration,(image,time)=>setFrames(old=>[...old,{url:image,time}]),controller.signal);return()=>controller.abort();},[url,source]);
  useEffect(()=>{if(!source||!ready)return;let active=true;setSaved('Saving…');saveEdits(edits).then(()=>{if(active)setSaved('Saved on this device');}).catch(()=>{if(active)setSaved('Couldn’t save — storage is full');});return()=>{active=false;};},[edits,source,ready]);
  useEffect(()=>{if(videoRef.current){videoRef.current.playbackRate=edits.speed;videoRef.current.muted=edits.muted;}},[edits.speed,edits.muted,url]);
  useEffect(()=>{if(!download)return;return()=>URL.revokeObjectURL(download.url);},[download]);
  useEffect(()=>{document.documentElement.dataset.theme=theme;document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme==='dark'?'#171717':'#fafafa');try{localStorage.setItem('snip-theme',theme);}catch{/* Theme still works for this session. */}},[theme]);
  useEffect(()=>{if(!('serviceWorker'in navigator))return;const update=()=>setOffline(!!navigator.serviceWorker.controller);update();navigator.serviceWorker.addEventListener('controllerchange',update);return()=>navigator.serviceWorker.removeEventListener('controllerchange',update);},[]);
  useEffect(()=>{if(confirmClear)clearRef.current?.showModal();else clearRef.current?.close();},[confirmClear]);
  useEffect(()=>{if(!busy)return;const prevent=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',prevent);return()=>window.removeEventListener('beforeunload',prevent);},[busy]);

  useEffect(()=>{const visibility=()=>{if(document.hidden)videoRef.current?.pause();};document.addEventListener('visibilitychange',visibility);return()=>document.removeEventListener('visibilitychange',visibility);},[]);

  const checkpoint=useCallback(()=>{const h=history.current;const next=structuredClone(editsRef.current);if(JSON.stringify(h.past.at(-1))!==JSON.stringify(next))h.past=[...h.past.slice(-59),next];h.future=[];refreshHistory(v=>v+1);},[]);
  const apply=useCallback((next:Edits)=>{
    editsRef.current=next;setEdits(next);setDownload(null);
    const v=videoRef.current;let sourceTime=v?.currentTime??next.clips[0].start;
    let index=next.clips.findIndex((c,i)=>sourceTime>=c.start&&(sourceTime<c.end||(i===next.clips.length-1&&sourceTime<=c.end)));
    if(index<0){index=next.clips.findIndex(c=>c.start>=sourceTime);if(index<0)index=next.clips.length-1;sourceTime=next.clips[index].start;if(v)v.currentTime=sourceTime;}
    activeClip.current=index;setTime(toSequenceTime(sourceTime,next));setSelectedClip(old=>next.clips.some(c=>c.id===old)?old:next.clips[index].id);
  },[]);
  const update=useCallback((patch:Partial<Edits>,record=true)=>{if(record)checkpoint();apply({...editsRef.current,...(patch.crop?{resolution:'original'}:{}),...patch});},[apply,checkpoint]);
  const undo=useCallback(()=>{const h=history.current;if(!h.past.length)return;videoRef.current?.pause();h.future.push(structuredClone(editsRef.current));apply(h.past.pop()!);refreshHistory(v=>v+1);},[apply]);
  const redo=useCallback(()=>{const h=history.current;if(!h.future.length)return;videoRef.current?.pause();h.past.push(structuredClone(editsRef.current));apply(h.future.pop()!);refreshHistory(v=>v+1);},[apply]);
  const seek=useCallback((position:number)=>{const e=editsRef.current,p=toSourceTime(position,e);videoRef.current?.pause();if(videoRef.current)videoRef.current.currentTime=p.time;activeClip.current=p.index;setSelectedClip(e.clips[p.index].id);setTime(toSequenceTime(p.time,e));},[]);
  const togglePlayback=useCallback(()=>{
    const video=videoRef.current,e=editsRef.current;if(!video||busy)return;
    if(!video.paused)video.pause();else{if(video.currentTime>=e.clips.at(-1)!.end-.025||!e.clips.some(c=>video.currentTime>=c.start&&video.currentTime<c.end)){video.currentTime=e.clips[0].start;activeClip.current=0;}video.play().catch(()=>setError('Playback could not start. Try opening the video again.'));}
  },[busy]);
  useEffect(()=>{if(!playing)return;let frame=0;const tick=()=>{const v=videoRef.current,e=editsRef.current;if(!v)return;const c=e.clips[activeClip.current]||e.clips[0];
    if(v.currentTime>=c.end-.004){const next=e.clips[activeClip.current+1];if(next){activeClip.current++;v.currentTime=next.start;setSelectedClip(next.id);}else{v.pause();v.currentTime=c.end;setTime(sequenceDuration(e));return;}}
    if(v.currentTime<c.start-.01&&!v.seeking)v.currentTime=c.start;
    setTime(toSequenceTime(v.currentTime,e));frame=requestAnimationFrame(tick);};frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);},[playing]);
  const splitLocation=toSourceTime(time,edits),at=edits.clips[splitLocation.index];const canSplit=!!at&&splitLocation.time-at.start>=.1&&at.end-splitLocation.time>=.1;
  const split=useCallback(()=>{const e=editsRef.current,position=toSourceTime(time,e),c=e.clips[position.index];if(position.time-c.start<.1||c.end-position.time<.1)return;videoRef.current?.pause();const right={id:uid(),start:position.time,end:c.end};update({clips:[...e.clips.slice(0,position.index),{...c,end:position.time},right,...e.clips.slice(position.index+1)]});setSelectedClip(right.id);},[time,update]);
  const deleteClip=useCallback(()=>{const e=editsRef.current;if(e.clips.length<2)return;videoRef.current?.pause();update({clips:e.clips.filter(c=>c.id!==selectedClip)});},[selectedClip,update]);
  useEffect(()=>{const keyboard=(e:KeyboardEvent)=>{
    if(!source||showExport||busy||loading||confirmClear||(e.target as HTMLElement).closest('input,textarea,select,[contenteditable=true]'))return;
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();return;}
    if(e.code==='Space'&&!(e.target as HTMLElement).closest('button')){e.preventDefault();togglePlayback();}
    if((e.code==='ArrowLeft'||e.code==='ArrowRight')&&!(e.target as HTMLElement).closest('[role=slider],button')){e.preventDefault();seek(time+(e.code==='ArrowRight'?1:-1)*(e.shiftKey?1:1/30));}
    if(e.key.toLowerCase()==='s'&&!e.ctrlKey&&!e.metaKey){e.preventDefault();split();}
    if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();if(tool==='annotate'&&selectedAnnotation){update({annotations:editsRef.current.annotations.filter(a=>a.id!==selectedAnnotation)});setSelectedAnnotation(null);}else deleteClip();}
  };window.addEventListener('keydown',keyboard);return()=>window.removeEventListener('keydown',keyboard);},[source,showExport,busy,loading,confirmClear,undo,redo,togglePlayback,seek,time,split,tool,selectedAnnotation,update,deleteClip]);
  async function openFile(file?:File){
    if(!file||!ready||busy||loadLock.current)return;
    if(!file.type.startsWith('video/')&&!/\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(file.name)){setError('Choose a video file, like MP4 or WebM.');return;}
    if(!file.size||file.size>500*1024*1024){setError(!file.size?'This file is empty. Choose a video saved on your device.':'Choose a video under 500 MB for this little editor.');return;}
    loadLock.current=true;setLoading(true);setError('');videoRef.current?.pause();
    try{const next=await readMetadata(file),nextEdits=defaults(next.duration);await saveProject(next,nextEdits);setSource(next);setEdits(nextEdits);editsRef.current=nextEdits;setTime(0);activeClip.current=0;setSelectedClip(nextEdits.clips[0].id);setTool('canvas');setDownload(null);setSelectedAnnotation(null);history.current={past:[],future:[]};refreshHistory(v=>v+1);}
    catch(err){setError(err instanceof Error?err.message:'Couldn’t open or save this file. Your browser’s storage may be full.');}
    finally{setLoading(false);loadLock.current=false;if(inputRef.current)inputRef.current.value='';}
  }
  async function startExport(){
    if(!source||busy)return;videoRef.current?.pause();setBusy(true);setError('');setProgress(0);setDownload(null);cancelled.current=false;
    try{const blob=await exportVideo(source,edits,(fraction,label)=>{setProgress(fraction);setStage(label);});if(cancelled.current)return;const next={url:URL.createObjectURL(blob),name:`${source.name.replace(/\.[^.]+$/,'')}-snip.${edits.format}`,size:blob.size};setDownload(next);const a=document.createElement('a');a.href=next.url;a.download=next.name;document.body.appendChild(a);a.click();a.remove();}
    catch(err){if(!cancelled.current)setError(err instanceof Error?err.message:'Export failed. Try a smaller resolution.');}finally{setBusy(false);}
  }
  const stopExport=()=>{cancelled.current=true;cancelExport();setBusy(false);setProgress(0);};
  const removeProject=async()=>{try{await clearProject();videoRef.current?.pause();setSource(null);const next=defaults(0);setEdits(next);editsRef.current=next;setDownload(null);setConfirmClear(false);setError('');history.current={past:[],future:[]};}catch{setError('Couldn’t clear local storage. Please try again.');}};
  const toolChanged=(next:Tool)=>{setTool(next);if(next==='crop'||next==='annotate')videoRef.current?.pause();};
  const themeButton=<button className="icon-button theme-button" aria-label={`Switch to ${theme==='dark'?'light':'dark'} mode`} title={`Switch to ${theme==='dark'?'light':'dark'} mode`} onClick={()=>setTheme(theme==='dark'?'light':'dark')}>{theme==='dark'?<Sun size={17}/>:<Moon size={17}/>}</button>;
  return <div className={`app ${source?'has-video':''}`} onDragEnter={e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();dragDepth.current++;setDraggingFile(true);}}} onDragOver={e=>{if(e.dataTransfer.types.includes('Files'))e.preventDefault();}} onDragLeave={e=>{e.preventDefault();if(--dragDepth.current<=0){dragDepth.current=0;setDraggingFile(false);}}} onDrop={e=>{e.preventDefault();dragDepth.current=0;setDraggingFile(false);if(!showExport)void openFile(e.dataTransfer.files[0]);}}>
    <input ref={inputRef} type="file" id="video-file" accept="video/*,.mkv,.m4v" hidden onChange={e=>void openFile(e.target.files?.[0])}/>
    {draggingFile&&!busy&&<div className="drop-overlay"><Film size={36} strokeWidth={1.4}/><span>Drop it here.</span></div>}
    {!source?<><div className="empty-theme">{themeButton}</div><main className="empty-state"><div className="wordmark-wrap"><ScissorsMark className="snip-flourish"/><h1 className="wordmark">snip<span>.</span></h1></div><p className="tagline">a little video editor for web</p><button className="upload-zone" onClick={()=>inputRef.current?.click()} disabled={!ready||loading}><span className="upload-icon">{loading||!ready?<LoaderCircle className="spin" size={23}/>:<Plus size={25} strokeWidth={1.5}/>}</span><span className="upload-title">{loading?'Opening your video…':!ready?'Getting things ready…':'Open a video'}{ready&&!loading&&<ArrowUpRight size={16}/>}</span><span className="upload-hint">or drop one right here</span></button><p className="privacy-line">no watermarks <span aria-hidden="true">|</span> local in browser</p>{error&&<div className="inline-error" role="alert">{error}<button aria-label="Dismiss error" onClick={()=>setError('')}><X size={15}/></button></div>}</main></>:<main className="editor">
      <header className="editor-header"><a className="wordmark small" href="#" aria-label="snip video editor" onClick={e=>e.preventDefault()}><ScissorsMark className="header-mark"/><span className="brand-name">snip.</span></a><div className="file-info"><span title={source.name}>{source.name}</span><small role="status" title={offline?"Your video and edits are saved here. Available offline.":"Your video and edits stay in this browser."}><span className="status-dot"/>{saved}</small></div><div className="header-actions"><div className="history-actions"><button className="icon-button" aria-label="Undo" title="Undo (⌘ / Ctrl Z)" disabled={!history.current.past.length||busy||loading} onClick={undo}><Undo2 size={16}/></button><button className="icon-button" aria-label="Redo" title="Redo (⌘ / Ctrl Shift Z)" disabled={!history.current.future.length||busy||loading} onClick={redo}><Redo2 size={16}/></button></div><span className="header-divider"/>{themeButton}<button className="text-button new-video" disabled={busy||loading} onClick={()=>inputRef.current?.click()}><Plus size={14}/><span>{loading?'Opening…':'New video'}</span></button><button className="primary-button" disabled={busy||loading} onClick={()=>{videoRef.current?.pause();setDownload(null);setError('');setShowExport(true);}}><ArrowDownToLine size={15}/><span>Export video</span></button></div></header>
      <div className="workspace" inert={loading||busy}>
        <nav className="tool-rail" aria-label="Editing tools">{tools.map(({id,name,icon:Icon})=><button key={id} className={tool===id?'active':''} aria-pressed={tool===id} aria-label={name} onClick={()=>toolChanged(id)}><Icon size={19} strokeWidth={1.6}/><span>{name}</span>{((id==='filters'&&(edits.filter!=='Original'||edits.brightness!==0||edits.contrast!==0))||(id==='annotate'&&edits.annotations.length>0)||(id==='speed'&&edits.speed!==1)||(id==='crop'&&(edits.crop.width<.999||edits.crop.height<.999))||(id==='canvas'&&edits.canvas.aspect!=='Original'))&&<i/>}</button>)}<button className="remove-video" aria-label="Remove video and saved edits" title="Remove video and saved edits" onClick={()=>setConfirmClear(true)}><Trash2 size={17}/></button></nav>
        <ToolPanel source={source} edits={edits} tool={tool} selectedAnnotation={selectedAnnotation} drawMode={drawMode} drawColor={drawColor} thumbnail={frames[0]?.url} onUpdate={update} onCheckpoint={checkpoint} onAnnotation={setSelectedAnnotation} onDrawMode={setDrawMode} onDrawColor={setDrawColor}/>
        <section ref={previewRef} className="preview-panel" aria-label="Video preview"><div className="preview-topline"><span>Preview</span><span className="canvas-badge">{edits.canvas.aspect==='Original'?'Original frame':edits.canvas.aspect}<span>·</span>{output.width} × {output.height}</span><button className="icon-button" aria-label="Expand preview" title="Expand preview" onClick={()=>{if(document.fullscreenElement)void document.exitFullscreen();else void previewRef.current?.requestFullscreen().catch(()=>{});}}><Maximize2 size={14}/></button></div>
          <Preview source={source} edits={edits} url={url} tool={tool} videoRef={videoRef} drawMode={drawMode} drawColor={drawColor} selectedAnnotation={selectedAnnotation} onAnnotation={setSelectedAnnotation} onDrawMode={setDrawMode} onUpdate={update} onCheckpoint={checkpoint} onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onLoaded={()=>{const v=videoRef.current;if(v){v.currentTime=editsRef.current.clips[0].start;v.playbackRate=editsRef.current.speed;v.muted=editsRef.current.muted;activeClip.current=0;setTime(0);}}} onToggle={togglePlayback}/>
          <div className="player"><div className="player-buttons"><button className="icon-button" aria-label="Back to start" onClick={()=>seek(0)}><SkipBack size={15}/></button><button className="play-button" aria-label={playing?'Pause':'Play'} onClick={togglePlayback}>{playing?<Pause size={16} fill="currentColor"/>:<Play size={16} fill="currentColor"/>}</button><button className="icon-button" aria-label="Go to end" title="Go to end" onClick={()=>seek(duration)}><SkipForward size={15}/></button></div><span className="play-time">{formatTime(time)}<span>/</span>{formatTime(duration)}</span><input className="seek" type="range" aria-label="Seek video" min="0" max={duration} step="0.001" value={Math.min(time,duration)} onChange={e=>seek(Number(e.target.value))}/><select className="player-speed" aria-label="Playback speed" title="Video speed" value={edits.speed} onChange={e=>update({speed:Number(e.target.value)})}>{[.25,.5,.75,1,1.25,1.5,2,3,4].map(speed=><option key={speed} value={speed}>{speed}×</option>)}</select><button className="icon-button" aria-label={edits.muted?'Unmute video':'Mute video'} onClick={()=>update({muted:!edits.muted})}>{edits.muted?<VolumeX size={16}/>:<Volume2 size={16}/>}</button></div>
        </section>
        <Timeline source={source} edits={edits} time={time} selected={selectedClip} frames={frames} onSelect={setSelectedClip} onSeek={seek} onClips={(clips:Clip[])=>update({clips},false)} onCheckpoint={()=>{videoRef.current?.pause();checkpoint();}} onSplit={split} onDelete={deleteClip} canSplit={canSplit}/>
      </div>

      {error&&!showExport&&<div className="inline-error" role="alert">{error}<button aria-label="Dismiss error" onClick={()=>setError('')}><X size={15}/></button></div>}
    </main>}
    {!source&&<div className="page-footnote"><span className="tiny-dot"/>{offline?'ready when you’re offline, too.':'small edits. all yours.'}</div>}
    <ExportDialog open={showExport} source={source} edits={edits} busy={busy} progress={progress} stage={stage} download={download} error={error} onUpdate={update} onClose={()=>setShowExport(false)} onExport={()=>void startExport()} onCancel={stopExport}/>
    <dialog ref={clearRef} className="confirm-dialog" aria-labelledby="clear-title" onCancel={()=>setConfirmClear(false)} onClick={e=>{if(e.target===e.currentTarget)setConfirmClear(false);}}><div className="confirm-card"><h2 id="clear-title">Clear this video?</h2><p>This removes the video and edits saved in this browser. Your original file stays yours.</p><div><button className="text-button" autoFocus onClick={()=>setConfirmClear(false)}>Keep editing</button><button className="primary-button" onClick={()=>void removeProject()}>Clear video</button></div></div></dialog>
  </div>;
}
