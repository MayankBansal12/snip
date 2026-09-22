import { object } from '../src/engine/index';
import { EditError } from './planner';

export const controls = {
  split: 'Create a split/cut boundary, divide into clips, or cut in half, keeping the footage. Trimming/removing footage alone is NOT a split request.',
  trim: 'Shorten the video by removing seconds or keeping a time range. Splitting at a time WITHOUT removing footage, or deleting a numbered whole clip, is NOT trimming.',
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
    ...Object.entries(controls).map(([name, description]) => [name, {
      type: 'noul', instructions: `Does the user request this operation? ${description} Judge the user's words, not whether the current project needs it.`,
    }]),
    ['unsupported', { type: 'noul', instructions: 'Does any part of the request require a capability outside trim, split, speed, zoom/focus, deleting/merging/reordering clips, mute, output format/resolution/quality? Unsupported: understanding video or audio content, adding captions/music/transitions, filters, crop/aspect, reversing playback, downloading/exporting a file, multiple different speeds or multiple split times in one prompt. Ordinary compound edits are supported. A bare "trim 5 seconds" is supported (remove from start). Spatial "zoom in middle" means center. A zoom focus request without a scale is supported.' }],
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
  // A 0.5 answer is undecided, not an instruction to mutate that control.
  const requested = (Object.keys(controls) as Control[]).filter(name => probability(name) >= .75);
  if (!requested.length) throw new EditError('What would you like to change? Try “split at 4 seconds” or “zoom 2× to the top left”.');
  return requested;
}
