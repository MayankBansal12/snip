import { clipSpeed, sequenceDuration, toSequenceTime } from './types';
import type { Edits } from './types';

type Options = {
  edits: { current: Edits }; activeClip: { current: number };
  onTime: (time: number) => void; onClip: (id: string) => void;
  onPlaying: (playing: boolean) => void; onError: (message: string) => void;
};

/** Keep sequence playback alive across source seeks and native end-of-media events. */
export function createPlayback(video: HTMLVideoElement, options: Options) {
  let playing = false, disposed = false, recoveringEnd = false;
  let frame: number | undefined, playRequest: Promise<void> | undefined;
  const running = (value: boolean) => {
    if (playing !== value) { playing = value; options.onPlaying(value); }
    if (!value && frame !== undefined) { cancelAnimationFrame(frame); frame = undefined; }
  };
  const pause = () => { recoveringEnd = false; running(false); video.pause(); };
  const requestPlay = () => {
    if (!playing || disposed || !video.paused || playRequest) return;
    playRequest = video.play().catch(error => {
      if (!playing || disposed || (error instanceof DOMException && error.name === 'AbortError')) return;
      pause(); options.onError('Playback could not start. Try opening the video again.');
    }).finally(() => { playRequest = undefined; });
  };
  const sync = () => {
    // A seek is asynchronous. Do not skip another clip or start a second seek
    // until the decoder has reached the requested frame.
    if (!playing || disposed || video.seeking || video.readyState < 2) return;
    const edits = options.edits.current, index = options.activeClip.current;
    const clip = edits.clips[index];
    if (!clip) { pause(); return; }
    if (video.currentTime >= clip.end || video.ended) {
      const next = edits.clips[index + 1];
      if (!next) {
        pause();
        if (Math.abs(video.currentTime - clip.end) > .001) video.currentTime = clip.end;
        options.onTime(sequenceDuration(edits)); return;
      }
      options.activeClip.current = index + 1; options.onClip(next.id);
      video.playbackRate = clipSpeed(next, edits);
      // Adjacent clips share the same decoded stream; seeking back to their
      // boundary unnecessarily flushes it, especially with fast, short clips.
      const contiguous = Math.abs(clip.end - next.start) < 1e-7;
      if (!contiguous || video.ended || video.currentTime < next.start || video.currentTime >= next.end) {
        recoveringEnd = video.paused;
        video.currentTime = next.start;
        options.onTime(toSequenceTime(next.start, edits, index + 1));
        return;
      }
    }
    const current = edits.clips[options.activeClip.current];
    if (video.currentTime < current.start - .001) { video.currentTime = current.start; return; }
    options.onTime(toSequenceTime(video.currentTime, edits, options.activeClip.current));
    requestPlay();
  };
  const schedule = () => {
    if (!playing || disposed || frame !== undefined) return;
    frame = requestAnimationFrame(() => { frame = undefined; sync(); schedule(); });
  };
  const onPlay = () => {
    if (video.paused) return; // Ignore an old play event after a user pause.
    running(true); sync(); schedule();
  };
  const onPause = () => {
    if (!video.paused) return; // A queued pause can arrive after a boundary resume.
    if (playing && (video.ended || recoveringEnd)) { sync(); schedule(); }
    else running(false);
  };
  const onProgress = () => { sync(); schedule(); };
  const onEnded = () => { if (video.ended) onProgress(); };
  const onReady = () => {
    if (!playing || video.seeking) return;
    sync(); requestPlay(); recoveringEnd = false; schedule();
  };
  const events = { play: onPlay, pause: onPause, timeupdate: onProgress, ended: onEnded, seeked: onReady, canplay: onReady };
  for (const [name, listener] of Object.entries(events)) video.addEventListener(name, listener);
  return {
    pause,
    toggle() {
      if (playing) { pause(); return; }
      const edits = options.edits.current;
      let index = edits.clips.findIndex(c => video.currentTime >= c.start && video.currentTime < c.end);
      if (index < 0) index = edits.clips.findIndex(c => c.start > video.currentTime);
      if (index < 0 || video.ended) index = 0;
      const clip = edits.clips[index];
      options.activeClip.current = index; options.onClip(clip.id);
      video.playbackRate = clipSpeed(clip, edits);
      if (video.ended || video.currentTime < clip.start || video.currentTime >= clip.end) video.currentTime = clip.start;
      running(true); requestPlay(); schedule();
    },
    dispose() {
      disposed = true; recoveringEnd = false; running(false);
      for (const [name, listener] of Object.entries(events)) video.removeEventListener(name, listener);
      video.pause();
    },
  };
}
