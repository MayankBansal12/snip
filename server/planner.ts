import { object, normalizeEdits } from '../src/engine/index';
import type { ChatRequest, ChatResult } from '../src/chat';
import { clipDuration, sequenceDuration } from '../src/types';
import { compileChanges } from './compiler';
import { EditError, MAX_EDITS } from './operations';
import type { Change, Target, Time, Trim } from './operations';
export { EditError } from './operations';

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


// Identify instruction boundaries, preserving time ranges and number lists.
// Jev still decides the action and arguments; fragments retain the full request
// as context for pronouns and references to parts created by earlier edits.
export function instructionsIn(text: string): string[] {
  const verb = '(?:split|cut|divide|trim|keep|remove|delete|merge|join|reverse|reorder|make|apply|set|move|zoom|focus|pan|mute|unmute|restore|add|export|speed|slow|increase|decrease|reset|turn|change|crop|rotate|add(?:ing)?|zoom(?:ing)?|mut(?:ing)?|speed(?:ing)?)';
  const subject = '(?:(?:the )?(?:first|second|third|fourth|fifth|last|next|middle) (?:clip|part)|clip (?:\\d+|one|two|three|four|five))';
  const start = `(?=(?:(?:please|then|also)\\s+)*(?:${verb}\\b|${subject}\\b))`;
  return text.split(new RegExp(`(?:[;\\n]+|[,.]\\s+${start}|\\s+(?:and(?:\\s+then)?|then|also|while)\\s+${start})`, 'i'))
    .map(s => s.replace(/^\s*(?:[-•]|\d+[.)])\s+/, '').trim()).filter(Boolean);
}

