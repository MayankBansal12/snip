import { applyCommands, normalizeEdits, object } from '../src/engine/index';
import type { Command } from '../src/engine/index';
import type { ChatRequest, ChatResult } from '../src/chat';
import type { Control } from './intent';
import { zoomFocusLabel } from '../src/zoom';
import { clipSpeed, defaultZoom, sequenceDuration, toSourceTime } from '../src/types';

export class EditError extends Error {
  constructor(message: string, readonly status = 422) { super(message); }
}
type Option<T = unknown> = { description: string; value: T };
type Question = { type: 'choice'; instructions: { question: string; user_request: string }; criteria: Record<string, string> };
type Choices = Record<string, Option>;
const none = { description: 'No change to this setting is requested.', value: null };
const unknown = { description: 'The requested value or edit is not one of the available options.', value: 'unsupported' };
const round = (n: number) => Math.round(n * 1000000) / 1000000;

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

// Keep numbers and directions from separate instructions from leaking into one
// another. Only split conjunctions followed by a new edit verb; "between 2 and 5"
// stays intact. Unrecognized wording retains the full request for Jev to infer.
export function controlText(text: string, control: Control): string {
  const clauses = text.split(/(?:[,;]\s*|\s+(?:and(?:\s+then)?|then|also)\s+)(?=(?:please\s+)?(?:split|cut|trim|keep|remove|delete|merge|join|reverse|reorder|make|apply|set|move|zoom|focus|pan|mute|unmute|restore|add|export)\b)/i);
  const markers: Record<Control, RegExp> = {
    split: /\b(?:split|cut|divide)\b/i, trim: /\b(?:trim|keep|remove|shorten|cut)\b/i,
    speed: /\b(?:speed|faster|slower|slow|motion)\b/i, zoom: /\b(?:zoom|magnif|focus|pan|closer)\b/i,
    delete: /\b(?:delete|remove)\b/i, merge: /\b(?:merge|join)\b/i, reorder: /\b(?:reorder|move|reverse)\b/i,
    muted: /\b(?:mute|unmute|audio|sound|silent)\b/i, format: /\b(?:mp4|webm|format)\b/i,
    resolution: /\b(?:resolution|\d+p|4k)\b/i, quality: /\b(?:quality|smaller|compact|file size)\b/i,
  };
  const matching = clauses.filter(clause => markers[control].test(clause));
  return matching.length === 1 ? matching[0].trim() : text;
}

