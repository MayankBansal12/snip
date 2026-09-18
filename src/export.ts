import { FFmpeg } from '@ffmpeg/ffmpeg';
import { cropPixels, outputSize, placement, sequenceDuration } from './types';
import { colorLut, renderAnnotations } from './effects';
import type { Source, Edits } from './types';
let current: FFmpeg | null = null;
export function cancelExport() { current?.terminate(); current = null; }
export async function exportVideo(source: Source, edits: Edits, progress: (fraction: number, stage: string) => void): Promise<Blob> {
  const ffmpeg = new FFmpeg(); current = ffmpeg;
  const duration = sequenceDuration(edits); let lastProgress=0, hasAudio=false, probing=true;
  const logs:string[]=[];
  ffmpeg.on('log',({message})=>{if(probing && /Stream #0:.*Audio:/.test(message))hasAudio=true;logs.push(message);if(logs.length>35)logs.shift();});
  ffmpeg.on('progress',({time})=>{if(probing)return;lastProgress=Math.max(lastProgress,Math.min(.98,time/1_000_000/duration));progress(lastProgress,'Exporting your video');});
  try {
    progress(0,'Preparing the video engine');
    await ffmpeg.load({classWorkerURL:'/ffmpeg/worker.js',coreURL:'/ffmpeg/ffmpeg-core.js',wasmURL:'/ffmpeg/ffmpeg-core.wasm'});
    await ffmpeg.writeFile('input',new Uint8Array(await source.file.arrayBuffer()));
    await ffmpeg.exec(['-i','input']); // Read stream metadata; no output is intentionally requested.
    probing=false;hasAudio=hasAudio&&!edits.muted;
    const output=outputSize(source,edits),crop=cropPixels(source,edits.crop),position=placement(source,edits,output);
    const args=['-i','input']; const graph:string[]=[]; const count=edits.clips.length;
    if(count>1){
      graph.push(`[0:v:0]split=${count}${edits.clips.map((_,i)=>`[vs${i}]`).join('')}`);
      if(hasAudio)graph.push(`[0:a:0]asplit=${count}${edits.clips.map((_,i)=>`[as${i}]`).join('')}`);
    }
    edits.clips.forEach((clip,i)=>{
      graph.push(`[${count>1?`vs${i}`:'0:v:0'}]trim=start=${clip.start}:end=${clip.end},setpts=PTS-STARTPTS[v${i}]`);
      if(hasAudio)graph.push(`[${count>1?`as${i}`:'0:a:0'}]atrim=start=${clip.start}:end=${clip.end},asetpts=PTS-STARTPTS[a${i}]`);
    });
    graph.push(`${edits.clips.map((_,i)=>`[v${i}]${hasAudio?`[a${i}]`:''}`).join('')}concat=n=${count}:v=1:a=${hasAudio?1:0}[joined]${hasAudio?'[sound]':''}`);
    const filters=[`crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`,`scale=${position.width}:${position.height}:flags=lanczos`];
    const lut=colorLut(edits);if(lut){await ffmpeg.writeFile('grade.cube',lut);filters.push('lut3d=file=grade.cube:interp=tetrahedral');}
    if(edits.canvas.fit==='fit')filters.push(`pad=${output.width}:${output.height}:${position.x}:${position.y}:color=${edits.canvas.background.replace('#','0x')}`);
    else filters.push(`crop=${output.width}:${output.height}:${Math.abs(position.x)}:${Math.abs(position.y)}`);
    filters.push(`setpts=PTS/${edits.speed}`,'setsar=1');
    graph.push(`[joined]${filters.join(',')}[picture]`);
    let videoLabel='picture';
    if(edits.annotations.length){
      progress(0,'Rendering your annotations');
      await ffmpeg.writeFile('annotations.png',await renderAnnotations(edits.annotations,output.width,output.height));
      args.push('-loop','1','-i','annotations.png');
      graph.push('[picture][1:v]overlay=0:0:format=auto:shortest=1[annotated]');videoLabel='annotated';
    }
    if(hasAudio){
      const tempo:string[]=[];let speed=edits.speed;
      while(speed>2){tempo.push('atempo=2');speed/=2;}while(speed<.5){tempo.push('atempo=0.5');speed/=.5;}
      tempo.push(`atempo=${speed}`,'asetpts=PTS-STARTPTS');graph.push(`[sound]${tempo.join(',')}[audio]`);
    }
    args.push('-filter_complex_threads','1','-filter_complex',graph.join(';'),'-map',`[${videoLabel}]`);
    if(hasAudio)args.push('-map','[audio]');else args.push('-an');
    args.push('-fps_mode','vfr');
    if(edits.format==='mp4')args.push('-c:v','libx264','-preset','fast','-crf',edits.quality==='maximum'?'14':'23','-pix_fmt','yuv420p','-c:a','aac','-b:a','256k','-movflags','+faststart');
    else args.push('-c:v','libvpx','-crf',edits.quality==='maximum'?'4':'12','-b:v',String(Math.round(output.width*output.height*(edits.quality==='maximum'?.24:.1)*30)),'-deadline','good','-cpu-used','4','-lag-in-frames','0','-auto-alt-ref','0','-pix_fmt','yuv420p','-c:a','libopus','-b:a','192k');
    args.push('-t',String(duration),'-threads','1',`output.${edits.format}`);
    progress(0,'Exporting your video');
    if(await ffmpeg.exec(args)!==0)throw new Error('This video could not be exported. Try a smaller resolution or MP4.');
    const data=await ffmpeg.readFile(`output.${edits.format}`);
    if(typeof data==='string'||data.byteLength<100)throw new Error('The export was empty. Please try again.');
    progress(1,'Your video is ready');return new Blob([new Uint8Array(data)],{type:`video/${edits.format}`});
  }catch(error){console.error('Video encoder error:',String(error),logs.join('\n'));throw error instanceof Error?error:new Error('This export could not be completed. Try MP4 or a smaller resolution.');}
  finally{ffmpeg.terminate();if(current===ffmpeg)current=null;}
}
