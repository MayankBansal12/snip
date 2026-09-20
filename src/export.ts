import { compileTimeline } from './engine';
import { FFmpeg, FFFSType } from '@ffmpeg/ffmpeg';
import { clipCrop, clipSpeed, cropPixels, outputSize, placement } from './types';
import { ZOOM_TRANSITION_FPS, zoomTransitionFilter } from './zoom';
import { colorLut, renderAnnotations } from './effects';
import type { Source, Edits } from './types';
let current: FFmpeg | null = null;
let nativeController: AbortController | null = null;
export function cancelExport() { nativeController?.abort(); nativeController=null; current?.terminate(); current = null; }
// Only a whole, unchanged picture can bypass rendering. Trims still use the
// accurate render path, so cuts never snap to a nearby keyframe.
export function canCopyPicture(source: Source, edits: Edits): boolean {
  const clip = edits.clips[0];
  return edits.format === 'mp4' && edits.quality === 'maximum'
    && edits.clips.length === 1 && clip.start === 0 && clip.end === source.duration
    && clipSpeed(clip, edits) === 1 && (!clip.zoom || clip.zoom.scale === 1)
    && edits.crop.x === 0 && edits.crop.y === 0 && edits.crop.width === 1 && edits.crop.height === 1
    && edits.canvas.ratio === null && edits.canvas.inset === 0 && edits.resolution === 'original'
    && edits.filter === 'Original' && edits.brightness === 0 && edits.contrast === 0
    && edits.annotations.length === 0;
}

async function loadEngine(source: Source, deterministic: boolean): Promise<{ ffmpeg: FFmpeg; threads: number }> {
  // Large frames already consume substantial memory per decoder/encoder thread.
  const threads = !deterministic && globalThis.crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined'
    ? Math.max(1, Math.min(navigator.hardwareConcurrency || 2, source.width * source.height > 4_000_000 ? 2 : 4)) : 1;
  let ffmpeg = new FFmpeg(); current = ffmpeg;
  if (threads > 1) {
    try {
      await ffmpeg.load({ classWorkerURL: '/ffmpeg/worker.js', coreURL: '/ffmpeg/mt/ffmpeg-core.js', wasmURL: '/ffmpeg/mt/ffmpeg-core.wasm', workerURL: '/ffmpeg/mt/ffmpeg-core.worker.js' });
      return { ffmpeg, threads };
    } catch (error) {
      ffmpeg.terminate();
      if (current !== ffmpeg) throw error; // Cancellation must not start another engine.
      ffmpeg = new FFmpeg(); current = ffmpeg;
    }
  }
  try {
    await ffmpeg.load({ classWorkerURL: '/ffmpeg/worker.js', coreURL: '/ffmpeg/ffmpeg-core.js', wasmURL: '/ffmpeg/ffmpeg-core.wasm' });
    return { ffmpeg, threads: 1 };
  } catch (error) {
    ffmpeg.terminate(); if (current === ffmpeg) current = null;
    throw error;
  }
}

