import { FFmpeg } from '@ffmpeg/ffmpeg';
import { clipCrop, clipSpeed, cropPixels, outputSize, placement, sequenceDuration } from './types';
import { ZOOM_TRANSITION_FPS, zoomTransitionFilter } from './zoom';
import { colorLut, renderAnnotations } from './effects';
import type { Source, Edits } from './types';
let current: FFmpeg | null = null;
export function cancelExport() { current?.terminate(); current = null; }
export async function exportVideo(source: Source, edits: Edits, progress: (fraction: number, stage: string) => void): Promise<Blob> {
  const ffmpeg = new FFmpeg(); current = ffmpeg;
  const duration = sequenceDuration(edits); let lastProgress=0, hasAudio=false, probing=true, frameRate=0;
  const logs:string[]=[];
  ffmpeg.on('log',({message})=>{if(probing && /Stream #0:.*Audio:/.test(message))hasAudio=true;if(probing&&!frameRate&&/Stream #0:.*Video:/.test(message)){const rate=message.match(/(\d+(?:\.\d+)?) fps/);if(rate)frameRate=Number(rate[1]);}logs.push(message);if(logs.length>35)logs.shift();});
  ffmpeg.on('progress',({time})=>{if(probing)return;lastProgress=Math.max(lastProgress,Math.min(.98,time/1_000_000/duration));progress(lastProgress,'Exporting your video');});
  try {
    progress(0,'Preparing the video engine');
    await ffmpeg.load({classWorkerURL:'/ffmpeg/worker.js',coreURL:'/ffmpeg/ffmpeg-core.js',wasmURL:'/ffmpeg/ffmpeg-core.wasm'});
    await ffmpeg.writeFile('input',new Uint8Array(await source.file.arrayBuffer()));
    await ffmpeg.exec(['-i','input']); // Read stream metadata; no output is intentionally requested.
    probing=false;hasAudio=hasAudio&&!edits.muted;
    let outputFrameRate=frameRate||30;
    const output=outputSize(source,edits),position=placement(source,edits,output);
    const args=['-i','input']; const graph:string[]=[]; const count=edits.clips.length;
    if(count>1){
      graph.push(`[0:v:0]split=${count}${edits.clips.map((_,i)=>`[vs${i}]`).join('')}`);
      if(hasAudio)graph.push(`[0:a:0]asplit=${count}${edits.clips.map((_,i)=>`[as${i}]`).join('')}`);
    }
    edits.clips.forEach((clip,i)=>{
      const crop=cropPixels(source,clipCrop(edits,clip)),speed=clipSpeed(clip,edits);
      const transitionRate=Math.max(ZOOM_TRANSITION_FPS,(frameRate||30)*speed);
      const transition=zoomTransitionFilter(source,edits,i,transitionRate);
      const picture=[`trim=start=${clip.start}:end=${clip.end}`,'setpts=PTS-STARTPTS'];
      picture.push('settb=AVTB', `setpts=PTS/${speed}`);
      if(transition){
        // Animate on the output clock: slow recordings and speed changes must
        // not reduce the number of camera positions rendered per second.
        picture.push(`fps=${transitionRate}:round=near`,'settb=AVTB',transition);
        outputFrameRate=Math.max(outputFrameRate,transitionRate);
      }
      picture.push(`crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`,`scale=${position.width}:${position.height}:flags=lanczos`);
      if(edits.canvas.fit==='fit')picture.push(`pad=${output.width}:${output.height}:${position.x}:${position.y}:color=${edits.canvas.background.replace('#','0x')}`);
      else picture.push(`crop=${output.width}:${output.height}:${Math.abs(position.x)}:${Math.abs(position.y)}`);
      picture.push('setsar=1');
      graph.push(`[${count>1?`vs${i}`:'0:v:0'}]${picture.join(',')}[v${i}]`);
      if(hasAudio){
        const tempo:string[]=[];let rate=speed;
        while(rate>2){tempo.push('atempo=2');rate/=2;}while(rate<.5){tempo.push('atempo=0.5');rate/=.5;}
        tempo.push(`atempo=${rate}`);
        // Pad short audio tails to the exact clip duration before concatenating.
        graph.push(`[${count>1?`as${i}`:'0:a:0'}]atrim=start=${clip.start}:end=${clip.end},asetpts=PTS-STARTPTS,${tempo.join(',')},apad,atrim=duration=${(clip.end-clip.start)/speed},asetpts=PTS-STARTPTS[a${i}]`);
      }
    });
    graph.push(`${edits.clips.map((_,i)=>`[v${i}]${hasAudio?`[a${i}]`:''}`).join('')}concat=n=${count}:v=1:a=${hasAudio?1:0}[joined]${hasAudio?'[audio]':''}`);
    const filters=['setsar=1'];
    const lut=colorLut(edits);if(lut){await ffmpeg.writeFile('grade.cube',lut);filters.push('lut3d=file=grade.cube:interp=tetrahedral');}
    graph.push(`[joined]${filters.join(',')}[picture]`);
    let videoLabel='picture';
    if(edits.annotations.length){
      progress(0,'Rendering your annotations');
      await ffmpeg.writeFile('annotations.png',await renderAnnotations(edits.annotations,output.width,output.height));
      args.push('-loop','1','-i','annotations.png');
      graph.push('[picture][1:v]overlay=0:0:format=auto:shortest=1[annotated]');videoLabel='annotated';
    }
    args.push('-filter_complex_threads','1','-filter_complex',graph.join(';'),'-map',`[${videoLabel}]`);
    if(hasAudio)args.push('-map','[audio]');else args.push('-an');
    // Preserve faster clips' sub-frame timestamps across speed changes. Using the
    // input frame rate as the encoder time base can delay cuts while dropping frames.
    // Declare the nominal rate separately: deriving it from the 90 kHz time
    // base can make x264 advertise level 6.2 after mixed zoom/speed filters.
    args.push('-r',String(outputFrameRate),'-fps_mode','vfr','-enc_time_base','1:90000');
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