export function createPlan(request: ChatRequest) {
  const fragments = instructionsIn(request.text);
  if (fragments.length > MAX_EDITS) throw new EditError(`Please use up to ${MAX_EDITS} edits per prompt. Nothing was changed.`);
  const choices: Record<string, Choices> = {}, questions: Record<string, Question> = {};
  function add(key: string, question: string, options: Choices, index?: number) {
    choices[key] = options;
    questions[key] = { type: 'choice', instructions: index === undefined ? question : {
      question: `${question} Evaluate only this instruction. The full request and earlier instructions are context, not additional edits to apply here.`,
      instruction: fragments[index], instruction_number: index + 1,
    }, criteria: Object.fromEntries(Object.entries(options).map(([k,v]) => [k,v.description])) };
  }
  add('support', 'Can every instruction in user_request be implemented using split, trim, zoom/focus, speed, merge, delete, reorder, mute, output format/resolution/quality? Multiple edits and repeated controls are supported. Relative times and references to newly split parts are supported. Bare trim N seconds means remove the first N seconds. Reject requests that require understanding the video/audio content, captions, music, transitions, filters, crop/aspect, reversed playback or downloading/exporting a file.', {
    supported: option('All requested edits use the supported controls.', true), unsupported: option('At least one requested capability is unavailable.', false),
  });
  const { edits, time, selectedClip } = request.project;
  for (const [i, fragment] of fragments.entries()) {
    const prefix = `edit${i+1}_`, numbers = numbersIn(fragment);
    const addField = (key: string, question: string, options: Choices) => add(prefix+key, question, options, i);
    const values = (key: string, question: string, items: (string|number|boolean)[], describe: (n: string|number|boolean)=>string=String, optional=false) => addField(key, question, {
      ...(optional ? {keep} : {}), unsupported,
      ...Object.fromEntries([...new Set(items)].map((v,n) => [`v${n}`,option(describe(v),v)])),
    });
    addField('action', 'What operation does this instruction request? Choose the single action that implements it. A zoom amount with its focus is one zoom. Multiple output settings are one output action. A list of split timestamps is one split instruction. If this fragment still contains different independent actions that cannot be represented together, choose compound. A cut boundary keeps both sides; trimming removes footage.', {
      zoom: option('Change zoom magnification or spatial focus.', 'zoom'), speed: option('Change playback speed.', 'speed'),
      split: option('Split/cut at one or more points or divide in half, retaining both sides.', 'split'), trim: option('Remove footage or keep a time range.', 'trim'),
      merge: option('Merge/join clips.', 'merge'), delete: option('Delete an entire numbered or selected clip.', 'delete'),
      reorder: option('Change the order of clips.', 'reorder'), output: option('Set mute/unmute, output format, resolution or encoding quality.', 'output'),
      none: option('No edit requested in this fragment; only politeness or acknowledgment.', 'none'),
      compound: option('Several independent actions remain in this fragment; no single action covers them.', 'compound'), unsupported,
    });
    const targets: Choices = {
      all: option('The whole video or all clips; default if no clip is specified.', 'all'),
      selected: option('This clip / the selected or current clip.', 'selected'),
      first: option('First clip/part at this stage of the edits.', 'first'), last: option('Last clip/part at this stage of the edits.', 'last'),
      middle: option('The middle clip/part of an odd number of clips.', 'middle'),
      previous: option('It / that clip / the same clip refers to the target of the preceding instruction.', 'previous'),
      right: option('The newly created right/later part from the most recent split.', {split:'latest',side:'right'}),
      left: option('The newly created left/earlier part from the most recent split.', {split:'latest',side:'left'}),
      unsupported,
    };
    const count = Math.min(108, edits.clips.length + MAX_EDITS);
    for (let n=1;n<=count;n++) targets[`clip${n}`]=option(`Clip number ${n} in the timeline after earlier instructions. Do not check existence; earlier splits may create it.`,{clip:n});
    for (let n=1;n<=edits.clips.length;n++) targets[`original${n}`]=option(`Explicitly ORIGINAL clip ${n}, before any edits in this request.`,{original:n});
    for (let n=1;n<=i;n++) for (const side of ['left','right'] as const) targets[`split${n}_${side}`]=option(`The ${side} part produced by instruction ${n}.`,{split:n,side});
    addField('target', 'Which clip(s) are the target? For merge, choose the FIRST named clip. For split, a named clip means times within that clip; otherwise all means timeline time. A relative split AFTER/BEFORE the playhead is timeline-wide unless a particular clip is named. Spatial zoom directions like middle/center/left refer to focus, NOT clip selection. If no clip is named, use all. After a previous instruction, "it/that part" may refer to its target. Do not evaluate clip existence.', targets);
    addField('mergeWith', 'For MERGE only, which SECOND clip should be merged with the first? If unnamed, use its next neighbor.', {next:option('The next adjacent clip; no second clip explicitly named.','next'),...targets});
    values('speed','For SPEED only, what playback rate does this instruction request? Explicit rates are absolute, bare faster/slower are relative. Slow motion is 0.5x; normal is 1x. Ignore zoom amounts and clip numbers.', ['faster','slower',.25,.5,.75,1,1.25,1.5,1.75,2,3,4,...numbers.filter(n=>n>=.25&&n<=4)], n=>n==='faster'?'Double current speed (faster without a number).':n==='slower'?'Halve current speed (slower without a number).':`Set speed to ${n}x.`);
    values('zoom','For ZOOM only, what magnification does this instruction request? Explicit scale is absolute. More/closer/zoom in means increase current scale. Zoom out means reduce it. Position-only requests preserve current scale.', ['keep','in','out',1,1.25,1.5,2,3,4,...numbers.filter(n=>n>=1&&n<=4)], n=>n==='keep'?'Only focus/position is requested; preserve current scale (start at 1.5x if unzoomed).':n==='in'?'Zoom in more: multiply current scale by 1.5.':n==='out'?'Zoom out: divide current scale by 1.5.':`Set magnification to ${n}x.`);
    addField('focus','For ZOOM only, where should the frame focus? Middle means spatial center. If focus is unspecified, preserve it.', {keep:option('No position specified; keep existing focus.',null),...Object.fromEntries([
      ['center',.5,.5],['left',0,.5],['right',1,.5],['top',.5,0],['bottom',.5,1],['top left',0,0],['top right',1,0],['bottom left',0,1],['bottom right',1,1],
    ].map(([name,x,y],n)=>[`p${n}`,option(String(name),{x,y})]))});
    const splits: Choices = {unsupported,here:option('Split here/now, exactly at the playhead captured when this request was submitted.',[{from:'playhead',seconds:0}]),half:option('Split in half / halfway through the target.',[{from:'half'}])};
    const timeNumbers = numbersIn(fragment.replace(/\b(?:clip|part)\s+(?:\d+|one|two|three|four|five|six|seven|eight)\b/gi,''));
    for (const [n,seconds] of timeNumbers.entries()) {
      splits[`at${n}`]=option(`Split AT ${seconds}s, an absolute timeline timestamp (or ${seconds}s into a specifically named clip).`,[{from:'timeline',seconds}]);
      splits[`after${n}`]=option(`Split ${seconds}s AFTER / later / ahead / from here / in ${seconds}s: offset from the current playhead.`,[{from:'playhead',seconds}]);
      splits[`before${n}`]=option(`Split ${seconds}s BEFORE / earlier / back: negative offset from the current playhead.`,[{from:'playhead',seconds:-seconds}]);
      splits[`end${n}`]=option(`Split ${seconds}s BEFORE THE END of the target.`,[{from:'clipEnd',seconds:-seconds}]);
    }
    if(timeNumbers.length>1) splits.multiple=option(`Split at ALL these explicitly listed absolute timestamps, in order: ${timeNumbers.join(', ')} seconds.`,timeNumbers.map(seconds=>({from:'timeline',seconds})));
    addField('split','For SPLIT only, choose the requested position(s). At N seconds means absolute time; N seconds after/later/from here or in N seconds means playhead plus N, even without an explicit reference. Before/earlier means playhead minus N. A list such as split at 4 and 8 seconds requests both timestamps. Select the meaning even if out of bounds; code validates it.',splits);
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
    values('muted','For OUTPUT only, is the original audio being muted or restored? If neither is requested choose keep.',[true,false],v=>v?'Mute / remove original audio.':'Unmute / restore original audio.',true);
    values('format','For OUTPUT only, which file format is explicitly requested? If absent choose keep.',['mp4','webm'],String,true);
    values('resolution','For OUTPUT only, which pixel resolution is explicitly requested? If absent choose keep.',['original','2160','1440','1080','720','480','360'],v=>v==='original'?'Original resolution':`${v}p${v==='2160'?' / 4K':''}`,true);
    values('quality','For OUTPUT only, which encoding quality or file size is explicitly requested? Resolution and format do not request encoding quality. If absent choose keep.',['maximum','compact'],v=>v==='maximum'?'Best / maximum quality':'Smaller file / compact quality',true);
  }
  const state = { user_request:request.text, instructions:fragments, duration:sequenceDuration(edits), playhead:time, timeline:edits.clips.map((c,i)=>({clip:i+1,selected:c.id===selectedClip,sourceStart:c.start,sourceEnd:c.end,timelineDuration:clipDuration(c,edits),speed:c.speed,zoom:c.zoom})), rules:'Execute instructions in order. Clip numbers refer to the timeline at that step. Splits can create clips for later steps. The playhead is the timestamp captured at submission. Never upload or inspect video content.' };
  return {state,questions,choices,fragments};
}

