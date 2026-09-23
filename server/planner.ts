import { object, normalizeEdits } from '../src/engine/index.js';
import type { ChatRequest, ChatResult } from '../src/chat.js';
import { clipDuration, sequenceDuration } from '../src/types.js';
import { compileChanges } from './compiler.js';
import { EditError, MAX_EDITS } from './operations.js';
import type { Change, Target, Time, Trim } from './operations.js';
export { EditError } from './operations.js';

type Option = { description: string; value: unknown };
type Choices = Record<string, Option>;
type Question = { type: 'choice'; instructions: unknown; criteria: Record<string, string> };
const unsupported = { description: 'The requested value cannot be represented by these options.', value: 'unsupported' };
const keep = { description: 'This setting is not mentioned. Keep it unchanged.', value: null };
const option = (description: string, value: unknown): Option => ({ description, value });

export function readRequest(value: unknown): ChatRequest {
  try {
    const request = object(value), project = object(request.project);
    if (typeof request.text !== 'string' || !request.text.trim() || request.text.length > 1200) throw new Error();
    for (const key of ['requestId', 'sessionId']) if (typeof request[key] !== 'string' || !request[key].length || request[key].length > 128) throw new Error();
    if (!Number.isSafeInteger(request.revision) || Number(request.revision) < 0) throw new Error();
    if (typeof project.duration !== 'number' || !Number.isFinite(project.duration) || project.duration <= 0 || project.duration > 86400) throw new Error();
    const edits = normalizeEdits(project.edits, project.duration);
    if (edits.clips.length > 100) throw new EditError('Chat works with up to 100 clips. You can still use the timeline.');
    if (typeof project.selectedClip !== 'string' || !edits.clips.some(c => c.id === project.selectedClip)) throw new Error();
    if (typeof project.time !== 'number' || !Number.isFinite(project.time) || project.time < 0 || project.time > sequenceDuration(edits) + .01) throw new Error();
    return { text: request.text.trim(), requestId: request.requestId as string, sessionId: request.sessionId as string, revision: request.revision as number,
      project: { duration: project.duration, edits, selectedClip: project.selectedClip, time: project.time } };
  } catch (error) {
    if (error instanceof EditError) throw error;
    throw new EditError('The edit request is incomplete. Refresh the editor and try again.', 400);
  }
}

// Jev selects typed options. Exact numbers are copied from the prompt, never inferred with a score.
export function numbersIn(text: string): number[] {
  const words: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, sixty: 60, half: .5, quarter: .25 };
  const normalized = text.toLowerCase().replace(/\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|sixty|half|quarter)\b/g, word => String(words[word]));
  const values = [...normalized.matchAll(/(?<![\w.])-?\d+(?::\d{1,2}){1,2}(?:\.\d+)?|(?<![\w.])-?\d+(?:\.\d+)?/g)].map(match => {
    const value = match[0].split(':').reduce((n, part) => n * 60 + Number(part), 0);
    return /^\s*(?:minutes?|mins?)\b/.test(normalized.slice(match.index! + match[0].length)) ? value * 60 : value;
  });
  return [...new Set(values)].filter(Number.isFinite).slice(0, 12);
}