export function createPlan(request: ChatRequest, requested: Control[]) {
  const { edits, time, selectedClip } = request.project;
  const duration = sequenceDuration(edits), numbers = numbersIn(request.text);
  const choices: Record<string, Choices> = {}, questions: Record<string, Question> = {};
  function add(name: string, instructions: string, options: Choices) {
    const control = name === 'anchor' || name === 'zoomScope' ? 'zoom' : name === 'speedScope' ? 'speed' : name;
    if (!requested.includes(control as Control)) return;
    // These controls were explicitly requested, so only their value is in question.
    options = Object.fromEntries(Object.entries(options).filter(([key]) => key !== 'none'));
    choices[name] = options;
    questions[name] = { type: 'choice', instructions: { question: `${instructions} Evaluate only the user_request provided here. Do not invent extra edits.`, user_request: controlText(request.text, control as Control) }, criteria: Object.fromEntries(Object.entries(options).map(([key, option]) => [key, option.description])) };
  }
  function setting(name: string, instructions: string, values: (string | number | boolean)[], describe: (v: string | number | boolean) => string = String) {
    add(name, instructions + ' This setting IS requested. Choose its matching value; unsupported only if the requested value is unavailable.', {
      none, unsupported: unknown, ...Object.fromEntries([...new Set(values)].map((value, i) => [`v${i}`, { description: describe(value), value }])),
    });
  }
  const scopes: Choices = {
    all: { description: 'All clips / the whole video. Default when no particular clip is named. Spatial zoom directions like middle, center or top left still use this scope.', value: 'all' },
    selected: { description: 'Only the selected clip: the user explicitly says this clip, selected clip or current clip.', value: 'selected' },
    first: { description: 'The first clip (after any requested split).', value: 'first' },
    last: { description: 'The last clip (after any requested split).', value: 'last' },
    unsupported: { description: 'An explicitly stated TIME interval (between 3 and 7 seconds), clip number not listed in these options, or ambiguous clip subset. Spatial middle/center/top/left/right are NOT this option.', value: 'unsupported' },
    ...Object.fromEntries(Array.from({ length: edits.clips.length + 1 }, (_, i) => [`clip${i + 1}`, { description: `Clip number ${i + 1} in the timeline, after any requested split.`, value: i }])),
  };
  setting('speed', 'What playback speed is requested? An explicit rate is absolute. Bare faster/slower are relative to the current rate. Slow motion means 0.5×, normal means 1×. Ignore zoom multipliers.', ['faster', 'slower', .25, .5, .75, 1, 1.25, 1.5, 1.75, 2, 3, 4, ...numbers.filter(n => n >= .25 && n <= 4)], v => v === 'faster' ? 'Make it faster without an explicit rate: double current speed, up to 4×.' : v === 'slower' ? 'Make it slower without an explicit rate: halve current speed, down to 0.25×.' : `Set playback speed to ${v}×.`);
  add('speedScope', 'Which clip number or scope does the user name for SPEED? Do not check clip existence: a requested split happens first, so the new clip is valid. A specific time interval within a clip is unsupported; ask for a split first.', scopes);
  setting('zoom', 'What zoom magnification is requested? For a POSITION ONLY request (zoom needs to be top left, move the zoom), keep the current scale. Bare zoom in/closer and zoom out are relative. Reset zoom means 1×. Ignore playback speed.', ['keep', 'in', 'out', 1, 1.25, 1.5, 2, 3, 4, ...numbers.filter(n => n >= 1 && n <= 4)], v => v === 'keep' ? 'Only zoom position/focus is requested: keep current zoom (use 1.5× if not yet zoomed).' : v === 'in' ? 'Zoom in / closer without a number: increase current magnification by 1.5×.' : v === 'out' ? 'Zoom out without a number: reduce current magnification by 1.5×.' : `Set zoom magnification to ${v}×.`);
  add('zoomScope', 'Which clip number or scope does the user name for ZOOM? Do not check clip existence: a requested split happens first, so the new clip is valid. Middle, center, top left, etc. describe a spatial focus, not a time interval. Default all unless a clip is specified. An explicit TIME interval is unsupported; ask for a split first.', scopes);
  add('anchor', 'Where should the zoom focus spatially? Middle means CENTER of the frame. If position is not mentioned, KEEP existing focus.', { keep: { description: 'No spatial position was requested. Preserve existing focus.', value: null }, ...Object.fromEntries([
    ['center', .5, .5], ['left', 0, .5], ['right', 1, .5], ['top', .5, 0], ['bottom', .5, 1],
    ['top left', 0, 0], ['top right', 1, 0], ['bottom left', 0, 1], ['bottom right', 1, 1],
  ].map(([description, x, y], i) => [`p${i}`, { description: String(description), value: { x, y } }])) });
  const trims: Choices = { none: { description: 'No time interval is being trimmed or removed. Whole-clip deletion, merging, reordering, speed, zoom and output settings are separate controls.', value: null }, unsupported: { description: 'An explicit trim or time-range removal is requested, but none of these time intervals match it.', value: 'unsupported' } };
  const putTrim = (description: string, start: number, end: number, remove = false) => {
    if (start >= 0 && end <= duration && end > start && (remove ? end - start < duration : start > 0 || end < duration)) trims[`t${Object.keys(trims).length}`] = { description, value: { start, end, remove } };
  };
  const times = [...new Set([0, ...numbers.filter(n => n >= 0 && n <= duration)])];
  for (const n of times) {
    putTrim(`Remove the first ${n} seconds from the entire timeline. Also the default for bare 'trim ${n} seconds' without a direction.`, n, duration);
    putTrim(`Remove the last ${n} seconds from the entire timeline.`, 0, round(duration - n));
    putTrim(`Keep only the first ${n} seconds of the entire timeline (trim to ${n} seconds).`, 0, n);
    putTrim(`Keep only the last ${n} seconds of the entire timeline.`, round(duration - n), duration);
    for (const end of times.filter(end => end > n)) {
      putTrim(`Keep only the section from ${n} to ${end} seconds.`, n, end);
      putTrim(`Remove the section from ${n} to ${end} seconds; keep everything before and after.`, n, end, true);
    }
  }
  add('trim', 'Which exact trim or time-range removal is requested? Deleting, merging or reordering WHOLE CLIPS are separate controls: choose none for those. All times refer to the current edited TIMELINE, not original source time. A bare "trim N seconds" means remove the first N seconds. "Trim TO N seconds" means keep the first N seconds. unsupported if no interval matches.', trims);
  const splits: Choices = { none, unsupported: unknown };
  for (const n of [...new Set([...numbers, time, duration / 2])].filter(n => n > 0 && n < duration)) splits[`s${Object.keys(splits).length}`] = { description: `Split at ${round(n)} seconds on the current timeline${n === time ? ' (current playhead / here)' : ''}${n === duration / 2 ? ' (halfway)' : ''}.`, value: n };
  add('split', 'Is one split / cut into two clips requested, and at which exact timeline time? A trim/removal alone does not also require a split. none if absent, unsupported if no exact match.', splits);
  const clipOptions: Choices = { none, unsupported: unknown, selected: { description: 'The selected clip.', value: 'selected' }, first: scopes.first, last: scopes.last,
    ...Object.fromEntries(edits.clips.map((_, i) => [`clip${i + 1}`, scopes[`clip${i + 1}`]])) };
  add('delete', 'Is deletion of one WHOLE clip requested? Do not select a clip for a time-range trim/removal. none if absent.', clipOptions);
  add('merge', 'Should a clip be merged with its next neighbor? Only contiguous source ranges with matching speed and zoom can merge. none if absent.', clipOptions);
  add('reorder', 'Is clip order being changed? none if absent.', {
    none, unsupported: unknown,
    reverse: { description: 'Reverse the ORDER of all clips (not playing footage backwards).', value: 'reverse' },
    first: { description: 'Move the selected clip to the start.', value: 'first' },
    last: { description: 'Move the selected clip to the end.', value: 'last' },
  });
  setting('muted', 'Is audio muting requested?', [true, false], v => v ? 'Mute / remove all audio.' : 'Unmute / restore original audio.');
  setting('format', 'Is the export file format being set? Do not download the file.', ['mp4', 'webm']);
  setting('resolution', 'Is the output resolution being set?', ['original', '2160', '1440', '1080', '720', '480', '360'], v => v === 'original' ? 'Original resolution' : `${v}p${v === '2160' ? ' / 4K' : ''}`);
  setting('quality', 'Is ENCODING QUALITY or file size being set? Resolution (720p, 1080p, 4K) and format (MP4/WebM) are separate settings: choose none when only those are mentioned.', ['maximum', 'compact'], v => v === 'maximum' ? 'Best / maximum quality' : 'Smaller file / compact export');
  const state = { planned_controls: requested, target_clip_count_after_split: edits.clips.length + (requested.includes('split') ? 1 : 0), split_happens_before_other_edits: requested.includes('split'), current_timeline: edits.clips.map((c, i) => ({ clip: i + 1, selected: c.id === selectedClip, sourceStart: c.start, sourceEnd: c.end, speed: c.speed, zoom: c.zoom })), duration, playhead: time };
  return { state, questions, choices };
}

