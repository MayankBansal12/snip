import { object } from '../src/engine/index';
import { EditError } from './planner';

export const controls = {
  split: 'Create a split/cut boundary, divide into clips, or cut in half, keeping the footage. Times may be absolute or relative to the current playhead. Cut/split at a point, N seconds after/before/later, or here means a boundary, preserving footage on both sides. Trimming/removing footage alone is NOT a split request.',
  trim: 'Explicitly shorten the video by removing seconds or keeping a time range. A cut/split AT a point, AFTER/BEFORE the playhead, or N seconds LATER makes a boundary and preserves both sides: it is NOT trimming. Do not infer removal from the verb cut alone. Deleting a numbered whole clip is also separate.',
  speed: 'Change playback speed: faster, slower, slow motion, or a playback rate. A zoom multiplier is NOT speed.',
  zoom: 'Change zoom magnification OR its spatial focus/position (center, top left, right, etc.), including repositioning an existing zoom without giving a new scale.',
  delete: 'Delete one entire clip identified by number or selection. Removing a time range is trimming, NOT whole-clip deletion.',
  merge: 'Join/merge adjacent clips.',
  reorder: 'Move clips or reverse the order of clips. This does not mean playing the footage backwards.',
  muted: 'Mute, unmute, remove or restore the original audio.',
  format: 'Set the output file format to MP4 or WebM.',
  resolution: 'Set the output pixel resolution, such as 720p, 1080p, or 4K.',
  quality: 'Change encoding quality or file size, such as maximum quality or a smaller file. Pixel resolution (720p/1080p/4K) and format (MP4/WebM) alone do NOT request this.',
} as const;
export type Control = keyof typeof controls;

// Route first, then ask only for the values of requested controls. An unrelated
// speculative answer must never veto a valid edit or create an extra mutation.
export function intentQuestions() {
  return Object.fromEntries([
    ...Object.entries(controls).filter(([name]) => name !== 'split' && name !== 'trim').map(([name, description]) => [name, {
      type: 'noul', instructions: `Does the user request this operation? ${description} Judge the user's words, not whether the current project needs it.`,
    }]),
    ['timing', {
      type: 'choice',
      instructions: 'Which timing operation does the user request? A split creates a boundary and keeps both sides. A trim removes footage. A relative time (3 seconds after/before/later/from here) is a valid split point. Judge the requested operation, not the necessary implementation steps.',
      criteria: {
        split: 'Split/cut at a point, split in half, split here, or split a time offset from the playhead. Keep both sides; no removal requested.',
        trim: 'Trim/remove footage or keep only a time range. No separate split boundary is requested.',
        both: 'Two explicit edits: add a split boundary AND trim/remove footage.',
        none: 'Neither splitting nor trimming. Whole-clip deletion, speed, zoom and output settings are other controls.',
      },
    }],
    ['unsupported', { type: 'noul', instructions: 'Does any part of the request require a capability outside trim, split, speed, zoom/focus, deleting/merging/reordering clips, mute, output format/resolution/quality? Unsupported: understanding video or audio content, adding captions/music/transitions, filters, crop/aspect, reversing playback, downloading/exporting a file, multiple different speeds or multiple split times in one prompt. Ordinary compound edits are supported. Relative split timing is supported: "split 3 seconds after" defaults to 3 seconds after the current playhead. A bare "trim 5 seconds" is supported (remove from start). Spatial "zoom in middle" means center. A zoom focus request without a scale is supported.' }],
  ]);
}

export function readIntent(raw: unknown): Control[] {
  const answers = object(object(raw).answers);
  const probability = (name: string) => {
    const answer = object(answers[name]);
    if (answer.type !== 'noul' || typeof answer.noul !== 'number' || !Number.isFinite(answer.noul) || answer.noul < 0 || answer.noul > 1) throw new EditError('Jev returned an unreadable request. Please try again.', 502);
    return answer.noul;
  };
  if (probability('unsupported') >= .5) throw new EditError('I can change timing, speed, zoom, audio and output settings. Describe those edits with times or clip numbers; I can’t inspect the video’s content.');
  // Decide split vs trim jointly: independent yes/no scores can accidentally
  // request both when the user only asked to insert a boundary.
  const timing = object(answers.timing);
  if (timing.type !== 'choice' || !['split', 'trim', 'both', 'none'].includes(String(timing.choice)) || typeof timing.confidence !== 'number' || !Number.isFinite(timing.confidence) || timing.confidence < 0 || timing.confidence > 1) throw new EditError('Jev returned an unreadable request. Please try again.', 502);
  if (timing.confidence < .3) throw new EditError('Should I split the video or remove a section? Try “split 3 seconds after” or “remove the first 3 seconds”.');
  // A 0.5 answer is undecided, not an instruction to mutate that control.
  const requested = (Object.keys(controls) as Control[]).filter(name => name === 'split' || name === 'trim' ? timing.choice === name || timing.choice === 'both' : probability(name) >= .75);
  if (!requested.length) throw new EditError('What would you like to change? Try “split at 4 seconds” or “zoom 2× to the top left”.');
  return requested;
}