export async function exportVideo(source: Source, edits: Edits, progress: (fraction: number, stage: string) => void, deterministic = true): Promise<Blob> {
  const plan = compileTimeline(source, edits);
  edits = plan.edits;
  progress(0,'Preparing the video engine');
  const { ffmpeg, threads } = await loadEngine(source, deterministic);
  const duration = plan.duration; let lastProgress=0, hasAudio=false, probing=true, frameRate=0;
  const logs:string[]=[]; const videoStreams:string[]=[], audioStreams:string[]=[];
  ffmpeg.on('log',({message})=>{if(probing && /Stream #0:.*Video:/.test(message))videoStreams.push(message);if(probing && /Stream #0:.*Audio:/.test(message))audioStreams.push(message);if(probing && /Stream #0:.*Audio:/.test(message))hasAudio=true;if(probing&&!frameRate&&/Stream #0:.*Video:/.test(message)){const rate=message.match(/(\d+(?:\.\d+)?) fps/);if(rate)frameRate=Number(rate[1]);}logs.push(message);if(logs.length>35)logs.shift();});
  ffmpeg.on('progress',({time})=>{if(probing||nativeController)return;lastProgress=Math.max(lastProgress,Math.min(.98,time/1_000_000/duration));progress(lastProgress,'Exporting your video');});
  try {
    // WORKERFS reads the Blob on demand instead of duplicating the whole input in WASM memory.
    await ffmpeg.createDir('/source');
    await ffmpeg.mount(FFFSType.WORKERFS,{blobs:[{name:'input',data:source.file}]},'/source');
    const input='/source/input';
    await ffmpeg.exec(['-i',input]); // Read stream metadata; no output is intentionally requested.
    probing=false;hasAudio=hasAudio&&!edits.muted;
    const compatibleVideo=videoStreams.length===1 && /Video: h264\b/.test(videoStreams[0]) && /\byuv420p\b/.test(videoStreams[0]);
    const compatibleAudio=audioStreams.length<=1 && audioStreams.every(line=>/Audio: aac\b/.test(line));
    const header=new Uint8Array(await source.file.slice(0,12).arrayBuffer());
    const mp4=new TextDecoder().decode(header.slice(4,8))==='ftyp' && new TextDecoder().decode(header.slice(8,12))!=='qt  ';
    if(!deterministic && canCopyPicture(source,edits) && compatibleVideo && compatibleAudio && mp4){
      if(!edits.muted || audioStreams.length===0){
        progress(1,'Your video is ready');
        return source.file.slice(0,source.file.size,'video/mp4');
      }
      progress(0,'Preparing your video without sound');
      if(await ffmpeg.exec(['-i',input,'-map','0:v:0','-c:v','copy','-an','-movflags','+faststart','output.mp4'])!==0)
        throw new Error('This video could not be exported without sound.');
      const data=await ffmpeg.readFile('output.mp4');
      if(typeof data==='string'||data.byteLength<100)throw new Error('The export was empty. Please try again.');
      progress(1,'Your video is ready');
      return new Blob([new Uint8Array(data)],{type:'video/mp4'});
    }
    if(!deterministic && edits.format==='mp4' && edits.filter==='Original' && !edits.brightness && !edits.contrast
      && !videoStreams.some(line=>/bt2020|smpte2084|arib-std-b67/.test(line))){
      const controller=new AbortController();nativeController=controller;
      try{
        const {nativeExport}=await import('./native-export');
        const result=await nativeExport(source,edits,progress,async()=>{
          if(!hasAudio)return null;
          const graph:string[]=[];
          if(edits.clips.length>1)graph.push(`[0:a:0]asplit=${edits.clips.length}${edits.clips.map((_,i)=>`[a${i}]`).join('')}`);
          edits.clips.forEach((clip,i)=>{
            const tempo:string[]=[];let speed=clipSpeed(clip,edits);
            while(speed>2){tempo.push('atempo=2');speed/=2;}while(speed<.5){tempo.push('atempo=0.5');speed/=.5;}
            tempo.push(`atempo=${speed}`);
            graph.push(`[${edits.clips.length>1?`a${i}`:'0:a:0'}]atrim=start=${clip.start}:end=${clip.end},asetpts=PTS-STARTPTS,${tempo.join(',')},apad,atrim=duration=${(clip.end-clip.start)/clipSpeed(clip,edits)},asetpts=PTS-STARTPTS[out${i}]`);
          });
          graph.push(`${edits.clips.map((_,i)=>`[out${i}]`).join('')}concat=n=${edits.clips.length}:v=0:a=1[audio]`);
          if(await ffmpeg.exec(['-i',input,'-filter_complex_threads','1','-filter_complex',graph.join(';'),'-map','[audio]','-vn','-c:a','aac','-b:a','256k','-t',String(duration),'audio.m4a'])!==0)throw new Error('Could not prepare audio');
          const bytes=await ffmpeg.readFile('audio.m4a');await ffmpeg.deleteFile('audio.m4a');
          if(typeof bytes==='string')throw new Error('Invalid audio output');
          return new Blob([new Uint8Array(bytes)],{type:'audio/mp4'});
        },controller.signal);
        if(result)return result;
      }catch(error){
        if(controller.signal.aborted || current!==ffmpeg)throw error;
        console.warn('Native export unavailable; using compatible encoder:',String(error));
      }finally{if(nativeController===controller)nativeController=null;}
      progress(0,'Preparing compatible video export');lastProgress=0;
    }
    let outputFrameRate=frameRate||30;
    const output=outputSize(source,edits),position=placement(source,edits,output);
    const count=edits.clips.length;
    // A single trimmed clip can seek directly to its start. FFmpeg's default
    // accurate seek decodes the preceding keyframe without exporting preroll.
    const seek=count===1 ? edits.clips[0].start : 0;
    const args=[...(seek>0 ? ['-ss',String(seek)] : []),'-threads',String(threads),'-i',input]; const graph:string[]=[];
    if(count>1){
      graph.push(`[0:v:0]split=${count}${edits.clips.map((_,i)=>`[vs${i}]`).join('')}`);
      if(hasAudio)graph.push(`[0:a:0]asplit=${count}${edits.clips.map((_,i)=>`[as${i}]`).join('')}`);
    }
    edits.clips.forEach((clip,i)=>{
      const crop=cropPixels(source,clipCrop(edits,clip)),speed=clipSpeed(clip,edits);
      const transitionRate=Math.max(ZOOM_TRANSITION_FPS,(frameRate||30)*speed);
      const transition=zoomTransitionFilter(source,edits,i,transitionRate);
      const picture=[`trim=start=${clip.start-seek}:end=${clip.end-seek}`,'setpts=PTS-STARTPTS'];
      picture.push('settb=AVTB', `setpts=PTS/${speed}`);
      if(transition){
        // Animate on the output clock: slow recordings and speed changes must
        // not reduce the number of camera positions rendered per second.
        picture.push(`fps=${transitionRate}:round=near`,'settb=AVTB',transition);
        outputFrameRate=Math.max(outputFrameRate,transitionRate);
      }
      if(crop.width!==source.width || crop.height!==source.height || crop.x || crop.y)picture.push(`crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`);
      if(crop.width!==position.width || crop.height!==position.height)picture.push(`scale=${position.width}:${position.height}:flags=lanczos`);
      if(edits.canvas.fit==='fit' && (position.width!==output.width || position.height!==output.height || position.x || position.y))picture.push(`pad=${output.width}:${output.height}:${position.x}:${position.y}:color=${edits.canvas.background.replace('#','0x')}`);
      else if(edits.canvas.fit==='fill' && (position.width!==output.width || position.height!==output.height || position.x || position.y))picture.push(`crop=${output.width}:${output.height}:${Math.abs(position.x)}:${Math.abs(position.y)}`);
      picture.push('setsar=1');
      graph.push(`[${count>1?`vs${i}`:'0:v:0'}]${picture.join(',')}[v${i}]`);
      if(hasAudio){
        const tempo:string[]=[];let rate=speed;
        while(rate>2){tempo.push('atempo=2');rate/=2;}while(rate<.5){tempo.push('atempo=0.5');rate/=.5;}
        tempo.push(`atempo=${rate}`);
        // Pad short audio tails to the exact clip duration before concatenating.
        graph.push(`[${count>1?`as${i}`:'0:a:0'}]atrim=start=${clip.start-seek}:end=${clip.end-seek},asetpts=PTS-STARTPTS,${tempo.join(',')},apad,atrim=duration=${(clip.end-clip.start)/speed},asetpts=PTS-STARTPTS[a${i}]`);
      }
    });
    graph.push(`${edits.clips.map((_,i)=>`[v${i}]${hasAudio?`[a${i}]`:''}`).join('')}concat=n=${count}:v=1:a=${hasAudio?1:0}[joined]${hasAudio?'[audio]':''}`);
    const filters=['setsar=1'];
    const lut=colorLut(edits);if(lut){await ffmpeg.writeFile('grade.cube',lut);filters.push('lut3d=file=grade.cube:interp=tetrahedral');}
    graph.push(`[joined]${filters.join(',')}[picture]`);
    let videoLabel='picture';
    if(edits.annotations.length){
      await document.fonts.ready;
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
    if(edits.format==='mp4')args.push('-c:v','libx264','-preset','veryfast','-crf',edits.quality==='maximum'?'14':'23','-pix_fmt','yuv420p','-c:a','aac','-b:a','256k','-movflags','+faststart');
    else args.push('-c:v','libvpx','-crf',edits.quality==='maximum'?'4':'12','-b:v',String(Math.round(output.width*output.height*(edits.quality==='maximum'?.24:.1)*30)),'-deadline','good','-cpu-used','4','-lag-in-frames','0','-auto-alt-ref','0','-pix_fmt','yuv420p','-c:a','libopus','-b:a','192k');
    args.push('-map_metadata','-1','-t',String(duration),'-threads',String(threads),`output.${edits.format}`);
    progress(0,'Exporting your video');
    if(await ffmpeg.exec(args)!==0)throw new Error('This video could not be exported. Try a smaller resolution or MP4.');
    const data=await ffmpeg.readFile(`output.${edits.format}`);
    if(typeof data==='string'||data.byteLength<100)throw new Error('The export was empty. Please try again.');
    progress(1,'Your video is ready');return new Blob([new Uint8Array(data)],{type:`video/${edits.format}`});
  }catch(error){console.error('Video encoder error:',String(error),logs.join('\n'));throw error instanceof Error?error:new Error('This export could not be completed. Try MP4 or a smaller resolution.');}
  finally{ffmpeg.terminate();if(current===ffmpeg)current=null;}
}