export function createPlan(request: ChatRequest) {
  const numbers = numbersIn(request.text);
  const ordering = 'Read the COMPLETE user_request and identify its requested edits in their stated order. Each change of action or target is a separate edit, even if phrased without verbs or joined with and. Zoom scale plus focus is ONE edit. A list of split timestamps for the same target is ONE edit. Consecutive output settings (mute, format, resolution, quality) are ONE output edit. Repeated zoom/speed actions for different clips are separate edits. Count repeated actions separately: split, zoom, speed, split, zoom are FIVE edits in that order. A trailing shared target joined with AND, such as "1x zoom and 1x speed for clip 1", applies to both settings. THEN starts a new scope: "zoom 2x then speed 0.5x for clip 2" zooms ALL clips and changes only clip 2 speed. Never carry a later target backwards across THEN. Do not invent edits or reorder them.';
  const choices: Record<string, Choices> = {}, questions: Record<string, Question> = {};
  function add(key: string, question: string, options: Choices, index?: number) {
    choices[key] = options;
    questions[key] = { type: 'choice', instructions: index === undefined ? question : {
      question: `For the ${['FIRST','SECOND','THIRD','FOURTH','FIFTH','SIXTH','SEVENTH','EIGHTH'][index]} edit requested in user_request: ${question}`,
      scope: ['action','target','splitTarget'].some(field=>key.endsWith('_'+field))
        ? 'Count requested actions in mention order. Different actions joined by and are separate edits. Count repeated actions separately: split, zoom, speed, split, zoom are FIVE edits in that order. One list of split timestamps is one edit. Consecutive output settings are one edit. Only answer about this numbered edit. Prefer its literal target reference: it=previous, right part=right, last part=last; do not guess a numbered clip instead.'
        : 'Answer only this numbered edit, following state.rules. Ignore other edits when choosing its values.',
      edit_number: index + 1,
    }, criteria: Object.fromEntries(Object.entries(options).map(([k,v]) => [k,v.description])) };
  }
  add('status', 'Can the entire user_request be implemented using split, trim, zoom/focus, speed, merge, delete, reorder, mute, output format/resolution/quality? Relative times, repeated actions and newly split parts are supported. Bare trim N seconds removes the first N seconds. Judge capabilities only; code checks clip existence and timing. Choose unclear if no actionable edit can be identified.', {
    ready: option('All requested capabilities are supported and there is an identifiable edit.', 'ready'),
    unsupported: option('At least one request needs understanding video/audio content, captions, music, transitions, filters, crop/aspect, reversed playback or downloading/exporting a file.', 'UNSUPPORTED_EDIT'),
    unclear: option('No actionable edit can be identified from this request.', 'UNCLEAR_REQUEST'),
  });
  add('count', `${ordering} How many edits are requested? Count multi-point splits once, and consecutive output settings once. For example: "1x zoom and 1x speed for clip 1" = 2; "split at 4 and 8, zoom the middle part 2x" = 2; "zoom clip 1 to 2x, clip 2 to 3x" = 2.`, {
    ...Object.fromEntries(Array.from({length:MAX_EDITS+1},(_,n)=>[`n${n}`,option(`${n} requested edits`,n)])),
    too_many: option(`More than ${MAX_EDITS} edits.`, 'TOO_MANY_EDITS'),
  });
  const { edits, time, selectedClip } = request.project;
  for (let i=0;i<MAX_EDITS;i++) {
    const prefix = `edit${i+1}_`;
    const addField = (key: string, question: string, options: Choices) => add(prefix+key, question, options, i);
    const values = (key: string, question: string, items: (string|number|boolean)[], describe: (n: string|number|boolean)=>string=String, optional=false) => addField(key, question, {
      ...(optional ? {keep} : {}), unsupported,
      ...Object.fromEntries([...new Set(items)].map((v,n) => [`v${n}`,option(describe(v),v)])),
    });
    addField('action', 'What is the action of this numbered edit in the complete request? A cut boundary keeps both sides; trimming removes footage. If this edit number exceeds the number requested, choose none.', {
      zoom: option('Change zoom magnification or spatial focus.', 'zoom'), speed: option('Change playback speed.', 'speed'),
      split: option('Split/cut at one or more points or divide in half, retaining both sides.', 'split'), trim: option('Remove footage or keep a time range.', 'trim'),
      merge: option('Merge/join clips.', 'merge'), delete: option('Delete an entire numbered or selected clip.', 'delete'),
      reorder: option('Change the order of clips.', 'reorder'), output: option('Set mute/unmute, output format, resolution or encoding quality.', 'output'),
      none: option('There is no edit at this position; the request contains fewer edits.', 'none'), unsupported,
    });
    const targets: Choices = {
      all: option('The whole video or all clips; default if no clip is specified.', 'all'),
      selected: option('This clip / the selected or current clip.', 'selected'),
      first: option('First clip/part at this stage of the edits.', 'first'), last: option('Last clip/part at this stage of the edits.', 'last'),
      middle: option('The middle clip/part of an odd number of clips.', 'middle'),
      previous: option('Use for it / that clip / the same clip when referring to a preceding edit. Keep this reference as previous; do not substitute a clip number or a split-part reference.', 'previous'),
      right: option('The newly created right/later part from the most recent split.', {split:'latest',side:'right'}),
      left: option('The newly created left/earlier part from the most recent split.', {split:'latest',side:'left'}),
      unsupported,
    };
    const count = Math.min(108, edits.clips.length + MAX_EDITS);
    for (let n=1;n<=count;n++) targets[`clip${n}`]=option(`Clip ${n} after preceding edits; may be created by a split.`,{clip:n});
    for (let n=1;n<=edits.clips.length;n++) targets[`original${n}`]=option(`Explicitly ORIGINAL clip ${n}, before any edits in this request.`,{original:n});
    for (let n=1;n<=i;n++) for (const side of ['left','right'] as const) targets[`split${n}_${side}`]=option(`The ${side} part produced by instruction ${n}.`,{split:n,side});
    addField('target', 'Which clip(s) does this numbered edit act on? Prefer the named selector: last part=last, right part=right, it=previous, first clip=first, clip N=clipN. Only explicitly ORIGINAL references use originalN. No target in THIS edit means all. A target in a later THEN clause does not apply backwards: zoom 2x THEN speed 0.5x for clip 2 means zoom ALL, then speed clip 2. Only AND can share a trailing target. Zoom focus and first/last SECONDS of a trim do not select clips. For merge choose the first named clip.',targets);
    addField('splitTarget', 'Which clip(s) does this numbered edit act on? Prefer the literal reference: this clip=selected, it/the same clip=previous, last part=last, right part=right, clip N=clipN. If THIS edit names no clip or part, choose all. Ignore targets belonging to other edits; a number of seconds is a time, not a clip number.',{
      ...targets,
      all: option('NO clip or part reference in this split: split at 4 seconds / split 3 seconds after / split here. Also explicitly whole video or all clips.', 'all'),
      selected: option('Explicit THIS CLIP, CURRENT CLIP or SELECTED CLIP. Use the selected flag in state.timeline, even if the playhead is elsewhere.', 'selected'),
      previous: option('Explicit IT, THAT CLIP or SAME CLIP referring to an earlier edit in this request.', 'previous'),
    });
    addField('mergeWith', 'For MERGE only, which SECOND clip should be merged with the first? If unnamed, use its next neighbor.', {next:option('The next adjacent clip; no second clip explicitly named.','next'),...targets});
    values('speed','For SPEED only, what playback rate does this numbered edit request? Explicit rates are absolute, bare faster/slower are relative. Slow motion is 0.5x; normal is 1x. Ignore zoom amounts and clip numbers.', ['faster','slower',.25,.5,.75,1,1.25,1.5,1.75,2,3,4,...numbers.filter(n=>n>=.25&&n<=4)], n=>n==='faster'?'Double current speed (faster without a number).':n==='slower'?'Halve current speed (slower without a number).':`Set speed to ${n}x.`);
    values('zoom','For ZOOM only, what magnification does this numbered edit request? Explicit scale is absolute. Normal/no zoom means 1x, double zoom means 2x, triple zoom means 3x. More/closer/zoom in means increase current scale. Zoom out means reduce it. Position-only requests preserve current scale.', ['keep','in','out',1,1.25,1.5,2,3,4,...numbers.filter(n=>n>=1&&n<=4)], n=>n==='keep'?'Only focus/position is requested; preserve current scale (start at 1.5x if unzoomed).':n==='in'?'Zoom in more: multiply current scale by 1.5.':n==='out'?'Zoom out: divide current scale by 1.5.':`Set magnification to ${n}x.`);
    addField('focus','For ZOOM only, what spatial focus is requested? A clip/part reference (right part, middle clip, last part) identifies the target and does NOT request a focus change. Only an explicit spatial direction changes focus. Otherwise choose keep.', {keep:option('No position specified; keep existing focus.',null),...Object.fromEntries([
      ['center',.5,.5],['left',0,.5],['right',1,.5],['top',.5,0],['bottom',.5,1],['top left',0,0],['top right',1,0],['bottom left',0,1],['bottom right',1,1],
    ].map(([name,x,y],n)=>[`p${n}`,option(String(name),{x,y})]))});
    addField('splitReference','For SPLIT only, what time-reference wording does THIS edit use? In half / halfway means half. Exactly here / now without an offset means here. Choose an explicit origin when the user names playhead/here/now, timeline, start or end. Otherwise choose at for at N seconds, or after for after/in/later N seconds. Code combines implicit at/after wording with the target clip; you do not need to calculate the resulting time.',{
      at: option('AT N seconds, with NO explicit timeline/playhead/start/end origin. May name a clip or part.', 'at'),
      after: option('AFTER N seconds / IN N seconds / N seconds LATER, with NO explicit playhead/here/now/start/end origin. May name a clip: split clip 3 after 1 second or split this clip after 1 second.', 'after'),
      timeline: option('Explicit TIMELINE time / timestamp N. The user specifically names the timeline as the time origin.', 'timeline'),
      clipStart: option('Explicit START / BEGINNING of the target, or N seconds INTO a clip / N seconds IN. Not merely after N seconds.', 'clipStart'),
      playheadAfter: option('Explicit AFTER THE PLAYHEAD / from HERE / from NOW: the words playhead, here or now are present. Choose this even when the user also names a clip.', 'playheadAfter'),
      playheadBefore: option('BEFORE the PLAYHEAD / earlier / back N seconds. Not before the clip end.', 'playheadBefore'),
      clipEnd: option('N seconds BEFORE THE END of the target clip or video.', 'clipEnd'),
      here: option('Explicit HERE / NOW / at the current playhead, with no offset. NOT half or halfway.', 'here'),
      half: option('HALF / HALFWAY through the target.', 'half'), unsupported,
    });
    const splits: Choices = {unsupported};
    const timeNumbers = numbers;
    for (const [n,seconds] of [...new Set([0,...timeNumbers])].entries()) {
      splits[`v${n}`]=option(`${seconds} seconds. The time value/offset only; ignore clip numbers and other edits.`,[seconds]);
    }
    for(let a=0;a<timeNumbers.length;a++)for(let b=a+2;b<=Math.min(timeNumbers.length,a+MAX_EDITS);b++){
      const positions=timeNumbers.slice(a,b);
      splits[`list${a}_${b}`]=option(`All requested split time values ${positions.join(', ')} seconds.`,positions);
    }
    addField('split','For SPLIT only, how many seconds are requested? Select just the numeric time/offset, ignoring clip numbers, speeds and other actions. Use the positive amount for before/after. A list of split positions selects all its time values. The time reference is answered separately in splitReference.',splits);
    const trims: Choices = {unsupported};
    for(const [n,seconds] of numbers.entries()) {
      trims[`start${n}`]=option(`Remove the first ${seconds}s. Default for bare trim ${seconds} seconds.`,{mode:'removeStart',seconds});
      trims[`end${n}`]=option(`Remove the last ${seconds}s.`,{mode:'removeEnd',seconds});
      trims[`first${n}`]=option(`Keep ONLY the first ${seconds}s / trim TO ${seconds} seconds.`,{mode:'keepStart',seconds});
      trims[`last${n}`]=option(`Keep ONLY the last ${seconds}s.`,{mode:'keepEnd',seconds});
      for(const [m,end] of numbers.entries()) if(end>seconds) {
        trims[`keep${n}_${m}`]=option(`Keep ONLY ${seconds} to ${end} seconds.`,{mode:'keepRange',start:seconds,end});
        trims[`remove${n}_${m}`]=option(`Remove ${seconds} to ${end} seconds and keep before and after.`,{mode:'removeRange',start:seconds,end});
      }
    }
    addField('trim','For TRIM only, what range should be removed or retained? Times are current edited timeline seconds, or seconds within a specifically named clip. Bare trim N seconds removes the first N; trim TO N keeps the first N.',trims);
    values('order','For REORDER only, where should the target move? Reverse means reversing the order of all clips, not reversed playback.',['first','last','reverse']);
    values('muted','For this OUTPUT edit, include audio instructions joined to the other output settings. For example "set output to 720p webm and mute it" means muted=true in the FIRST output edit. Is audio muted or restored? If neither is requested choose keep.',[true,false],v=>v?'Mute / remove original audio.':'Unmute / restore original audio.',true);
    values('format','For OUTPUT only, which file format is explicitly requested? If absent choose keep.',['mp4','webm'],String,true);
    values('resolution','For OUTPUT only, which pixel resolution is explicitly requested? If absent choose keep.',['original','2160','1440','1080','720','480','360'],v=>v==='original'?'Original resolution':`${v}p${v==='2160'?' / 4K':''}`,true);
    values('quality','For OUTPUT only, which encoding quality or file size is explicitly requested? Resolution and format do not request encoding quality. If absent choose keep.',['maximum','compact'],v=>v==='maximum'?'Best / maximum quality':'Smaller file / compact quality',true);
  }
  const state = { user_request:request.text, duration:sequenceDuration(edits), playhead:time, timeline:edits.clips.map((c,i)=>({clip:i+1,selected:c.id===selectedClip,sourceStart:c.start,sourceEnd:c.end,timelineDuration:clipDuration(c,edits),speed:c.speed,zoom:c.zoom})), rules:ordering+' Execute instructions in order. Clip numbers refer to the timeline at that step. Splits can create clips for later steps. The playhead is the timestamp captured at submission. Never upload or inspect video content.' };
  return {state,questions,choices};
}

