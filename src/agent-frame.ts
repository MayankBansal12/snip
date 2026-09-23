import type { Source } from './types';

/** Decode a source frame separately so inspection never seeks the user's preview. */
export async function captureSourceFrame(source: Source, sourceTime: number) {
  if (!Number.isFinite(sourceTime) || sourceTime < 0 || sourceTime >= source.duration)
    throw new Error('sourceTime must be within the source video, before its end.');
  const video = document.createElement('video');
  const url = URL.createObjectURL(source.file);
  video.muted = true; video.preload = 'auto';
  const wait = (event: string, start: () => void) => new Promise<void>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); video.removeEventListener(event, done); video.removeEventListener('error', fail); };
    const done = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error('Could not decode the requested video frame.')); };
    const timer = setTimeout(fail, 15000);
    video.addEventListener(event, done, { once: true }); video.addEventListener('error', fail, { once: true }); start();
  });
  try {
    await wait('loadeddata', () => { video.src = url; });
    if (sourceTime !== video.currentTime) await wait('seeked', () => { video.currentTime = sourceTime; });
    const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Frame capture is unavailable in this browser.');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return { data: canvas.toDataURL('image/jpeg', .9).split(',')[1], mimeType: 'image/jpeg', width: canvas.width, height: canvas.height, sourceTime, view: 'original source; edits and overlays are not applied' };
  } finally { video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); }
}