export function readChanges(plan: ReturnType<typeof createPlan>, raw: unknown): Change[] {
  let answers: Record<string,unknown>;
  try { answers=object(object(raw).answers); } catch { throw new EditError('Jev returned an unreadable edit. Please try again.',502); }
  function pick<T>(key: string): T {
    let answer: Record<string,unknown>;
    try {answer=object(answers[key]);} catch {throw new EditError('Jev returned an incomplete edit. Please try again.',502);}
    if(answer.type!=='choice'||typeof answer.choice!=='string'||!Object.hasOwn(plan.choices[key],answer.choice))throw new EditError('Jev returned an unreadable edit. Please try again.',502);
    const value=plan.choices[key][answer.choice].value;
    if(value==='unsupported')throw new EditError(`I couldn’t match the ${key.split('_')[1]||'requested'} value. Try a specific clip, time or amount. Nothing was changed.`);
    if(typeof answer.confidence!=='number'||!Number.isFinite(answer.confidence)||answer.confidence<0||answer.confidence>1)throw new EditError('Jev returned an unreadable confidence. Please try again.',502);
    // Several selectors can name the same single clip; do not reject an
    // otherwise unambiguous edit just because their probabilities are shared.
    const sameClip=key.endsWith('_target')&&plan.state.timeline.length===1&&plan.fragments.length===1&&['all','selected','first','last','middle','clip1','original1'].includes(answer.choice);
    if(answer.confidence<.3&&!sameClip)throw new EditError('One part of that edit isn’t clear enough. Specify its clip, time or value. Nothing was changed.');
    return value as T;
  }
  if(!pick<boolean>('support'))throw new EditError('I can change timing, speed, zoom, audio and output settings. I can’t inspect video content or add captions, music or transitions. Nothing was changed.');
  const changes: Change[]=[];
  for(let i=0;i<plan.fragments.length;i++){
    const prefix=`edit${i+1}_`, get=<T>(key:string)=>pick<T>(prefix+key);
    const action=get<Change['action']|'none'|'compound'>('action');
    if(action==='none')continue;
    if(action==='compound')throw new EditError(`Separate instruction ${i+1} into individual edits with “then” so each has its own target and value. Nothing was changed.`);
    if(action==='output'){
      const settings: Extract<Change,{action:'output'}>['settings']={};
      for(const key of ['muted','format','resolution','quality'] as const){const value=get(key);if(value!==null)Object.assign(settings,{[key]:value});}
      if(!Object.keys(settings).length)throw new EditError('Which output setting should change? Nothing was changed.');
      changes.push({action,settings}); continue;
    }
    const clip=get<Target>('target');
    switch(action){
      case 'split':for(const [n,at] of get<Time[]>('split').entries())changes.push({action,clip,at,result:`split${i+1}${n?`_${n+1}`:''}`});break;
      case 'trim':changes.push({action,clip,range:get<Trim>('trim')});break;
      case 'speed':changes.push({action,clip,rate:get<number|'faster'|'slower'>('speed')});break;
      case 'zoom':changes.push({action,clip,scale:get<number|'in'|'out'|'keep'>('zoom'),focus:get('focus')});break;
      case 'merge':changes.push({action,clips:[clip,get<Target|'next'>('mergeWith')]});break;
      case 'delete':changes.push({action,clip});break;
      case 'reorder':changes.push({action,clip,to:get('order')});break;
    }
  }
  if(changes.length>MAX_EDITS)throw new EditError(`Please use up to ${MAX_EDITS} edits per prompt. Nothing was changed.`);
  if(!changes.length)throw new EditError('What would you like to change? Try “split 3 seconds after”.');
  return changes;
}

export function compileAnswer(request: ChatRequest, plan: ReturnType<typeof createPlan>, raw: unknown): ChatResult {
  return compileChanges(request,readChanges(plan,raw));
}
