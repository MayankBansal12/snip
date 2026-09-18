import type { Source } from './types';
export const filesize = (size: number) => `${(size / 1024 / 1024).toFixed(1)} MB`;
export function readMetadata(file: File): Promise<Source> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video'); const url = URL.createObjectURL(file); video.preload = 'metadata';
    const cleanup = () => { video.onloadedmetadata = null; video.onerror = null; clearTimeout(timeout); video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); };
    const timeout = setTimeout(() => { cleanup(); reject(new Error('This video could not be opened. Try MP4 or WebM.')); }, 15000);
    video.onloadedmetadata = () => {
      const source = { file, name: file.name, width: video.videoWidth, height: video.videoHeight, duration: video.duration }; cleanup();
      if (!Number.isFinite(source.duration) || source.duration <= 0 || !source.width) reject(new Error('This video has no readable duration. Try another file.'));
      else resolve(source);
    };
    video.onerror = () => { cleanup(); reject(new Error('Your browser cannot play this file. Try an MP4 (H.264) or WebM video.')); };
    video.src = url;
  });
}
export async function thumbnails(url: string, duration: number, onFrame: (frame: string, time: number) => void, signal: AbortSignal) {
  const video = document.createElement('video');video.muted=true;video.preload='auto';video.src=url;
  const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;const ctx=canvas.getContext('2d')!;
  const wait=(event:string)=>new Promise<void>((resolve,reject)=>{
    const done=()=>{cleanup();resolve();},abort=()=>{cleanup();reject(new Error('Thumbnail loading stopped'));};
    const timeout=setTimeout(abort,6000);
    const cleanup=()=>{clearTimeout(timeout);video.removeEventListener(event,done);video.removeEventListener('error',abort);signal.removeEventListener('abort',abort);};
    video.addEventListener(event,done,{once:true});video.addEventListener('error',abort,{once:true});signal.addEventListener('abort',abort,{once:true});
    if(signal.aborted)abort();
  });
  try {
    await wait('loadeddata');
    const count=Math.min(30,Math.max(10,Math.ceil(duration/2)));
    for(let i=0;i<count;i++){
      if(signal.aborted)break;
      const time=Math.min(duration-.02,(i+.01)/count*duration);
      const waiting=wait('seeked');video.currentTime=Math.max(.001,time);await waiting;
      ctx.drawImage(video,0,0,160,90);onFrame(canvas.toDataURL('image/jpeg',.65),time);
    }
  }catch{/* Thumbnails are optional; editing remains available. */}
  finally{video.removeAttribute('src');video.load();}
}
