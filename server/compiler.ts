import { applyCommands } from '../src/engine/index';
import type { Command } from '../src/engine/index';
import type { ChatRequest, ChatResult } from '../src/chat';
import { clipDuration, clipSpeed, defaultZoom, sequenceDuration, toSourceTime } from '../src/types';
import { zoomFocusLabel } from '../src/zoom';
import { EditError, MAX_EDITS } from './operations';
import type { Change, Target, Trim } from './operations';

const round = (n: number) => Math.round(n * 1000000) / 1000000;

/** Resolve an ordered plan against a private evolving timeline, then validate
 * the complete engine batch. A later failure never commits earlier edits. */
export function compileChanges(request: ChatRequest, changes: Change[]): ChatResult {
  if(!changes.length||changes.length>MAX_EDITS)throw new EditError(`Use between 1 and ${MAX_EDITS} edits per prompt.`);
  let edits=request.project.edits, serial=0, previous:string[]=[];
  const commands:Command[]=[], summaries:string[]=[];
  const results=new Map<string,{left:string;right:string}>();
  let latest:string|undefined;
  const splitScopes=new Map<string,{origin:number;length:number;limited:boolean;clipNumber?:number}>();
  const run=(command:Command)=>{edits=applyCommands(edits,[command],request.project.duration);commands.push(command);};
  const newId=()=>{let id:string;do{id=`chat-${request.requestId.slice(0,80)}-${++serial}`;}while(edits.clips.some(c=>c.id===id));return id;};
  const startOf=(id:string)=>{const i=edits.clips.findIndex(c=>c.id===id);return edits.clips.slice(0,i).reduce((n,c)=>n+clipDuration(c,edits),0);};
  function target(value:Target){
    const clips=edits.clips;
    if(value==='all')return clips;
    if(value==='previous'){
      if(!previous.length)throw new EditError('There is no preceding edit to identify that clip. Use a clip number.');
      const found=previous.map(id=>clips.find(c=>c.id===id));
      if(found.some(c=>!c))throw new EditError('An earlier edit removed that clip. Nothing was changed.');
      return found.map(c=>c!);
    }
    let id:string|undefined;
    if(value==='selected')id=request.project.selectedClip;
    else if(value==='first')id=clips[0]?.id;
    else if(value==='last')id=clips.at(-1)?.id;
    else if(value==='middle'){
      if(clips.length%2===0)throw new EditError('There is no single middle clip. Specify its clip number.');
      id=clips[Math.floor(clips.length/2)]?.id;
    }else if('clip' in value)id=clips[value.clip-1]?.id;
    else if('original' in value)id=request.project.edits.clips[value.original-1]?.id;
    else{
      const result=results.get(value.split==='latest'?latest??'':`split${value.split}`);
      if(!result)throw new EditError('That split has not happened yet. Put the split before edits to its new parts.');
      id=result[value.side];
    }
    const clip=clips.find(c=>c.id===id);
    if(!clip)throw new EditError('That clip is no longer on the timeline at this step. Nothing was changed.');
    return [clip];
  }
  function one(value:Target){const clips=target(value);if(clips.length!==1)throw new EditError('Specify one clip for this edit. Nothing was changed.');return clips[0];}
  function trim(clipTarget:Target,spec:Trim){
    const selected=target(clipTarget), ids=new Set(selected.map(c=>c.id));
    if(clipTarget!=='all'&&selected.length!==1)throw new EditError('Specify one clip or the whole video to trim.');
    const duration=clipTarget==='all'?sequenceDuration(edits):clipDuration(selected[0],edits);
    let a:number,b:number,remove=false;
    switch(spec.mode){
      case 'removeStart':a=spec.seconds;b=duration;break;
      case 'removeEnd':a=0;b=duration-spec.seconds;break;
      case 'keepStart':a=0;b=spec.seconds;break;
      case 'keepEnd':a=duration-spec.seconds;b=duration;break;
      case 'keepRange':a=spec.start;b=spec.end;break;
      case 'removeRange':a=spec.start;b=spec.end;remove=true;break;
    }
    if(!Number.isFinite(a)||!Number.isFinite(b)||a<0||b>duration||a>=b||(remove&&b-a>=duration))throw new EditError(`That trim does not fit within ${round(duration)}s. Nothing was changed.`);
    const origin=clipTarget==='all'?0:startOf(selected[0].id);
    a+=origin;b+=origin;
    const ranges=remove?[[origin,a],[b,origin+duration]]:[[a,b]];
    const retained:{id:string;start:number;end:number}[]=[];
    let offset=0;
    for(const clip of edits.clips){
      const end=offset+clipDuration(clip,edits),speed=clipSpeed(clip,edits);
      if(!ids.has(clip.id))retained.push({id:clip.id,start:clip.start,end:clip.end});
      else for(const [start,stop] of ranges){
        const lo=Math.max(offset,start),hi=Math.min(end,stop);
        if(hi-lo>1e-7)retained.push({id:clip.id,start:Math.max(clip.start,round(clip.start+(lo-offset)*speed)),end:Math.min(clip.end,round(clip.start+(hi-offset)*speed))});
      }
      offset=end;
    }
    if(!retained.length)throw new EditError('That trim would remove the whole video. Nothing was changed.');
    for(const clip of [...edits.clips]){
      const parts=retained.filter(p=>p.id===clip.id);
      if(parts.length===2){const right=newId();run({action:'splitClip',clipId:clip.id,sourceTime:parts[1].start,rightClipId:right});parts[1].id=right;ids.add(right);}
    }
    for(const part of retained){const current=edits.clips.find(c=>c.id===part.id)!;if(current.start!==part.start||current.end!==part.end)run({action:'trimClip',clipId:part.id,sourceStart:part.start,sourceEnd:part.end});}
    for(const clip of [...edits.clips])if(!retained.some(p=>p.id===clip.id))run({action:'deleteClip',clipId:clip.id});
    previous=retained.filter(p=>ids.has(p.id)).map(p=>p.id);
    summaries.push(spec.mode==='removeStart'?`removed first ${spec.seconds}s`:spec.mode==='removeEnd'?`removed last ${spec.seconds}s`:remove?`removed ${round(a-origin)}–${round(b-origin)}s`:`kept ${round(a-origin)}–${round(b-origin)}s`);
  }
  try{
    for(const change of changes){
      switch(change.action){
        case 'split':{
          const duration=sequenceDuration(edits), group=change.result.split('_')[0];
          let scope=splitScopes.get(group);
          if(!scope){const selected=change.clip==='all'?undefined:one(change.clip);scope={origin:selected?startOf(selected.id):0,length:selected?clipDuration(selected,edits):duration,limited:!!selected,clipNumber:selected?edits.clips.findIndex(c=>c.id===selected.id)+1:undefined};splitScopes.set(group,scope);}
          const {origin,length}=scope;
          const position=round(change.at.from==='half'?origin+length/2:change.at.from==='playhead'?request.project.time+change.at.seconds:change.at.from==='clipEnd'?origin+length+change.at.seconds:change.at.from==='clipStart'?origin+change.at.seconds:change.at.seconds);
          if(position<=0||position>=duration)throw new EditError(`That split lands at ${position}s, outside the video. Choose a point between 0s and ${round(duration)}s.`);
          if(scope.limited&&(position<=origin||position>=origin+length))throw new EditError(`That split lands at ${position}s, outside clip ${scope.clipNumber} (${round(origin)}–${round(origin+length)}s on the timeline). Nothing was changed.`);
          const point=toSourceTime(position,edits),clip=edits.clips[point.index];
          if(Math.abs(point.time-clip.start)<1e-7)throw new EditError(`There’s already a split at ${position}s. Choose another point.`);
          const right=newId();run({action:'splitClip',clipId:clip.id,sourceTime:point.time,rightClipId:right});
          results.set(change.result,{left:clip.id,right});latest=change.result;previous=[right];
          summaries.push(`split at ${position}s${change.at.from==='playhead'&&change.at.seconds?` (${Math.abs(change.at.seconds)}s ${change.at.seconds>0?'after':'before'} the playhead)`:change.at.from==='clipStart'&&scope.limited?` (${change.at.seconds}s into clip ${scope.clipNumber})`:''}`);break;
        }
        case 'trim':trim(change.clip,change.range);break;
        case 'speed':{
          const clips=target(change.clip);previous=clips.map(c=>c.id);
          for(const clip of clips){const rate=change.rate==='faster'?Math.min(4,clipSpeed(clip,edits)*2):change.rate==='slower'?Math.max(.25,clipSpeed(clip,edits)/2):change.rate;run({action:'setSpeed',clipId:clip.id,speed:rate});summaries.push(`clip ${edits.clips.findIndex(c=>c.id===clip.id)+1}: speed ${round(rate)}×`);}break;
        }
        case 'zoom':{
          const clips=target(change.clip);previous=clips.map(c=>c.id);
          for(const clip of clips){
            const before=clip.zoom??defaultZoom;
            const scale=change.scale==='keep'?(before.scale>1?before.scale:1.5):change.scale==='in'?Math.min(4,before.scale*1.5):change.scale==='out'?Math.max(1,before.scale/1.5):change.scale;
            const zoom={...before,...change.focus,scale};run({action:'setZoom',clipId:clip.id,zoom});
            summaries.push(`clip ${edits.clips.findIndex(c=>c.id===clip.id)+1}: zoom ${round(scale)}× · ${zoomFocusLabel(zoom)}`);
          }break;
        }
        case 'merge':{
          const [leftTarget,rightTarget]=change.clips;
          if(leftTarget==='all'&&rightTarget==='next'){
            const left=edits.clips[0];while(edits.clips.length>1)run({action:'mergeClips',clipId:left.id});previous=[left.id];
          }else{
            const left=one(leftTarget),index=edits.clips.findIndex(c=>c.id===left.id),right=rightTarget==='next'?edits.clips[index+1]:one(rightTarget);
            if(!right||edits.clips[index+1]?.id!==right.id)throw new EditError('Merge needs two neighboring clips in timeline order. Nothing was changed.');
            run({action:'mergeClips',clipId:left.id});previous=[left.id];
          }
          summaries.push('clips merged');break;
        }
        case 'delete':{
          const clips=target(change.clip);for(const clip of clips)run({action:'deleteClip',clipId:clip.id});previous=[];summaries.push('clip removed');break;
        }
        case 'reorder':{
          const ids=edits.clips.map(c=>c.id);
          if(change.to==='reverse')run({action:'reorderClips',clipIds:ids.reverse()});
          else{const clip=one(change.clip),rest=ids.filter(id=>id!==clip.id);run({action:'reorderClips',clipIds:change.to==='first'?[clip.id,...rest]:[...rest,clip.id]});previous=[clip.id];}
          summaries.push('clips reordered');break;
        }
        case 'output':{
          run({action:'setOutput',...change.settings});
          for(const [key,value] of Object.entries(change.settings))summaries.push(key==='muted'?(value?'audio muted':'audio restored'):key==='resolution'?(value==='original'?'original resolution':`${value}p`):String(value));break;
        }
      }
    }
  }catch(error){if(error instanceof EditError)throw error;throw new EditError(`That edit doesn’t fit the current timeline. ${error instanceof Error?error.message:'Check its values.'} Nothing was changed.`);}
  if(!commands.length||JSON.stringify(edits)===JSON.stringify(request.project.edits))throw new EditError('The video already matches that edit, or no change was requested.',422,'NO_CHANGE');
  applyCommands(request.project.edits,commands,request.project.duration);
  return {ok:true,changes,batch:{requestId:request.requestId,sessionId:request.sessionId,revision:request.revision,commands},summary:summaries.length>6?summaries.slice(0,5).join(' · ')+` · and ${summaries.length-5} more changes`:summaries.join(' · ')};
}
