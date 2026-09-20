import { BlobSource, BufferTarget, CanvasSource, EncodedAudioPacketSource, EncodedPacketSink, Input, MP4, Output, Mp4OutputFormat, Quality, VideoSampleSink, VideoSampleSource, canEncodeVideo } from 'mediabunny';
import { clipDuration, clipSpeed, outputSize, placement, sequenceDuration } from './types';
import { zoomTransition, zoomViewport, ZOOM_TRANSITION_FPS } from './zoom';
import { drawAnnotation } from './effects';
import type { Source, Edits } from './types';

// Color grading stays on the established FFmpeg path. Native canvas rendering
// handles the same crop, canvas, zoom and annotation geometry as the preview.
export async function nativeExport(source: Source, edits: Edits, progress: (fraction: number, stage: string) => void,
  renderAudio: () => Promise<Blob | null>, signal: AbortSignal): Promise<Blob | null> {
  if(edits.format!=='mp4' || edits.filter!=='Original' || edits.brightness || edits.contrast
    || typeof VideoEncoder==='undefined' || typeof VideoDecoder==='undefined' || typeof OffscreenCanvas==='undefined')return null;
  const input=new Input({source:new BlobSource(source.file),formats:[MP4]});
  let audioInput:Input|undefined;
  let output:Output<Mp4OutputFormat,BufferTarget>|undefined;
  const abort=()=>{input.dispose();audioInput?.dispose();void output?.cancel().catch(()=>{});};
  signal.addEventListener('abort',abort,{once:true});
  try {
    signal.throwIfAborted();
    const track=await input.getPrimaryVideoTrack();
    if(!track || await track.getCodec()!=='avc' || !await track.canDecode() || Math.abs(await track.getFirstTimestamp())>.0001)return null;
    const size=outputSize(source,edits),pos=placement(source,edits,size);
    const stats=await track.computePacketStats(100);
    const fps=Math.max(1,stats.averagePacketRate || 30);
    const maxRate=Math.max(fps,...edits.clips.map((clip,i)=>zoomTransition(source,edits,i).duration ? Math.max(ZOOM_TRANSITION_FPS,fps*clipSpeed(clip,edits)) : fps*clipSpeed(clip,edits)));
    const bitrate=Math.round(Math.max(500_000,size.width*size.height*fps*(edits.quality==='maximum'?.24:.09)));
    const quality=new Quality({quantizer:edits.quality==='maximum'?18:28,bitrate});
    if(!await canEncodeVideo('avc',{width:size.width,height:size.height,frameRate:maxRate,quality,latencyMode:'quality'}))return null;
    const timestamps:number[]=[];
    for await(const packet of new EncodedPacketSink(track).packets(undefined,undefined,{metadataOnly:true})){
      signal.throwIfAborted(); timestamps.push(packet.timestamp);
    }
    timestamps.sort((a,b)=>a-b);
    const plans=edits.clips.map((clip,i)=>{
      const sourceTimes=timestamps.filter(t=>t>=clip.start-1e-7 && t<clip.end-1e-7);
      if(!sourceTimes.length)throw new Error('No frames in selected clip');
      const speed=clipSpeed(clip,edits),duration=clipDuration(clip,edits),origin=sourceTimes[0];
      const motion=zoomTransition(source,edits,i).duration,rate=Math.max(ZOOM_TRANSITION_FPS,fps*speed);
      const times=sourceTimes.map(t=>(t-origin)/speed).filter(t=>!motion || t>motion);
      // Extra frames are needed only while the camera moves. Preserve original
      // source cadence after that, including sparse and variable-rate recordings.
      if(motion)for(let n=0;n/rate<=motion+1e-8;n++)times.push(n/rate);
      times.sort((a,b)=>a-b);
      const frames=times.filter((t,j)=>t<duration-1e-7 && (!j || t-times[j-1]>1e-7));
      return {clip,duration,frames,sourceTimes:frames.map(t=>Math.min(clip.end-1e-7,origin+t*speed+1e-7))};
    });
    signal.throwIfAborted();
    progress(0,'Preparing your audio');
    const audio=await renderAudio();
    signal.throwIfAborted();
    const canvas=new OffscreenCanvas(size.width,size.height),ctx=canvas.getContext('2d',{alpha:false});
    if(!ctx)throw new Error('Canvas rendering unavailable');
    ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
    const overlay=new OffscreenCanvas(size.width,size.height),overlayContext=overlay.getContext('2d');
    if(!overlayContext)throw new Error('Annotation rendering unavailable');
    for(const annotation of edits.annotations)drawAnnotation(overlayContext as unknown as CanvasRenderingContext2D,annotation,size.width,size.height);
    const target=new BufferTarget();output=new Output({format:new Mp4OutputFormat({fastStart:'in-memory'}),target});
    const direct=size.width===source.width && size.height===source.height && pos.x===0 && pos.y===0
      && pos.width===size.width && pos.height===size.height && edits.crop.x===0 && edits.crop.y===0
      && !edits.annotations.length && edits.clips.every(clip=>!clip.zoom || clip.zoom.scale===1)
      && await track.getRotation()===0 && !await track.getFlip();
    const encoding={codec:'avc' as const,quality,latencyMode:'quality' as const,hardwareAcceleration:'no-preference' as const};
    // Pure trims/speed changes can keep decoded YUV pixels, avoiding a needless
    // YUV → RGB → YUV round trip and its small color/rounding differences.
    const video=direct ? new VideoSampleSource(encoding) : new CanvasSource(canvas,encoding);
    output.addVideoTrack(video);
    let audioSource:EncodedAudioPacketSource|undefined;
    let audioTrack;
    if(audio){
      audioInput=new Input({source:new BlobSource(audio),formats:[MP4]});
      audioTrack=await audioInput.getPrimaryAudioTrack();
      if(!audioTrack || await audioTrack.getCodec()!=='aac')throw new Error('Invalid rendered audio');
      audioSource=new EncodedAudioPacketSource('aac');output.addAudioTrack(audioSource);
    }
    await output.start();
    if(audioTrack && audioSource){
      const decoderConfig=await audioTrack.getDecoderConfig();
      if(!decoderConfig)throw new Error('Missing audio configuration');
      for await(const packet of new EncodedPacketSink(audioTrack).packets()){
        signal.throwIfAborted();await audioSource.add(packet,{decoderConfig});
      }
      audioSource.close();
    }
    const sink=new VideoSampleSink(track),duration=sequenceDuration(edits);
    let offset=0;
    for(let i=0;i<plans.length;i++){
      const plan=plans[i];let frameIndex=0;
      for await(const sample of sink.samplesAtTimestamps(plan.sourceTimes)){
        if(!sample)throw new Error('Could not decode a selected frame');
        try{
          signal.throwIfAborted();
          const elapsed=plan.frames[frameIndex],end=plan.frames[frameIndex+1]??plan.duration;
          if(video instanceof VideoSampleSource){
            sample.setTimestamp(offset+elapsed);sample.setDuration(end-elapsed);
            await video.add(sample,{keyFrame:frameIndex===0});
          }else{
            const view=zoomViewport(source,edits,i,elapsed);
            ctx.fillStyle=edits.canvas.background;ctx.fillRect(0,0,size.width,size.height);
            sample.draw(ctx,view.x,view.y,view.width,view.height,pos.x,pos.y,pos.width,pos.height);
            if(edits.annotations.length)ctx.drawImage(overlay,0,0);
            await video.add(offset+elapsed,end-elapsed,{keyFrame:frameIndex===0});
          }
          progress(Math.min(.98,(offset+end)/duration),'Exporting your video');
          frameIndex++;
        }finally{sample.close();}
      }
      offset+=plan.duration;
    }
    video.close();await output.finalize();signal.throwIfAborted();
    if(!target.buffer)throw new Error('The export was empty');
    progress(1,'Your video is ready');return new Blob([target.buffer],{type:'video/mp4'});
  } finally {
    signal.removeEventListener('abort',abort);
    if(output && output.state!=='finalized' && output.state!=='canceled')await output.cancel();
    input.dispose();audioInput?.dispose();
  }
}
