import { inspectExport } from './media-analysis';
import { applyCommands, compileTimeline, createSpecification, EditSession, normalizeEdits, object } from './engine';
import type { Command } from './engine';
import { identifySource } from './engine/source';
import { captureSourceFrame } from './agent-frame';
import { connectAgent } from './agent-connection';
import type { AgentHandler } from './agent-connection';
import AgentOnboarding from './components/AgentOnboarding';
import ChatEditor from './components/ChatEditor';
import { requestChatEdit } from './chat';
import { Card } from './components/ui/card';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpRight, Film, ListVideo, MessageSquare, FolderOpen, Maximize2, Moon, Pause, Play, Plus, Sun, Volume2, VolumeX, X } from 'lucide-react';
import { cancelExport, exportVideo } from './export';
import { createPlayback } from './playback';
import { clearProject, restoreProject, saveEdits, saveProject, saveSource } from './storage';
import { defaultZoom, zoomPresets, trimBounds, clamp, speedPresets, canMergeClips, clipDuration, clipSpeed, defaults, formatTime, migrateEdits, sequenceDuration, toSequenceTime, toSourceTime, uid } from './types';
import type { Clip, Edits, Source } from './types';
import { readMetadata, thumbnails } from './media';
import { createProjectFile, readProjectFile, MAX_VIDEO_SIZE } from './project-file';
import Preview from './components/Preview';
import Timeline from './components/Timeline';
import ExportDialog from './components/ExportDialog';
import ScissorsMark from './components/ScissorsMark';
import ShortcutsDialog from './components/ShortcutsDialog';
import ProjectMenu from './components/ProjectMenu';
import { useEditorShortcuts } from './hooks/useEditorShortcuts';
import { useFilePaste } from './hooks/useFilePaste';
import type { Download } from './components/ExportDialog';
import { Button } from './components/ui/button';
import { Spinner } from './components/ui/spinner';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from './components/ui/empty';
import { Alert, AlertDescription } from './components/ui/alert';
import { AlertDialog, AlertDialogPopup, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogClose } from './components/ui/alert-dialog';
import { TooltipProvider } from './components/ui/tooltip';
import IconButton from './components/IconButton';
function initialTheme(){try{return localStorage.getItem('snip-theme')|| (matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');}catch{return'light';}}
export default function App(){
  const [agentToken,setAgentToken]=useState(()=>new URLSearchParams(location.hash.slice(1)).get('agent'));
  useEffect(()=>{
    const readPairingLink=()=>{
      const token=new URLSearchParams(location.hash.slice(1)).get('agent');
      if(!token)return;
      window.history.replaceState(null,'',location.pathname+location.search);
      setAgentToken(token);
    };
    readPairingLink();window.addEventListener('hashchange',readPairingLink);
    return()=>window.removeEventListener('hashchange',readPairingLink);
  },[]);
  const [editorMode,setEditorMode]=useState('timeline');
  const applyBatchRef=useRef<(value:unknown)=>ReturnType<EditSession['apply']>>(()=>{throw new Error('Editor is loading.');});
  const [agentStatus,setAgentStatus]=useState('');
  const [agentBridge,setAgentBridge]=useState('');
  const capturingFrame=useRef(false);
  const disconnectAgent=useRef<(()=>void)|null>(null),agentHandler=useRef<AgentHandler>(async()=>{throw new Error('Editor is loading.');});
  const session=useRef(new EditSession(uid())),exportLock=useRef(false),pointerActive=useRef(false);
  const exportJob=useRef<{id:string;sessionId:string;revision:number;status:string;progress:number;name?:string;size?:number;error?:string}|null>(null);
  const exportRequests=useRef(new Set<string>());
  useEffect(()=>()=>disconnectAgent.current?.(),[]);
  useEffect(()=>{const down=()=>{pointerActive.current=true;},up=()=>{pointerActive.current=false;};window.addEventListener('pointerdown',down,true);window.addEventListener('pointerup',up,true);window.addEventListener('pointercancel',up,true);window.addEventListener('blur',up);return()=>{window.removeEventListener('pointerdown',down,true);window.removeEventListener('pointerup',up,true);window.removeEventListener('pointercancel',up,true);window.removeEventListener('blur',up);};},[]);
  const [actionsOpen,setActionsOpen]=useState(false),[showShortcuts,setShowShortcuts]=useState(false),[showMenu,setShowMenu]=useState(false),[timelineZoom,setTimelineZoom]=useState(1);
  const [source,setSource]=useState<Source|null>(null),[edits,setEdits]=useState<Edits>(()=>defaults(0));
  const editsRef=useRef(edits);editsRef.current=edits;
  const [url,setUrl]=useState(''),[ready,setReady]=useState(false),[loading,setLoading]=useState(false);
  const [notice,setNotice]=useState(''),[projectDownload,setProjectDownload]=useState<Download|null>(null);
  const [error,setError]=useState(''),[saved,setSaved]=useState('saved on this device'),[draggingFile,setDraggingFile]=useState(false);
  const [playing,setPlaying]=useState(false),[time,setTime]=useState(0),[selectedClip,setSelectedClip]=useState('');
  const [showExport,setShowExport]=useState(false),[busy,setBusy]=useState(false),[progress,setProgress]=useState(0),[stage,setStage]=useState(''),[download,setDownload]=useState<Download|null>(null);
  const [confirmClear,setConfirmClear]=useState(false),[theme,setTheme]=useState(initialTheme);
  const [frames,setFrames]=useState<{url:string;time:number}[]>([]);
  const videoRef=useRef<HTMLVideoElement>(null),inputRef=useRef<HTMLInputElement>(null),projectInputRef=useRef<HTMLInputElement>(null),previewRef=useRef<HTMLElement>(null);
  const dragDepth=useRef(0),cancelled=useRef(false),loadLock=useRef(false),activeClip=useRef(0);
  const playback=useRef<ReturnType<typeof createPlayback> | null>(null);
  const pausePlayback=useCallback(()=>{playback.current?.pause();videoRef.current?.pause();},[]);
  const history=useRef<{past:Edits[];future:Edits[]}>({past:[],future:[]});const [,refreshHistory]=useState(0);
  const duration=sequenceDuration(edits);

  useEffect(()=>{let active=true;restoreProject().then(project=>{if(active&&project){const next=migrateEdits(project.edits,project.source.duration);setSource(project.source);setEdits(next);editsRef.current=next;setSelectedClip(next.clips[0].id);}}).catch(()=>{if(active)setSaved('local saving is unavailable');}).finally(()=>{if(active)setReady(true);});return()=>{active=false;};},[]);
  useEffect(()=>{if(!source){setUrl('');return;}const next=URL.createObjectURL(source.file);setUrl(next);return()=>URL.revokeObjectURL(next);},[source?.file]);
  useEffect(()=>{setFrames([]);if(!url||!source)return;const controller=new AbortController();void thumbnails(url,source.duration,(image,time)=>setFrames(old=>[...old,{url:image,time}]),controller.signal);return()=>controller.abort();},[url,source?.duration]);
  useEffect(()=>{if(!source||!ready)return;let active=true;setSaved('saving…');saveEdits(edits).then(()=>{if(active)setSaved('saved on this device');}).catch(()=>{if(active)setSaved('couldn’t save — storage is full');});return()=>{active=false;};},[edits,source,ready]);
  useEffect(()=>{
    const video=videoRef.current;if(!video||!url)return;
    const controller=createPlayback(video,{edits:editsRef,activeClip,onTime:setTime,onClip:setSelectedClip,onPlaying:setPlaying,onError:setError});
    playback.current=controller;
    return()=>{controller.dispose();if(playback.current===controller)playback.current=null;};
  },[url]);
  useEffect(()=>{if(videoRef.current){const rate=clipSpeed(edits.clips[activeClip.current] || edits.clips[0],edits);if(videoRef.current.playbackRate!==rate)videoRef.current.playbackRate=rate;videoRef.current.muted=edits.muted;}},[edits, time, url]);
  useEffect(()=>{if(!download)return;return()=>URL.revokeObjectURL(download.url);},[download]);
  useEffect(()=>{if(!projectDownload)return;return()=>URL.revokeObjectURL(projectDownload.url);},[projectDownload]);
  useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),6000);return()=>clearTimeout(timer);},[notice,projectDownload]);
  useEffect(()=>{document.documentElement.dataset.theme=theme;document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme==='dark'?'#171717':'#fafafa');try{localStorage.setItem('snip-theme',theme);}catch{/* Theme still works for this session. */}},[theme]);
  useEffect(()=>{if(!busy)return;const prevent=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',prevent);return()=>window.removeEventListener('beforeunload',prevent);},[busy]);



  useEffect(()=>{const visibility=()=>{if(document.hidden)pausePlayback();};document.addEventListener('visibilitychange',visibility);return()=>document.removeEventListener('visibilitychange',visibility);},[pausePlayback]);

  const checkpoint=useCallback(()=>{const h=history.current;const next=structuredClone(editsRef.current);if(JSON.stringify(h.past.at(-1))!==JSON.stringify(next))h.past=[...h.past.slice(-59),next];h.future=[];refreshHistory(v=>v+1);},[]);
  const apply=useCallback((next:Edits,advanceRevision=true)=>{
    if(advanceRevision)session.current.changed();
    editsRef.current=next;setEdits(next);setDownload(null);
    const v=videoRef.current;let sourceTime=v?.currentTime??next.clips[0].start;
    let index=next.clips.findIndex((c,i)=>sourceTime>=c.start&&(sourceTime<c.end||(i===next.clips.length-1&&sourceTime<=c.end)));
    if(index<0){index=next.clips.findIndex(c=>c.start>=sourceTime);if(index<0)index=next.clips.length-1;sourceTime=next.clips[index].start;if(v)v.currentTime=sourceTime;}
    activeClip.current=index;setTime(toSequenceTime(sourceTime,next,index));setSelectedClip(old=>next.clips.some(c=>c.id===old)?old:next.clips[index].id);
  },[]);
  const update=useCallback((patch:Partial<Edits>,record=true)=>{if(!source||exportLock.current)return;const next=normalizeEdits({...editsRef.current,...(patch.crop?{resolution:'original'}:{}),...patch},source.duration);if(record)checkpoint();apply(next);},[apply,checkpoint,source]);
  const command=useCallback((commands:Command[],record=true)=>{if(!source||exportLock.current)return;const next=applyCommands(editsRef.current,commands,source.duration);if(record)checkpoint();apply(next);},[apply,checkpoint,source]);
  const undo=useCallback(()=>{const h=history.current;if(!h.past.length)return;pausePlayback();h.future.push(structuredClone(editsRef.current));apply(h.past.pop()!);refreshHistory(v=>v+1);},[apply,pausePlayback]);
  const redo=useCallback(()=>{const h=history.current;if(!h.future.length)return;pausePlayback();h.past.push(structuredClone(editsRef.current));apply(h.future.pop()!);refreshHistory(v=>v+1);},[apply,pausePlayback]);
  const seek=useCallback((position:number)=>{const e=editsRef.current,p=toSourceTime(position,e);pausePlayback();if(videoRef.current)videoRef.current.currentTime=p.time;activeClip.current=p.index;if(videoRef.current)videoRef.current.playbackRate=clipSpeed(e.clips[p.index],e);setSelectedClip(e.clips[p.index].id);setTime(toSequenceTime(p.time,e,p.index));},[pausePlayback]);
  const togglePlayback=useCallback(()=>{if(!busy)playback.current?.toggle();},[busy]);
  const splitLocation=toSourceTime(time,edits),at=edits.clips[splitLocation.index];const canSplit=!!at&&splitLocation.time-at.start>=.1&&at.end-splitLocation.time>=.1;
  const split=useCallback(()=>{const e=editsRef.current,position=toSourceTime(time,e),c=e.clips[position.index];if(position.time-c.start<.1||c.end-position.time<.1)return;pausePlayback();const rightId=uid();command([{action:'splitClip',clipId:c.id,sourceTime:position.time,rightClipId:rightId}]);setSelectedClip(rightId);},[time,command,pausePlayback]);
  const deleteClip=useCallback(()=>{const e=editsRef.current;pausePlayback();setActionsOpen(false);if(e.clips.length<2){setConfirmClear(true);return;}command([{action:'deleteClip',clipId:selectedClip}]);},[selectedClip,command,pausePlayback]);
  const openExport=()=>{if(!source||busy||loading)return;pausePlayback();setDownload(null);setError('');setShowExport(true);};
  const expandPreview=()=>{if(document.fullscreenElement)void document.exitFullscreen();else void previewRef.current?.requestFullscreen?.().catch(()=>{});};
  const openClipActions=(id:string)=>{
    const e=editsRef.current,index=e.clips.findIndex(c=>c.id===id);if(index<0)return;
    pausePlayback();
    if(activeClip.current!==index)seek(e.clips.slice(0,index).reduce((sum,c)=>sum+clipDuration(c,e),0));
    setSelectedClip(id);setEditorMode('timeline');setActionsOpen(true);
  };
  const changeClip=(patch:Partial<Clip>,record=true)=>{
    const c=editsRef.current.clips.find(c=>c.id===selectedClip);if(!c)return;const commands:Command[]=[];
    if(patch.speed!==undefined)commands.push({action:'setSpeed',clipId:c.id,speed:patch.speed});
    if(patch.zoom!==undefined)commands.push({action:'setZoom',clipId:c.id,zoom:patch.zoom});
    if(patch.start!==undefined||patch.end!==undefined)commands.push({action:'trimClip',clipId:c.id,sourceStart:patch.start??c.start,sourceEnd:patch.end??c.end});
    if(commands.length)command(commands,record);
  };
  const mergeClips=(index:number)=>{
    const e=editsRef.current,left=e.clips[index],right=e.clips[index+1];
    if(!canMergeClips(left,right,e))return;
    pausePlayback();command([{action:'mergeClips',clipId:left.id}]);setSelectedClip(left.id);setActionsOpen(false);
  };
  const seekCut=(direction:number)=>{
    const e=editsRef.current,position=toSequenceTime(videoRef.current?.currentTime??e.clips[0].start,e,activeClip.current),cuts=[0];
    e.clips.forEach(c=>cuts.push(cuts.at(-1)!+clipDuration(c,e)));
    seek(direction>0?(cuts.find(t=>t>position+.01)??cuts.at(-1)!):([...cuts].reverse().find(t=>t<position-.01)??0));
  };
  const trimAtPlayhead=(edge:'start'|'end')=>{
    const e=editsRef.current,p=toSourceTime(toSequenceTime(videoRef.current?.currentTime??0,e,activeClip.current),e),c=e.clips[p.index];
    if(edge==='start'?(p.time-c.start<.001||c.end-p.time<.1):(c.end-p.time<.001||p.time-c.start<.1))return;
    pausePlayback();command([{action:'trimClip',clipId:c.id,sourceStart:edge==='start'?p.time:c.start,sourceEnd:edge==='end'?p.time:c.end}]);
  };
  const resetTrim=()=>{
    const e=editsRef.current;
    // Restore source gaps without merging clips or discarding their adjustments.
    const ordered=[...e.clips].sort((a,b)=>a.start-b.start);
    const restored=ordered.map((c,i)=>({...c,start:i?ordered[i-1].end:0,end:i===ordered.length-1?source!.duration:c.end}));
    pausePlayback();update({clips:e.clips.map(c=>restored.find(r=>r.id===c.id)!)});
  };
  const reorder=(direction:number)=>{
    const e=editsRef.current,index=e.clips.findIndex(c=>c.id===selectedClip),next=index+direction;
    if(next<0||next>=e.clips.length)return;
    const clips=[...e.clips];[clips[index],clips[next]]=[clips[next],clips[index]];
    pausePlayback();command([{action:'reorderClips',clipIds:clips.map(c=>c.id)}]);seek(clips.slice(0,next).reduce((sum,c)=>sum+clipDuration(c,e),0));
  };
  const nudgeTrim=(edge:'start'|'end',direction:number)=>{
    if(!source)return;
    const e=editsRef.current,c=e.clips.find(c=>c.id===selectedClip);if(!c)return;
    const bounds=trimBounds(e.clips,c,source.duration),minimum=Math.min(.1,source.duration/2);
    const value=clamp(c[edge]+direction*.1,edge==='start'?bounds.start:c.start+minimum,edge==='end'?bounds.end:c.end-minimum);
    if(value===c[edge])return;
    pausePlayback();changeClip({[edge]:value});
  };
  const cycle=(presets:readonly number[],value:number,direction:number)=>(direction>0?presets.find(p=>p>value):[...presets].reverse().find(p=>p<value))??(direction>0?presets[0]:presets[presets.length-1]);
  useEditorShortcuts({hasVideo:!!source,blocked:busy||loading||!ready||showExport||showShortcuts||confirmClear||showMenu||actionsOpen,
    focusClip:direction=>{
      const e=editsRef.current,index=e.clips.findIndex(c=>c.id===selectedClip),next=clamp(index+direction,0,e.clips.length-1);
      seek(e.clips.slice(0,next).reduce((sum,c)=>sum+clipDuration(c,e),0));
      document.querySelector<HTMLElement>(`[data-clip-id="${CSS.escape(e.clips[next].id)}"]`)?.focus({preventScroll:true});
    },
    play:togglePlayback,seekBy:seconds=>seek(toSequenceTime(videoRef.current?.currentTime??0,editsRef.current,activeClip.current)+seconds),seekEdge:end=>seek(end?sequenceDuration(editsRef.current):0),seekCut,
    split,remove:deleteClip,trim:trimAtPlayhead,undo,redo,mute:()=>update({muted:!editsRef.current.muted}),
    speed:direction=>{const e=editsRef.current,c=e.clips.find(c=>c.id===selectedClip);if(c)changeClip({speed:cycle(speedPresets,clipSpeed(c,e),direction)});},
    clipZoom:direction=>{const c=editsRef.current.clips.find(c=>c.id===selectedClip);if(c){const zoom=c.zoom??defaultZoom;changeClip({zoom:{...zoom,scale:cycle(zoomPresets,zoom.scale,direction)}});}},
    merge:()=>{const e=editsRef.current,i=e.clips.findIndex(c=>c.id===selectedClip);mergeClips(canMergeClips(e.clips[i],e.clips[i+1],e)?i:i-1);},
    reorder,nudgeTrim,quickExport:()=>{setShowExport(true);void startExport(true);},
    zoom:direction=>setTimelineZoom(value=>Math.max(1,Math.min(8,direction>0?value*2:value/2))),expand:expandPreview,
    open:()=>inputRef.current?.click(),openProject:()=>projectInputRef.current?.click(),saveProject:downloadProject,export:openExport,help:()=>{pausePlayback();setShowShortcuts(true);},
    escape:()=>setActionsOpen(false),
  });
  useFilePaste({
    enabled: !source && ready && !loading && !busy && !showShortcuts && !showExport && !confirmClear,
    onFile: file => { void openFile(file); },
  });
  function renameProject(value:string){
    if(!source||busy||loading)return;
    const name=value.replace(/[\\/\u0000-\u001f]/g,'_').trim();
    if(!name||name===source.name)return;
    const next={...source,name};setSource(next);setDownload(null);setProjectDownload(null);
    void saveSource(next).catch(()=>setError('couldn’t save the new name on this device.'));
  }
  function downloadProject(){
    if(!source||busy||loading)return;
    try{
      const {blob,name}=createProjectFile(source,editsRef.current),next={url:URL.createObjectURL(blob),name,size:blob.size};
      const a=document.createElement('a');a.href=next.url;a.download=next.name;document.body.appendChild(a);a.click();a.remove();
      setProjectDownload(next);setNotice('project download started');setError('');
    }catch(err){setError(err instanceof Error?err.message:'couldn’t save this project. please try again.');}
  }
  async function openFile(file?:File,project=false){
    if(!file||!ready||exportLock.current||loadLock.current)return;
    const isProject=project||/\.snip$/i.test(file.name);
    if(!isProject&&!file.type.startsWith('video/')&&!/\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(file.name)){setError('choose a video or a saved .snip project.');if(inputRef.current)inputRef.current.value='';return;}
    if(!isProject&&(!file.size||file.size>MAX_VIDEO_SIZE)){setError(!file.size?'this file is empty. choose a video saved on your device.':'choose a video under 500 mb for this little editor.');if(inputRef.current)inputRef.current.value='';return;}
    loadLock.current=true;setLoading(true);setError('');setNotice('');pausePlayback();
    try{
      const nextProject=isProject?await readProjectFile(file):await readMetadata(file).then(source=>({source,edits:defaults(source.duration)}));
      const {source:next,edits:nextEdits}=nextProject;
      await saveProject(next,nextEdits);
      session.current=new EditSession(uid());exportJob.current=null;exportRequests.current.clear();setSource(next);setEdits(nextEdits);editsRef.current=nextEdits;setTime(0);activeClip.current=0;setSelectedClip(nextEdits.clips[0].id);setActionsOpen(false);setTimelineZoom(1);setDownload(null);setProjectDownload(null);history.current={past:[],future:[]};refreshHistory(v=>v+1);
      if(isProject)setNotice('project opened');
    }catch(err){setError(err instanceof Error?err.message:'couldn’t open or save this file. your browser’s storage may be full.');}
    finally{setLoading(false);loadLock.current=false;if(inputRef.current)inputRef.current.value='';if(projectInputRef.current)projectInputRef.current.value='';}
  }
  async function startExport(useDefaults=false){
    if(!source||exportLock.current||loadLock.current)return;pausePlayback();setBusy(true);setError('');setProgress(0);setDownload(null);cancelled.current=false;
    const exportEdits=useDefaults?{...editsRef.current,format:defaults(0).format,quality:defaults(0).quality,resolution:defaults(0).resolution}:editsRef.current;
    if(useDefaults)update({format:exportEdits.format,quality:exportEdits.quality,resolution:exportEdits.resolution},false);
    exportLock.current=true;
    if(!exportJob.current||exportJob.current.status!=='running')exportJob.current={id:uid(),sessionId:session.current.sessionId,revision:session.current.revision,status:'running',progress:0};
    const job=exportJob.current;
    try{const blob=await exportVideo(source,exportEdits,(fraction,label)=>{job.progress=fraction;setProgress(fraction);setStage(label);});if(cancelled.current)return;setStage('Checking export details');const details=await inspectExport(blob);if(cancelled.current)return;const next={details,url:URL.createObjectURL(blob),name:`${source.name.replace(/\.[^.]+$/,'')}-snip.${exportEdits.format}`,size:blob.size};setDownload(next);Object.assign(job,{status:'complete',progress:1,name:next.name,size:next.size,details});const a=document.createElement('a');a.href=next.url;a.download=next.name;document.body.appendChild(a);a.click();a.remove();}
    catch(err){if(!cancelled.current){const message=err instanceof Error?err.message:'export failed. try a smaller resolution.';Object.assign(job,{status:'failed',error:message});setError(message);}}finally{exportLock.current=false;setBusy(false);}
  }
  const stopExport=()=>{cancelled.current=true;if(exportJob.current)exportJob.current.status='cancelled';cancelExport();setProgress(0);};
  const removeProject=async()=>{try{await clearProject();pausePlayback();session.current=new EditSession(uid());exportJob.current=null;exportRequests.current.clear();setSource(null);const next=defaults(0);setEdits(next);editsRef.current=next;setDownload(null);setConfirmClear(false);setProjectDownload(null);setNotice('');setError('');history.current={past:[],future:[]};}catch{setError('couldn’t clear local storage. please try again.');}};
  const ensureEditable=()=>{
    if(!source||!ready)throw new Error('Open a video in the editor first.');
    if(loadLock.current||exportLock.current)throw new Error('The editor is busy. Wait for opening or export to finish.');
    return source;
  };
  applyBatchRef.current=(params)=>{
    const currentSource=ensureEditable();
    if(pointerActive.current)throw new Error('Finish the current pointer interaction before applying edits.');
    if(showExport||actionsOpen||showShortcuts||confirmClear||showMenu||agentToken)throw new Error('Close the open dialog, then try the edit again.');
    const result=session.current.apply(params,editsRef.current,currentSource.duration);
    if(!result.duplicate){pausePlayback();checkpoint();apply(result.edits,false);}
    return result;
  };
  const submitChat=async(text:string,signal:AbortSignal)=>{
    const currentSource=ensureEditable(),currentSession=session.current;
    pausePlayback();
    const playhead=videoRef.current?toSequenceTime(videoRef.current.currentTime,editsRef.current,activeClip.current):time;
    setTime(playhead);
    const requestId=uid(),revision=currentSession.revision;
    const result=await requestChatEdit({text,requestId,sessionId:currentSession.sessionId,revision,
      project:{duration:currentSource.duration,edits:structuredClone(editsRef.current),selectedClip,time:playhead}},signal);
    if(signal.aborted)throw new DOMException('Cancelled','AbortError');
    if(currentSession!==session.current||revision!==session.current.revision)throw new Error('The timeline changed while Jev was editing. Send your prompt again to use the latest version.');
    if(result.batch.requestId!==requestId||result.batch.sessionId!==currentSession.sessionId||result.batch.revision!==revision)throw new Error('That edit belongs to an older request. Please try again.');
    applyBatchRef.current(result.batch);
    const affected=result.batch.commands.filter(c=>c.action==='setZoom'||c.action==='setSpeed');
    const focus=affected.find(c=>c.clipId===selectedClip)??affected[0];
    if(focus){const index=editsRef.current.clips.findIndex(c=>c.id===focus.clipId);if(index>=0)seek(editsRef.current.clips.slice(0,index).reduce((sum,c)=>sum+clipDuration(c,editsRef.current),0));}
    return result.summary;
  };
  agentHandler.current=async(method,params)=>{
    if(method==='get_export_status')return exportJob.current?{...exportJob.current}:null;
    if(method==='start_export'&&exportJob.current){
      const request=object(params),job=exportJob.current;
      if(Object.keys(request).some(key=>!['requestId','sessionId','revision'].includes(key)))throw new Error('Unknown export request field.');
      if(request.requestId===job.id){
        if(request.sessionId!==job.sessionId||request.revision!==job.revision)throw new Error('Export request ID was already used with different contents.');
        return {...job};
      }
    }
    const currentSource=ensureEditable();
    if(method==='get_frame'){
      const request=object(params),currentSession=session.current,revision=currentSession.revision;
      if(Object.keys(request).some(key=>!['sessionId','revision','sourceTime'].includes(key)))throw new Error('Unknown frame request field.');
      if(request.sessionId!==currentSession.sessionId||request.revision!==revision)throw new Error('Project session or revision changed. Read get_project again.');
      if(typeof request.sourceTime!=='number')throw new Error('sourceTime is required in seconds of the original video.');
      if(capturingFrame.current)throw new Error('A frame capture is already in progress.');
      capturingFrame.current=true;
      try{
        const frame=await captureSourceFrame(currentSource,request.sourceTime);
        if(currentSession!==session.current||revision!==session.current.revision||loadLock.current)throw new Error('Project changed during frame capture. Read get_project again.');
        return {...frame,sessionId:currentSession.sessionId,revision};
      }finally{capturingFrame.current=false;}
    }
    if(method==='get_project'){
      const currentSession=session.current,info=await identifySource(currentSource);
      if(currentSession!==session.current)throw new Error('Project changed. Read it again.');
      const plan=compileTimeline(currentSource,editsRef.current);
      return {sessionId:currentSession.sessionId,revision:currentSession.revision,specification:createSpecification(info,plan.edits),timeline:plan.clips,duration:plan.duration,output:plan.output};
    }
    if(method==='apply_edits'){
      const result=applyBatchRef.current(params);
      if(!result.duplicate)setNotice('agent edits applied');
      return {sessionId:session.current.sessionId,revision:result.revision,currentRevision:session.current.revision,duplicate:result.duplicate};
    }
    if(method==='start_export'){
      if(pointerActive.current)throw new Error('Finish the current pointer interaction before exporting.');
      const request=object(params);
      if(Object.keys(request).some(key=>!['requestId','sessionId','revision'].includes(key)))throw new Error('Unknown export request field.');
      if(typeof request.requestId!=='string'||!request.requestId.length||request.requestId.length>128)throw new Error('Export needs a request ID.');
      if(request.sessionId!==session.current.sessionId||request.revision!==session.current.revision)throw new Error('Project changed. Read it again before exporting.');
      if(exportRequests.current.has(request.requestId)){
        if(exportJob.current?.id===request.requestId)return {...exportJob.current};
        throw new Error('This export request was already handled.');
      }
      if(actionsOpen||confirmClear||showShortcuts||showMenu)throw new Error('Close the editor dialog or clip controls before exporting.');
      if(exportRequests.current.size>=10000)throw new Error('Export request limit reached. Reopen the project.');
      exportRequests.current.add(request.requestId);
      exportJob.current={id:request.requestId,sessionId:session.current.sessionId,revision:session.current.revision,status:'running',progress:0};
      setShowExport(true);void startExport();return {...exportJob.current};
    }
    throw new Error('Unknown agent method.');
  };
  const themeButton = <IconButton label={`switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun /> : <Moon />}</IconButton>;
  const brand = <div className="flex shrink-0 items-center gap-2 sm:gap-2.5"><ScissorsMark className="size-5 text-primary sm:size-6" /><span className="text-xl font-bold tracking-tight sm:text-2xl">snip<span className="text-primary">.</span></span></div>;
  const errorAlert = error && !showExport && <Alert variant="error" className="mt-4"><AlertDescription className="flex items-center justify-between gap-3">{error}<Button variant="ghost" size="icon-sm" aria-label="dismiss error" onClick={() => setError('')}><X /></Button></AlertDescription></Alert>;
  const agentControl=agentStatus && <div className="flex items-center gap-2">
    {agentStatus==='agent connected' ? <Button variant="ghost" size="sm" title={`Connected to ${location.host} · bridge ${agentBridge}`} onClick={()=>{disconnectAgent.current?.();disconnectAgent.current=null;setAgentStatus('');setAgentBridge('');}}>disconnect agent</Button>
      : <span role="status" title="Open the pairing link from your current agent to reconnect." className="text-xs text-muted-foreground">{agentStatus}</span>}
  </div>;
  return <TooltipProvider><div className={`app min-h-svh ${source ? 'has-video' : ''}`} onDragEnter={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); dragDepth.current++; setDraggingFile(true); } }} onDragOver={e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }} onDragLeave={e => { e.preventDefault(); if (--dragDepth.current <= 0) { dragDepth.current = 0; setDraggingFile(false); } }} onDrop={e => { e.preventDefault(); dragDepth.current = 0; setDraggingFile(false); if (!showExport && !agentToken && !showShortcuts && !confirmClear) void openFile(e.dataTransfer.files[0]); }}>

    <input ref={inputRef} type="file" id="video-file" accept="video/*,.mkv,.m4v" hidden onChange={e => void openFile(e.target.files?.[0])} />
    <input ref={projectInputRef} type="file" id="project-file" accept=".snip" hidden onChange={e => void openFile(e.target.files?.[0],true)} />
    {draggingFile && !busy && <div className="pointer-events-none fixed inset-4 z-50 flex items-center justify-center bg-background/95"><Empty><EmptyHeader><EmptyMedia variant="icon"><Film /></EmptyMedia><EmptyTitle>drop your video or project</EmptyTitle><EmptyDescription>everything stays on this device.</EmptyDescription></EmptyHeader></Empty></div>}
    {source && <header className="editor-header flex flex-wrap items-center justify-between gap-3 px-3 py-4 sm:px-8 sm:py-5">
      {brand}
      <div className="header-actions ml-auto flex max-w-full flex-wrap items-center justify-end gap-1 sm:gap-2">
        <span className="sr-only" role="status">{loading ? 'opening…' : saved}</span>
        {agentControl}<AgentOnboarding />
        <span className="hidden sm:contents">{themeButton}</span>
        <ProjectMenu filename={source.name} onRename={renameProject} disabled={busy || loading} theme={theme} onOpenChange={open => { setShowMenu(open); if (open) pausePlayback(); }} onOpen={() => inputRef.current?.click()} onOpenProject={() => projectInputRef.current?.click()} onSaveProject={downloadProject} onTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')} onHelp={() => setShowShortcuts(true)} onClear={() => setConfirmClear(true)} />
        <Button aria-label="export video" aria-keyshortcuts="Control+E Meta+E" disabled={busy || loading} onClick={openExport}><ArrowDownToLine className="hidden sm:block" />export</Button>
      </div>
    </header>}
    {!source ? <main className="start-screen flex min-h-svh flex-col">
      <div className="absolute right-5 top-5 left-5 flex flex-wrap items-center justify-end gap-1 sm:right-8 sm:top-7">{agentControl}<AgentOnboarding />{themeButton}</div>
      <div className="flex flex-1 items-center justify-center px-6 pb-16 pt-24 sm:pb-36">
        <div className="w-full max-w-[34.25rem] text-center">
          <div className="flex items-end justify-center gap-3"><ScissorsMark className="size-14 shrink-0 text-primary sm:size-16" /><h1 className="text-7xl font-[750] leading-none tracking-[-0.075em] sm:text-[88px]">snip<span className="text-primary">.</span></h1></div>
          <p className="mt-6 text-balance text-sm text-muted-foreground sm:text-base">a simple editor for small potato stuff</p>
          <Button variant="outline" aria-label="select your video" aria-describedby="upload-hint" aria-busy={loading || !ready} disabled={!ready || loading} onClick={() => inputRef.current?.click()} className="mt-10 h-44 w-full flex-col gap-3 rounded-2xl border-dashed border-primary/45 bg-card font-normal shadow-none sm:h-52">
            {loading || !ready ? <Spinner className="mb-1 size-6" /> : <Plus className="mb-1 size-6 text-warning-foreground dark:text-primary" strokeWidth={1.5} />}
            <span className="inline-flex items-center gap-2 text-base leading-none text-warning-foreground sm:text-lg sm:leading-none dark:text-primary">{loading ? 'opening your file…' : !ready ? 'getting things ready…' : 'select your video'}{ready && !loading && <ArrowUpRight className="mx-0! size-[1em]" aria-hidden="true" />}</span>
            <span id="upload-hint" className="text-sm text-muted-foreground">or paste or drag and drop here · up to 500 MB</span>
          </Button>
          <div className="mt-4 flex flex-col items-center gap-4 sm:mt-5 sm:gap-5">
            <span className="text-sm text-muted-foreground">or</span>
            <Button variant="ghost" className="text-muted-foreground" disabled={!ready || loading} onClick={() => projectInputRef.current?.click()}><FolderOpen />import local project</Button>
          </div>
          {errorAlert}
        </div>
      </div>
      <footer className="flex items-center justify-center gap-3 px-6 pb-5 text-xs text-muted-foreground"><span>free</span><span aria-hidden="true" className="size-1 shrink-0 rounded-full bg-primary" /><span>no-watermark</span><span aria-hidden="true" className="size-1 shrink-0 rounded-full bg-primary" /><span>local in browser</span></footer>
    </main> : <main className="editor mx-auto w-full max-w-6xl px-4 pb-6 sm:px-8">
      <div className="workspace" inert={loading || busy}>
        <section ref={previewRef} aria-label="video preview" className="preview-panel">
          <Preview playing={playing} time={time} editing={actionsOpen||(editorMode==='chat'&&!playing)} source={source} edits={edits} clip={edits.clips[activeClip.current]} url={url} videoRef={videoRef} onLoaded={() => { const v = videoRef.current; if (v) { v.currentTime = editsRef.current.clips[0].start; v.playbackRate = clipSpeed(editsRef.current.clips[0],editsRef.current); v.muted = editsRef.current.muted; activeClip.current = 0; setTime(0); } }} onToggle={togglePlayback} />
          <div className="player flex items-center justify-between gap-3 py-4">
            <div className="flex items-center gap-3"><IconButton label={playing ? 'pause' : 'play'} aria-keyshortcuts="Space" onClick={togglePlayback}>{playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}</IconButton><span className="play-time whitespace-nowrap font-mono text-xs tabular-nums text-muted-foreground"><span className="text-foreground">{formatTime(time)}</span> / {formatTime(duration)}</span></div>
            <div className="flex items-center gap-1"><IconButton label={edits.muted ? 'unmute video' : 'mute video'} aria-keyshortcuts="K" onClick={() => update({ muted: !edits.muted })}>{edits.muted ? <VolumeX /> : <Volume2 />}</IconButton><IconButton label="expand preview" aria-keyshortcuts="F" onClick={expandPreview}><Maximize2 /></IconButton></div>
          </div>
        </section>
        <Card className="editor-controls p-3" render={<section aria-label="video editor" />}>
          <Timeline
            chatActive={editorMode==='chat'}
            modeSwitch={<Button size="xs" variant="ghost" className="editor-mode-switch text-muted-foreground" aria-label={`switch to ${editorMode==='chat'?'editor':'chat'}`} aria-controls="editor-controls" onClick={()=>{setEditorMode(editorMode==='chat'?'timeline':'chat');setActionsOpen(false);}}>
              {editorMode==='chat'?<ListVideo />:<MessageSquare />}<span><span className="hidden sm:inline">switch to </span>{editorMode==='chat'?'editor':'chat'}</span>
            </Button>}
            chatEditor={<ChatEditor key={session.current.sessionId} active={editorMode==='chat'} revision={session.current.revision} onSubmit={submitChat} onUndo={undo} onRedo={redo} canUndo={history.current.past.length>0} canRedo={history.current.future.length>0} />}
            onUndo={undo} onRedo={redo} canUndo={history.current.past.length>0} canRedo={history.current.future.length>0} onResetTrim={resetTrim} videoRef={videoRef} zoom={timelineZoom} onZoom={setTimelineZoom} source={source} edits={edits} time={time} selected={selectedClip} frames={frames} onSelect={setSelectedClip} onSeek={seek} onClips={(clips: Clip[]) => update({ clips },false)} onCheckpoint={() => { pausePlayback(); checkpoint(); }} onSplit={split} canSplit={canSplit} actionsOpen={editorMode==='timeline'&&actionsOpen} onActionsOpen={open => { if(open)openClipActions(selectedClip);else setActionsOpen(false); }} onOpenClip={openClipActions} onChangeClip={changeClip} onMerge={mergeClips} onDelete={deleteClip}
          />
        </Card>
      </div>
      {notice && <Alert className="mt-4"><AlertDescription className="flex flex-wrap items-center gap-2">{notice}{projectDownload && <Button size="sm" variant="link" render={<a href={projectDownload.url} download={projectDownload.name} />}>download again</Button>}</AlertDescription></Alert>}
      {errorAlert}
    </main>}
    <AlertDialog open={!!agentToken} onOpenChange={open=>{if(!open)setAgentToken(null);}}><AlertDialogPopup><AlertDialogHeader><AlertDialogTitle>connect your agent?</AlertDialogTitle><AlertDialogDescription>The agent can read edit settings, request screenshots of video frames, change the open project, and start a browser export. Requested frames are shared with the agent; the full video stays in this browser. Choose a video here after connecting.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogClose render={<Button variant="outline" />}>cancel</AlertDialogClose><Button onClick={()=>{try{disconnectAgent.current?.();disconnectAgent.current=connectAgent(agentToken!, (method,params)=>agentHandler.current(method,params),setAgentStatus,setAgentBridge);setAgentToken(null);}catch(e){setError(e instanceof Error?e.message:'Connection failed.');setAgentToken(null);}}}>connect agent</Button></AlertDialogFooter></AlertDialogPopup></AlertDialog>
    <ShortcutsDialog open={showShortcuts} onClose={() => setShowShortcuts(false)} />
    <ExportDialog onSaveProject={downloadProject} open={showExport} source={source} edits={edits} busy={busy} progress={progress} stage={stage} download={download} error={error} onUpdate={update} onClose={() => setShowExport(false)} onExport={() => void startExport()} onCancel={stopExport} />
    <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}><AlertDialogPopup><AlertDialogHeader><AlertDialogTitle>clear this video?</AlertDialogTitle><AlertDialogDescription>this removes the video and edits saved in this browser. your original file stays yours.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogClose render={<Button variant="outline" />}>keep editing</AlertDialogClose><Button variant="destructive" onClick={() => void removeProject()}>clear video</Button></AlertDialogFooter></AlertDialogPopup></AlertDialog>
  </div></TooltipProvider>;
}
