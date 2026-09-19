import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, Check, ChevronRight, Crop as CropIcon, Film, FolderOpen, Frame, Gauge, Keyboard, Maximize2, Moon, Palette, Pause, PenLine, Play, Plus, Redo2, ShieldCheck, SkipBack, SkipForward, Sun, Undo2, Volume2, VolumeX, X } from 'lucide-react';
import { cancelExport, exportVideo } from './export';
import { clearProject, restoreProject, saveEdits, saveProject } from './storage';
import { defaults, formatTime, migrateEdits, outputSize, sequenceDuration, toSequenceTime, toSourceTime, uid } from './types';
import type { Clip, Edits, Source, Tool } from './types';
import { readMetadata, thumbnails } from './media';
import { createProjectFile, readProjectFile, MAX_VIDEO_SIZE } from './project-file';
import Preview from './components/Preview';
import type { DrawMode } from './components/Preview';
import Timeline from './components/Timeline';
import ToolPanel from './components/ToolPanel';
import ExportDialog from './components/ExportDialog';
import ScissorsMark from './components/ScissorsMark';
import ShortcutsDialog from './components/ShortcutsDialog';
import ProjectMenu from './components/ProjectMenu';
import { useEditorShortcuts } from './hooks/useEditorShortcuts';
import { useCompactLayout } from './hooks/useCompactLayout';
import type { Download } from './components/ExportDialog';
import { Button } from './components/ui/button';
import { Badge } from './components/ui/badge';
import { Card, CardPanel } from './components/ui/card';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from './components/ui/empty';
import { Tabs, TabsList, TabsTab, TabsPanel } from './components/ui/tabs';
import { Slider } from './components/ui/slider';
import { Field, FieldLabel } from './components/ui/field';
import { Separator } from './components/ui/separator';
import { Kbd } from './components/ui/kbd';
import { Alert, AlertDescription } from './components/ui/alert';
import { AlertDialog, AlertDialogPopup, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogClose } from './components/ui/alert-dialog';
import { TooltipProvider } from './components/ui/tooltip';
import EditorSelect from './components/EditorSelect';
import IconButton from './components/IconButton';
const tools=[{id:'canvas',name:'Frame',icon:Frame},{id:'crop',name:'Crop',icon:CropIcon},{id:'filters',name:'Filters',icon:Palette},{id:'annotate',name:'Annotate',icon:PenLine},{id:'speed',name:'Speed',icon:Gauge}] as const;
function initialTheme(){try{return localStorage.getItem('snip-theme')|| (matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');}catch{return'light';}}
export default function App(){
  const compact=useCompactLayout();
  const [panelOpen,setPanelOpen]=useState(false),[showShortcuts,setShowShortcuts]=useState(false),[showMenu,setShowMenu]=useState(false),[timelineZoom,setTimelineZoom]=useState(1);
  const [source,setSource]=useState<Source|null>(null),[edits,setEdits]=useState<Edits>(()=>defaults(0));
  const editsRef=useRef(edits);editsRef.current=edits;
  const [url,setUrl]=useState(''),[tool,setTool]=useState<Tool>('canvas'),[ready,setReady]=useState(false),[loading,setLoading]=useState(false);
  const [notice,setNotice]=useState(''),[projectDownload,setProjectDownload]=useState<Download|null>(null);
  const [error,setError]=useState(''),[saved,setSaved]=useState('Saved on this device'),[draggingFile,setDraggingFile]=useState(false);
  const [playing,setPlaying]=useState(false),[time,setTime]=useState(0),[selectedClip,setSelectedClip]=useState('');
  const [showExport,setShowExport]=useState(false),[busy,setBusy]=useState(false),[progress,setProgress]=useState(0),[stage,setStage]=useState(''),[download,setDownload]=useState<Download|null>(null);
  const [offline,setOffline]=useState(false),[confirmClear,setConfirmClear]=useState(false),[theme,setTheme]=useState(initialTheme);
  const [frames,setFrames]=useState<{url:string;time:number}[]>([]),[selectedAnnotation,setSelectedAnnotation]=useState<string|null>(null),[drawMode,setDrawMode]=useState<DrawMode>('select'),[drawColor,setDrawColor]=useState('#ffffff');
  const videoRef=useRef<HTMLVideoElement>(null),inputRef=useRef<HTMLInputElement>(null),projectInputRef=useRef<HTMLInputElement>(null),previewRef=useRef<HTMLElement>(null);
  const dragDepth=useRef(0),cancelled=useRef(false),loadLock=useRef(false),activeClip=useRef(0);
  const history=useRef<{past:Edits[];future:Edits[]}>({past:[],future:[]});const [,refreshHistory]=useState(0);
  const duration=sequenceDuration(edits),output=source?outputSize(source,edits):{width:0,height:0};

  useEffect(()=>{let active=true;restoreProject().then(project=>{if(active&&project){const next=migrateEdits(project.edits,project.source.duration);setSource(project.source);setEdits(next);editsRef.current=next;setSelectedClip(next.clips[0].id);}}).catch(()=>{if(active)setSaved('Local saving is unavailable');}).finally(()=>{if(active)setReady(true);});return()=>{active=false;};},[]);
  useEffect(()=>{if(!source){setUrl('');return;}const next=URL.createObjectURL(source.file);setUrl(next);return()=>URL.revokeObjectURL(next);},[source]);
  useEffect(()=>{setFrames([]);if(!url||!source)return;const controller=new AbortController();void thumbnails(url,source.duration,(image,time)=>setFrames(old=>[...old,{url:image,time}]),controller.signal);return()=>controller.abort();},[url,source]);
  useEffect(()=>{if(!source||!ready)return;let active=true;setSaved('Saving…');saveEdits(edits).then(()=>{if(active)setSaved('Saved on this device');}).catch(()=>{if(active)setSaved('Couldn’t save — storage is full');});return()=>{active=false;};},[edits,source,ready]);
  useEffect(()=>{if(videoRef.current){videoRef.current.playbackRate=edits.speed;videoRef.current.muted=edits.muted;}},[edits.speed,edits.muted,url]);
  useEffect(()=>{if(!download)return;return()=>URL.revokeObjectURL(download.url);},[download]);
  useEffect(()=>{if(!projectDownload)return;return()=>URL.revokeObjectURL(projectDownload.url);},[projectDownload]);
  useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),6000);return()=>clearTimeout(timer);},[notice,projectDownload]);
  useEffect(()=>{document.documentElement.dataset.theme=theme;document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme==='dark'?'#171717':'#fafafa');try{localStorage.setItem('snip-theme',theme);}catch{/* Theme still works for this session. */}},[theme]);
  useEffect(()=>{if(!('serviceWorker'in navigator))return;const update=()=>setOffline(!!navigator.serviceWorker.controller);update();navigator.serviceWorker.addEventListener('controllerchange',update);return()=>navigator.serviceWorker.removeEventListener('controllerchange',update);},[]);
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
    if(!video.paused)video.pause();else{if(video.currentTime>=e.clips.at(-1)!.end-.025||!e.clips.some(c=>video.currentTime>=c.start&&video.currentTime<c.end)){video.currentTime=e.clips[0].start;activeClip.current=0;}video.play().catch(error=>{if(error instanceof DOMException&&error.name==='AbortError')return;setError('Playback could not start. Try opening the video again.');});}
  },[busy]);
  useEffect(()=>{if(!playing)return;let frame=0;const tick=()=>{const v=videoRef.current,e=editsRef.current;if(!v)return;const c=e.clips[activeClip.current]||e.clips[0];
    if(v.currentTime>=c.end-.004){const next=e.clips[activeClip.current+1];if(next){activeClip.current++;v.currentTime=next.start;setSelectedClip(next.id);}else{v.pause();v.currentTime=c.end;setTime(sequenceDuration(e));return;}}
    if(v.currentTime<c.start-.01&&!v.seeking)v.currentTime=c.start;
    setTime(toSequenceTime(v.currentTime,e));frame=requestAnimationFrame(tick);};frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);},[playing]);
  const splitLocation=toSourceTime(time,edits),at=edits.clips[splitLocation.index];const canSplit=!!at&&splitLocation.time-at.start>=.1&&at.end-splitLocation.time>=.1;
  const split=useCallback(()=>{const e=editsRef.current,position=toSourceTime(time,e),c=e.clips[position.index];if(position.time-c.start<.1||c.end-position.time<.1)return;videoRef.current?.pause();const right={id:uid(),start:position.time,end:c.end};update({clips:[...e.clips.slice(0,position.index),{...c,end:position.time},right,...e.clips.slice(position.index+1)]});setSelectedClip(right.id);},[time,update]);
  const deleteClip=useCallback(()=>{const e=editsRef.current;if(e.clips.length<2)return;videoRef.current?.pause();update({clips:e.clips.filter(c=>c.id!==selectedClip)});},[selectedClip,update]);
  const openExport=()=>{if(!source||busy||loading)return;videoRef.current?.pause();setDownload(null);setError('');setShowExport(true);};
  const expandPreview=()=>{if(document.fullscreenElement)void document.exitFullscreen();else void previewRef.current?.requestFullscreen?.().catch(()=>{});};
  const toolChanged=(next:Tool,toggle=true)=>{setPanelOpen(compact&&toggle&&next===tool?!panelOpen:true);setTool(next);if(next==='crop'||next==='annotate')videoRef.current?.pause();};
  const closeSettings=()=>{setPanelOpen(false);setSelectedAnnotation(null);setDrawMode('select');document.querySelector<HTMLButtonElement>(`.tool-rail button[data-tool="${tool}"]`)?.focus();};
  const seekCut=(direction:number)=>{
    const e=editsRef.current,position=toSequenceTime(videoRef.current?.currentTime??e.clips[0].start,e),cuts=[0];
    e.clips.forEach(c=>cuts.push(cuts.at(-1)!+(c.end-c.start)/e.speed));
    seek(direction>0?(cuts.find(t=>t>position+.01)??cuts.at(-1)!):([...cuts].reverse().find(t=>t<position-.01)??0));
  };
  const trimAtPlayhead=(edge:'start'|'end')=>{
    const e=editsRef.current,p=toSourceTime(toSequenceTime(videoRef.current?.currentTime??0,e),e),c=e.clips[p.index];
    if(edge==='start'?(p.time-c.start<.001||c.end-p.time<.1):(c.end-p.time<.001||p.time-c.start<.1))return;
    videoRef.current?.pause();update({clips:e.clips.map((clip,i)=>i===p.index?{...clip,[edge]:p.time}:clip)});
  };
  const deleteSelection=()=>{if(tool==='annotate'&&selectedAnnotation&&(!compact||panelOpen)){update({annotations:editsRef.current.annotations.filter(a=>a.id!==selectedAnnotation)});setSelectedAnnotation(null);}else deleteClip();};
  useEditorShortcuts({hasVideo:!!source,blocked:busy||loading||!ready||showExport||showShortcuts||confirmClear||showMenu,
    play:togglePlayback,seekBy:seconds=>seek(toSequenceTime(videoRef.current?.currentTime??0,editsRef.current)+seconds),seekEdge:end=>seek(end?sequenceDuration(editsRef.current):0),seekCut,
    split,remove:deleteSelection,trim:trimAtPlayhead,undo,redo,mute:()=>update({muted:!editsRef.current.muted}),
    speed:direction=>{const speeds=[.25,.5,.75,1,1.25,1.5,2,3,4],i=speeds.indexOf(editsRef.current.speed),speed=speeds[Math.max(0,Math.min(speeds.length-1,i+direction))];if(speed!==editsRef.current.speed)update({speed});},
    zoom:direction=>setTimelineZoom(value=>Math.max(1,Math.min(8,value+direction))),tool:next=>toolChanged(next,false),expand:expandPreview,
    open:()=>inputRef.current?.click(),openProject:()=>projectInputRef.current?.click(),saveProject:downloadProject,export:openExport,help:()=>{videoRef.current?.pause();setShowShortcuts(true);},
    escape:()=>{setSelectedAnnotation(null);setDrawMode('select');if(compact)closeSettings();},
  });
  function downloadProject(){
    if(!source||busy||loading)return;
    try{
      const {blob,name}=createProjectFile(source,editsRef.current),next={url:URL.createObjectURL(blob),name,size:blob.size};
      const a=document.createElement('a');a.href=next.url;a.download=next.name;document.body.appendChild(a);a.click();a.remove();
      setProjectDownload(next);setNotice('Project download started');setError('');
    }catch(err){setError(err instanceof Error?err.message:'Couldn’t save this project. Please try again.');}
  }
  async function openFile(file?:File,project=false){
    if(!file||!ready||busy||loadLock.current)return;
    const isProject=project||/\.snip$/i.test(file.name);
    if(!isProject&&!file.type.startsWith('video/')&&!/\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(file.name)){setError('Choose a video or a saved .snip project.');if(inputRef.current)inputRef.current.value='';return;}
    if(!isProject&&(!file.size||file.size>MAX_VIDEO_SIZE)){setError(!file.size?'This file is empty. Choose a video saved on your device.':'Choose a video under 500 MB for this little editor.');if(inputRef.current)inputRef.current.value='';return;}
    loadLock.current=true;setLoading(true);setError('');setNotice('');videoRef.current?.pause();
    try{
      const nextProject=isProject?await readProjectFile(file):await readMetadata(file).then(source=>({source,edits:defaults(source.duration)}));
      const {source:next,edits:nextEdits}=nextProject;
      await saveProject(next,nextEdits);
      setSource(next);setEdits(nextEdits);editsRef.current=nextEdits;setTime(0);activeClip.current=0;setSelectedClip(nextEdits.clips[0].id);setTool('canvas');setPanelOpen(false);setTimelineZoom(1);setDownload(null);setProjectDownload(null);setSelectedAnnotation(null);setDrawMode('select');history.current={past:[],future:[]};refreshHistory(v=>v+1);
      if(isProject)setNotice('Project opened');
    }catch(err){setError(err instanceof Error?err.message:'Couldn’t open or save this file. Your browser’s storage may be full.');}
    finally{setLoading(false);loadLock.current=false;if(inputRef.current)inputRef.current.value='';if(projectInputRef.current)projectInputRef.current.value='';}
  }
  async function startExport(){
    if(!source||busy)return;videoRef.current?.pause();setBusy(true);setError('');setProgress(0);setDownload(null);cancelled.current=false;
    try{const blob=await exportVideo(source,edits,(fraction,label)=>{setProgress(fraction);setStage(label);});if(cancelled.current)return;const next={url:URL.createObjectURL(blob),name:`${source.name.replace(/\.[^.]+$/,'')}-snip.${edits.format}`,size:blob.size};setDownload(next);const a=document.createElement('a');a.href=next.url;a.download=next.name;document.body.appendChild(a);a.click();a.remove();}
    catch(err){if(!cancelled.current)setError(err instanceof Error?err.message:'Export failed. Try a smaller resolution.');}finally{setBusy(false);}
  }
  const stopExport=()=>{cancelled.current=true;cancelExport();setBusy(false);setProgress(0);};
  const removeProject=async()=>{try{await clearProject();videoRef.current?.pause();setSource(null);const next=defaults(0);setEdits(next);editsRef.current=next;setDownload(null);setConfirmClear(false);setProjectDownload(null);setNotice('');setError('');history.current={past:[],future:[]};}catch{setError('Couldn’t clear local storage. Please try again.');}};
  const themeButton = <IconButton label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun /> : <Moon />}</IconButton>;
  const brand = <div className="flex shrink-0 items-center gap-2.5"><ScissorsMark className="size-6 text-primary" /><span className="text-2xl font-bold tracking-tight">snip<span className="text-primary">.</span></span></div>;
  const errorAlert = error && !showExport && <Alert variant="error" className="mt-4"><AlertDescription className="flex items-center justify-between gap-3">{error}<Button variant="ghost" size="icon-sm" aria-label="Dismiss error" onClick={() => setError('')}><X /></Button></AlertDescription></Alert>;
  return <TooltipProvider><div className={`app min-h-svh ${source ? 'has-video' : ''}`} onDragEnter={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); dragDepth.current++; setDraggingFile(true); } }} onDragOver={e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }} onDragLeave={e => { e.preventDefault(); if (--dragDepth.current <= 0) { dragDepth.current = 0; setDraggingFile(false); } }} onDrop={e => { e.preventDefault(); dragDepth.current = 0; setDraggingFile(false); if (!showExport && !showShortcuts && !confirmClear) void openFile(e.dataTransfer.files[0]); }}>
    <input ref={inputRef} type="file" id="video-file" accept="video/*,.mkv,.m4v" hidden onChange={e => void openFile(e.target.files?.[0])} />
    <input ref={projectInputRef} type="file" id="project-file" accept=".snip" hidden onChange={e => void openFile(e.target.files?.[0],true)} />
    {draggingFile && !busy && <div className="pointer-events-none fixed inset-4 z-50 flex items-center justify-center bg-background/95"><Empty><EmptyHeader><EmptyMedia variant="icon"><Film /></EmptyMedia><EmptyTitle>Drop your video or project</EmptyTitle><EmptyDescription>Everything stays on this device.</EmptyDescription></EmptyHeader></Empty></div>}
    <header className="editor-header flex min-h-18 items-center gap-4 border-b bg-card px-4 py-4 sm:px-6">
      {brand}
      <Separator orientation="vertical" className="mx-1 hidden h-6 sm:block" />
      {source ? <div className="file-info hidden min-w-0 flex-1 items-center gap-3 sm:flex"><span className="hidden text-sm text-muted-foreground lg:inline">Workspace</span><ChevronRight className="hidden size-3.5 text-muted-foreground lg:block" /><span className="truncate text-sm font-medium" title={source.name}>{source.name}</span></div> : <span className="hidden text-sm text-muted-foreground sm:inline">A little video editor for web</span>}
      <div className="header-actions ml-auto flex shrink-0 items-center gap-2">
        {source && <><span className="hidden items-center gap-1.5 text-xs text-muted-foreground xl:flex" role="status" title={offline ? 'Your video and edits are saved here. Available offline.' : 'Your video and edits stay in this browser.'}><Check className="size-3.5" />{loading ? 'Opening…' : saved}</span><div className="history-actions hidden items-center min-[901px]:flex"><IconButton label="Undo" aria-keyshortcuts="Control+Z Meta+Z" disabled={!history.current.past.length || busy || loading} onClick={undo}><Undo2 /></IconButton><IconButton label="Redo" disabled={!history.current.future.length || busy || loading} onClick={redo}><Redo2 /></IconButton></div><span className="hidden min-[901px]:contents">{themeButton}</span><ProjectMenu disabled={busy || loading} theme={theme} onOpenChange={open => { setShowMenu(open); if (open) videoRef.current?.pause(); }} onOpen={() => inputRef.current?.click()} onOpenProject={() => projectInputRef.current?.click()} onSaveProject={downloadProject} onTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')} onHelp={() => setShowShortcuts(true)} onClear={() => setConfirmClear(true)} /><Button aria-label="Export video" aria-keyshortcuts="Control+E Meta+E" disabled={busy || loading} onClick={openExport}><ArrowDownToLine /><span className="sm:hidden">Export</span><span className="hidden sm:inline">Export video</span></Button></>}
        {!source && <><IconButton label="Keyboard shortcuts" onClick={() => setShowShortcuts(true)}><Keyboard /></IconButton>{themeButton}</>}
      </div>
    </header>
    {!source ? <main className="mx-auto flex min-h-[calc(100svh-73px)] max-w-4xl flex-col justify-center gap-8 px-4 py-12 sm:px-8">
      <div className="text-center"><Badge variant="outline"><ShieldCheck />Private by default</Badge><h1 className="mt-6 text-4xl font-semibold tracking-tight sm:text-5xl">A small edit.<br /><span className="text-muted-foreground">A better video.</span></h1><p className="mt-4 text-sm leading-relaxed text-muted-foreground">Trim the extra. Set the frame. Make it yours.</p></div>
      <Card><CardPanel><Empty className="py-10 md:py-12"><EmptyHeader><EmptyMedia variant="icon"><Film /></EmptyMedia><EmptyTitle>Your next edit starts here</EmptyTitle><EmptyDescription>Drop a video or a .snip project here.<br />MP4, WebM, MOV and more · up to 500 MB</EmptyDescription></EmptyHeader><EmptyContent><div className="flex flex-wrap justify-center gap-2"><Button size="lg" disabled={!ready || loading} loading={loading || !ready} onClick={() => inputRef.current?.click()}><Plus />{loading ? 'Opening your file…' : !ready ? 'Getting ready…' : 'Open a video'}</Button><Button size="lg" variant="outline" disabled={!ready || loading} onClick={() => projectInputRef.current?.click()}><FolderOpen />Open project</Button></div><span className="text-xs text-muted-foreground">No account. No uploads. No watermark.</span></EmptyContent></Empty></CardPanel></Card>
      <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground"><span className="flex items-center gap-1.5"><ShieldCheck className="size-3.5" />Local in your browser</span><span>Original files stay untouched</span><span>{offline ? 'Ready to work offline' : 'Small edits. All yours.'}</span></div>
      {errorAlert}
    </main> : <main className="editor mx-auto max-w-[1920px] p-3 sm:p-5">
      <div className="mb-4 flex min-w-0 items-center justify-between gap-3 sm:hidden"><span className="truncate text-xs font-medium">{source.name}</span><span className="shrink-0 text-[10px] text-muted-foreground" role="status">{loading ? 'Opening…' : saved}</span></div>
      <div className="workspace" data-panel-open={panelOpen} inert={loading || busy}>
        <Card render={<section ref={previewRef} aria-label="Video preview" />} className="preview-panel">
          <div className="preview-topline flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3"><div className="flex items-center gap-2 text-sm font-medium"><Film className="size-4 text-muted-foreground" />Preview</div><div className="flex items-center gap-2"><Badge variant="outline" className="canvas-badge max-sm:text-[10px]">{output.width} × {output.height}<span className="hidden sm:inline">· {edits.canvas.aspect === 'Original' ? 'Original' : edits.canvas.aspect}</span></Badge><IconButton label="Expand preview" aria-keyshortcuts="F" onClick={expandPreview}><Maximize2 /></IconButton></div></div>
          <Preview source={source} edits={edits} url={url} tool={compact && !panelOpen ? 'canvas' : tool} videoRef={videoRef} drawMode={drawMode} drawColor={drawColor} selectedAnnotation={selectedAnnotation} onAnnotation={setSelectedAnnotation} onDrawMode={setDrawMode} onUpdate={update} onCheckpoint={checkpoint} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onLoaded={() => { const v = videoRef.current; if (v) { v.currentTime = editsRef.current.clips[0].start; v.playbackRate = editsRef.current.speed; v.muted = editsRef.current.muted; activeClip.current = 0; setTime(0); } }} onToggle={togglePlayback} />
          <div className="player"><div className="player-buttons flex items-center gap-1"><IconButton label="Back to start" onClick={() => seek(0)}><SkipBack /></IconButton><Button size="icon" aria-label={playing ? 'Pause' : 'Play'} aria-keyshortcuts="Space K" onClick={togglePlayback}>{playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}</Button><IconButton label="Go to end" onClick={() => seek(duration)}><SkipForward /></IconButton></div><span className="play-time whitespace-nowrap text-center font-mono text-xs tabular-nums">{formatTime(time)} <span className="text-muted-foreground">/ {formatTime(duration)}</span></span><Field className="seek"><FieldLabel className="sr-only">Seek video</FieldLabel><Slider min={0} max={duration} step={.001} value={Math.min(time,duration)} onValueChange={value => seek(Array.isArray(value) ? value[0] : value)} /></Field><EditorSelect label="Playback speed" className="player-speed w-18 min-w-0" value={String(edits.speed)} options={[.25,.5,.75,1,1.25,1.5,2,3,4].map(speed => ({ value: String(speed), label: `${speed}×` }))} onChange={value => update({ speed: Number(value) })} /><IconButton label={edits.muted ? 'Unmute video' : 'Mute video'} onClick={() => update({ muted: !edits.muted })}>{edits.muted ? <VolumeX /> : <Volume2 />}</IconButton></div>
        </Card>
        <Card className="inspector-shell"><Tabs value={tool} onValueChange={value => toolChanged(value as Tool,false)} className="min-h-0 flex-1 gap-0 overflow-hidden">
          <div className="flex items-center justify-between px-5 pt-5 pb-3"><h2 className="text-xs font-medium tracking-wide text-muted-foreground">EDIT VIDEO</h2><Badge variant="secondary">{edits.clips.length} {edits.clips.length === 1 ? 'clip' : 'clips'}</Badge></div>
          <TabsList className="tool-rail w-full border-b px-2" variant="underline" aria-label="Editing tools">{tools.map(({ id, name, icon: Icon }, index) => <TabsTab key={id} value={id} className="flex-col gap-1.5 px-1 py-2.5 text-xs sm:text-xs" aria-label={name} data-tool={id} aria-keyshortcuts={String(index+1)} onClick={() => { if (compact && tool === id) setPanelOpen(!panelOpen); }}><Icon className="size-4" /><span>{name}</span></TabsTab>)}</TabsList>
          <TabsPanel value={tool} className="min-h-0 overflow-y-auto" hidden={compact && !panelOpen}><ToolPanel hidden={compact && !panelOpen} onClose={closeSettings} source={source} edits={edits} tool={tool} selectedAnnotation={selectedAnnotation} drawMode={drawMode} drawColor={drawColor} thumbnail={frames[0]?.url} onUpdate={update} onCheckpoint={checkpoint} onAnnotation={setSelectedAnnotation} onDrawMode={setDrawMode} onDrawColor={setDrawColor} /></TabsPanel>
        </Tabs></Card>
        <Timeline zoom={timelineZoom} onZoom={setTimelineZoom} onUndo={undo} onRedo={redo} canUndo={history.current.past.length > 0} canRedo={history.current.future.length > 0} source={source} edits={edits} time={time} selected={selectedClip} frames={frames} onSelect={setSelectedClip} onSeek={seek} onClips={(clips: Clip[]) => update({ clips },false)} onCheckpoint={() => { videoRef.current?.pause(); checkpoint(); }} onSplit={split} onDelete={deleteClip} canSplit={canSplit} />
      </div>
      <footer className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span className="flex items-center gap-2"><ShieldCheck className="size-3.5" />{offline ? 'Saved locally · available offline' : 'Your video stays on this device'}</span><Button size="xs" variant="ghost" onClick={() => { videoRef.current?.pause(); setShowShortcuts(true); }} aria-label="Keyboard shortcuts"><Keyboard />Keyboard shortcuts<Kbd>?</Kbd></Button></footer>
      {notice && <Alert className="mt-4"><AlertDescription className="flex flex-wrap items-center gap-2">{notice}{projectDownload && <Button size="sm" variant="link" render={<a href={projectDownload.url} download={projectDownload.name} />}>Download again</Button>}</AlertDescription></Alert>}
      {errorAlert}
    </main>}
    <ShortcutsDialog open={showShortcuts} onClose={() => setShowShortcuts(false)} />
    <ExportDialog open={showExport} source={source} edits={edits} busy={busy} progress={progress} stage={stage} download={download} error={error} onUpdate={update} onClose={() => setShowExport(false)} onExport={() => void startExport()} onCancel={stopExport} />
    <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}><AlertDialogPopup><AlertDialogHeader><AlertDialogTitle>Clear this video?</AlertDialogTitle><AlertDialogDescription>This removes the video and edits saved in this browser. Your original file stays yours.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogClose render={<Button variant="outline" />}>Keep editing</AlertDialogClose><Button variant="destructive" onClick={() => void removeProject()}>Clear video</Button></AlertDialogFooter></AlertDialogPopup></AlertDialog>
  </div></TooltipProvider>;
}