export function readChanges(plan: ReturnType<typeof createPlan>, raw: unknown, uncertainTargets?: string[]): Change[] {
  let answers: Record<string,unknown>;
  try { answers=object(object(raw).answers); } catch { throw new EditError('Jev returned an unreadable edit. Please try again.',502,'INVALID_MODEL_RESPONSE'); }
  function pick<T>(key: string): T {
    let answer: Record<string,unknown>;
    try {answer=object(answers[key]);} catch {throw new EditError('Jev returned an incomplete edit. Please try again.',502,'INVALID_MODEL_RESPONSE');}
    if(answer.type!=='choice'||typeof answer.choice!=='string'||!Object.hasOwn(plan.choices[key],answer.choice))throw new EditError('Jev returned an unreadable edit. Please try again.',502,'INVALID_MODEL_RESPONSE');
    const value=plan.choices[key][answer.choice].value;
    if(value==='unsupported')throw new EditError(`I couldn’t match the ${key.endsWith('Target')?'target clip':key.split('_')[1]||'requested'} value. Try a specific clip, time or amount. Nothing was changed.`,422,'UNSUPPORTED_VALUE');
    if(typeof answer.confidence!=='number'||!Number.isFinite(answer.confidence)||answer.confidence<0||answer.confidence>1)throw new EditError('Jev returned an unreadable confidence. Please try again.',502,'INVALID_MODEL_RESPONSE');
    // Several selectors can name the same single clip; do not reject an
    // otherwise unambiguous edit just because their probabilities are shared.
    const sameClip=(key.endsWith('_target')||key.endsWith('_splitTarget'))&&plan.state.timeline.length===1&&key.startsWith('edit1_')&&['all','selected','first','last','middle','clip1','original1'].includes(answer.choice);
    if(answer.confidence<.3&&!sameClip){
      if(uncertainTargets&&(key.endsWith('_target')||key.endsWith('_splitTarget')))uncertainTargets.push(key);
      else throw new EditError('One part of that edit isn’t clear enough. Specify its clip, time or value. Nothing was changed.',422,'UNCLEAR_REQUEST');
    }
    return value as T;
  }
  const status=pick<'ready'|'UNSUPPORTED_EDIT'|'UNCLEAR_REQUEST'>('status');
  if(status==='UNSUPPORTED_EDIT')throw new EditError('I can change timing, speed, zoom, audio and output settings. I can’t inspect video content or add captions, music or transitions. Nothing was changed.',422,status);
  if(status==='UNCLEAR_REQUEST')throw new EditError('What would you like to change? Include an action, such as “split 3 seconds after”.',422,status);
  const count=pick<number|'TOO_MANY_EDITS'>('count');
  if(count==='TOO_MANY_EDITS')throw new EditError(`Please use up to ${MAX_EDITS} edits per prompt. Nothing was changed.`,422,count);
  if(count===0)throw new EditError('What would you like to change? Try “split 3 seconds after”.',422,'UNCLEAR_REQUEST');
  const changes: Change[]=[];
  for(let i=0;i<count;i++){
    const prefix=`edit${i+1}_`, get=<T>(key:string)=>pick<T>(prefix+key);
    const action=get<Change['action']|'none'>('action');
    if(action==='none')throw new EditError('Jev returned an incomplete plan. Please try again. Nothing was changed.',502,'INVALID_MODEL_RESPONSE');
    if(action==='output'){
      const settings: Extract<Change,{action:'output'}>['settings']={};
      for(const key of ['muted','format','resolution','quality'] as const){const value=get(key);if(value!==null)Object.assign(settings,{[key]:value});}
      if(!Object.keys(settings).length)throw new EditError('Which output setting should change? Nothing was changed.');
      changes.push({action,settings}); continue;
    }
    const clip=get<Target>(action==='split'?'splitTarget':'target');
    switch(action){
      case 'split':{
        const reference=get<'at'|'after'|'timeline'|'clipStart'|'playheadAfter'|'playheadBefore'|'clipEnd'|'here'|'half'>('splitReference');
        const origin=reference==='at'?(clip==='all'?'timeline':'clipStart'):reference==='after'?(clip==='all'?'playheadAfter':'clipStart'):reference;
        const positions=reference==='here'||reference==='half'?[0]:get<number[]>('split');
        for(const [n,seconds] of positions.entries()){
          const at:Time=origin==='half'?{from:'half'}:origin==='here'?{from:'playhead',seconds:0}
            :origin==='playheadAfter'||origin==='playheadBefore'?{from:'playhead',seconds:origin==='playheadBefore'?-seconds:seconds}
            :{from:origin,seconds:origin==='clipEnd'?-seconds:seconds};
          changes.push({action,clip,at,result:`split${i+1}${n?`_${n+1}`:''}`});
        }
        break;
      }
      case 'trim':changes.push({action,clip,range:get<Trim>('trim')});break;
      case 'speed':changes.push({action,clip,rate:get<number|'faster'|'slower'>('speed')});break;
      case 'zoom':changes.push({action,clip,scale:get<number|'in'|'out'|'keep'>('zoom'),focus:get('focus')});break;
      case 'merge':changes.push({action,clips:[clip,get<Target|'next'>('mergeWith')]});break;
      case 'delete':changes.push({action,clip});break;
      case 'reorder':changes.push({action,clip,to:get('order')});break;
    }
  }
  if(changes.length>MAX_EDITS)throw new EditError(`Please use up to ${MAX_EDITS} edits per prompt. Nothing was changed.`,422,'TOO_MANY_EDITS');
  if(!changes.length)throw new EditError('What would you like to change? Try “split 3 seconds after”.');
  return changes;
}