export function compileAnswer(request: ChatRequest, plan: ReturnType<typeof createPlan>, raw: unknown): ChatResult {
  const answers = object(object(raw).answers);
  let edits = request.project.edits;
  function pick<T>(key: string): T | null {
    if (!Object.hasOwn(plan.questions, key)) return null;
    const answer = object(answers[key]);
    if (answer.type !== 'choice' || typeof answer.choice !== 'string' || !Object.hasOwn(plan.choices[key], answer.choice)) throw new EditError('Jev returned an unreadable edit. Please try again.', 502);
    const option = plan.choices[key][answer.choice];
    if (option.value === 'unsupported') {
      const hints: Record<string,string> = { split: 'Where should I split? Use a timeline time, such as “split at 4 seconds”.', trim: 'Which section should I trim? Try “remove the first 5 seconds” or “keep 2 to 8 seconds”.', speed: 'Choose a speed from 0.25× to 4×.', zoom: 'Choose a zoom from 1× to 4×, or a position such as top left.', zoomScope: 'Which clip should I zoom? Use a clip number or “the whole video”.', speedScope: 'Which clip should change speed? Use a clip number or “the whole video”.' };
      throw new EditError(hints[key] || `I couldn’t match the requested ${key} edit. Try a specific clip or value.`);
    }
    if (typeof answer.confidence !== 'number' || !Number.isFinite(answer.confidence) || (answer.confidence < .3 && !((key==='speedScope'||key==='zoomScope') && edits.clips.length===1 && ['all','selected','first','last','clip1'].includes(answer.choice))) || answer.confidence > 1) throw new EditError('That edit isn’t clear enough yet. Try a clip number and an exact value.');
    return option.value as T | null;
  }

  const commands: Command[] = [], summaries: string[] = [];
  let serial = 0;
  const newId = () => {
    let id: string;
    do { id = `chat-${request.requestId.slice(0,80)}-${++serial}`; } while (edits.clips.some(c => c.id === id));
    return id;
  };
  const run = (command: Command) => { edits = applyCommands(edits, [command], request.project.duration); commands.push(command); };
  const target = (scope: string | number | null) => {
    const clips = edits.clips;
    if (scope === 'all') return clips;
    const clip = scope === 'selected' ? clips.find(c => c.id === request.project.selectedClip) : scope === 'first' ? clips[0] : scope === 'last' ? clips.at(-1) : typeof scope === 'number' ? clips[scope] : undefined;
    if (!clip) throw new EditError('That clip is no longer on the timeline. Choose another clip.');
    return [clip];
  };
  try {
    const split = pick<number>('split');
    if (split !== null) {
      const point = toSourceTime(split, edits), clip = edits.clips[point.index];
      run({ action: 'splitClip', clipId: clip.id, sourceTime: point.time, rightClipId: newId() });
      summaries.push(`split at ${round(split)}s`);
    }
    const trim = pick<{ start: number; end: number; remove: boolean }>('trim');
    if (trim) {
      let offset = 0;
      const retained: { id: string; start: number; end: number }[] = [];
      for (const clip of edits.clips) {
        const speed = clipSpeed(clip, edits), end = offset + (clip.end - clip.start) / speed;
        const ranges = trim.remove ? [[0, trim.start], [trim.end, sequenceDuration(edits)]] : [[trim.start, trim.end]];
        for (const [a, b] of ranges) {
          const start = Math.max(offset, a), stop = Math.min(end, b);
          if (stop - start > 1e-7) retained.push({ id: clip.id, start: Math.max(clip.start, round(clip.start + (start - offset) * speed)), end: Math.min(clip.end, round(clip.start + (stop - offset) * speed)) });
        }
        offset = end;
      }
      if (!retained.length) throw new EditError('That trim would remove the entire video.');
      // Split retained pieces before deleting anything, so the engine always has at least one clip.
      for (const clip of [...edits.clips]) {
        const parts = retained.filter(part => part.id === clip.id);
        if (parts.length === 2) {
          const rightId = newId();
          run({ action: 'splitClip', clipId: clip.id, sourceTime: parts[1].start, rightClipId: rightId });
          parts[1].id = rightId;
        }
      }
      for (const part of retained) run({ action: 'trimClip', clipId: part.id, sourceStart: part.start, sourceEnd: part.end });
      for (const clip of [...edits.clips]) if (!retained.some(part => part.id === clip.id)) run({ action: 'deleteClip', clipId: clip.id });
      summaries.push(trim.remove ? `removed ${trim.start}–${trim.end}s` : trim.end === sequenceDuration(request.project.edits) ? `removed first ${trim.start}s` : `kept ${trim.start}–${trim.end}s`);
    }
    const speed = pick<number | 'faster' | 'slower'>('speed');
    if (speed !== null) {
      for (const clip of target(pick<string | number>('speedScope'))) run({ action: 'setSpeed', clipId: clip.id, speed: speed === 'faster' ? Math.min(4, clipSpeed(clip, edits) * 2) : speed === 'slower' ? Math.max(.25, clipSpeed(clip, edits) / 2) : speed });
      summaries.push(typeof speed === 'number' ? `speed ${speed}×` : `playback ${speed}`);
    }
    const zoom = pick<number | 'keep' | 'in' | 'out'>('zoom');
    if (zoom !== null) {
      const anchor = pick<{ x: number; y: number }>('anchor');
      const clips = target(pick<string | number>('zoomScope'));
      for (const clip of clips) {
        const previous = clip.zoom ?? defaultZoom;
        const scale = zoom === 'keep' ? (previous.scale > 1 ? previous.scale : 1.5) : zoom === 'in' ? Math.min(4, previous.scale * 1.5) : zoom === 'out' ? Math.max(1, previous.scale / 1.5) : zoom;
        const next = { ...previous, ...anchor, scale };
        run({ action: 'setZoom', clipId: clip.id, zoom: next });
        summaries.push(`clip ${edits.clips.findIndex(c => c.id === clip.id) + 1}: zoom ${round(scale)}× · ${zoomFocusLabel(next)}`);
      }
    }
    for (const kind of ['delete', 'merge'] as const) {
      const scope = pick<string | number>(kind);
      if (scope !== null) { run({ action: kind === 'delete' ? 'deleteClip' : 'mergeClips', clipId: target(scope)[0].id }); summaries.push(kind === 'delete' ? 'clip removed' : 'clips merged'); }
    }
    const order = pick<string>('reorder');
    if (order) {
      const ids = edits.clips.map(c => c.id), selected = target('selected')[0].id;
      run({ action: 'reorderClips', clipIds: order === 'reverse' ? ids.reverse() : order === 'first' ? [selected, ...ids.filter(id => id !== selected)] : [...ids.filter(id => id !== selected), selected] });
      summaries.push('clips reordered');
    }
    const output: Extract<Command, { action: 'setOutput' }> = { action: 'setOutput' };
    for (const key of ['muted', 'format', 'resolution', 'quality'] as const) {
      const value = pick<string | boolean>(key);
      if (value !== null) {
        Object.assign(output, { [key]: value });
        summaries.push(key === 'muted' ? (value ? 'audio muted' : 'audio restored') : key === 'resolution' ? (value === 'original' ? 'original resolution' : `${value}p`) : String(value));
      }
    }
    if (Object.keys(output).length > 1) run(output);
  } catch (error) {
    if (error instanceof EditError) throw error;
    throw new EditError(`That edit doesn’t fit the current timeline. ${error instanceof Error ? error.message : 'Try another value.'}`);
  }
  if (!commands.length || JSON.stringify(edits) === JSON.stringify(request.project.edits)) throw new EditError('The video already matches that edit, or no change was requested.');
  // Revalidate as one batch; callers commit all or nothing and create a single undo step.
  applyCommands(request.project.edits, commands, request.project.duration);
  return { batch: { requestId: request.requestId, sessionId: request.sessionId, revision: request.revision, commands }, summary: summaries.length > 6 ? summaries.slice(0, 5).join(' · ') + ` · and ${summaries.length - 5} more changes` : summaries.join(' · ') };
}