export function compileAnswer(request: ChatRequest, plan: ReturnType<typeof createPlan>, raw: unknown): ChatResult {
  const uncertainTargets:string[]=[];
  const result=compileChanges(request,readChanges(plan,raw,uncertainTargets));
  // Equivalent target names can divide Jev's probability mass (e.g. "last",
  // "right part", and "clip 2" after a split). Accept uncertainty only when
  // at least 85% of that mass compiles to the EXACT same deterministic batch.
  const answers=object(object(raw).answers), signature=JSON.stringify(result.batch.commands);
  for(const key of uncertainTargets){
    const answer=object(answers[key]), probabilities=object(answer.probabilities??{});
    let equivalent=0,total=0;
    for(const [choice,probability] of Object.entries(probabilities)){
      if(!Object.hasOwn(plan.choices[key],choice)||typeof probability!=='number'||!Number.isFinite(probability)||probability<0||probability>1)throw new EditError('Jev returned unreadable target probabilities. Please try again.',502,'INVALID_MODEL_RESPONSE');
      total+=probability;
      if(!probability)continue;
      try{
        const alternate={answers:{...answers,[key]:{...answer,choice,confidence:1}}};
        const candidate=compileChanges(request,readChanges(plan,alternate,[]));
        if(JSON.stringify(candidate.batch.commands)===signature)equivalent+=probability;
      }catch{ /* Invalid or different targets cannot contribute confidence. */ }
    }
    if(Math.abs(total-1)>.02||equivalent<.85)throw new EditError('The target clip isn’t clear enough. Specify which clip to change. Nothing was changed.',422,'UNCLEAR_REQUEST');
  }
  return result;
}
