import {Output,WebMOutputFormat,Mp4OutputFormat,BufferTarget,CanvasSource,Quality,canEncodeVideo} from '/api/render/mediabunny.mjs';

// Render at explicit timestamps, independently of wall-clock playback. A hold
// repeats the same sampled pose for the requested number of encoded frames.
export async function renderMotion({canvas,project,prepared,format='webm',transparent=false,fps=project.fps,holdFrames=project.holdFrames,signal,onProgress=()=>{}}){
  if(prepared.missing?.length)throw new Error('Relink missing shared images before exporting: '+prepared.missing.map(item=>item.sharedPath).join(', '));
  if(!['webm','mp4'].includes(format)||!Number.isInteger(fps)||fps<1||fps>60||!Number.isInteger(holdFrames)||holdFrames<1||holdFrames>60)throw new Error('Invalid export settings.');
  if(transparent&&format!=='webm')throw new Error('Transparent video requires WebM/VP9. MP4 export is opaque.');
  const codec=transparent?'vp9':format==='mp4'?'avc':'vp8',quality=new Quality({bitrate:project.width*project.height>=1920*1080?8000000:4500000}),alpha=transparent?'keep':'discard';
  if(!await canEncodeVideo(codec,{width:project.width,height:project.height,frameRate:fps,quality,alpha}))throw new Error(`This browser cannot encode ${transparent?'transparent VP9':format==='mp4'?'MP4/H.264':'WebM/VP8'} at this size. Try another browser or format.`);
  const output=new Output({format:format==='mp4'?new Mp4OutputFormat():new WebMOutputFormat(),target:new BufferTarget()}),source=new CanvasSource(canvas,{codec,quality,alpha,latencyMode:'quality'});
  output.addVideoTrack(source,{canBeTransparent:transparent});let complete=false;
  try{
    if(signal?.aborted)throw new Error('Export cancelled.');await output.start();
    const frames=Math.ceil(project.duration*fps-1e-9);
    for(let index=0;index<frames;index++){
      if(signal?.aborted)throw new Error('Export cancelled.');
      const timestamp=index/fps,sample=Math.floor(index/holdFrames)*holdFrames/fps;
      MotionRenderer.draw(canvas,project,prepared,sample,{transparent,opaque:!transparent});
      await source.add(timestamp,Math.min(1/fps,project.duration-timestamp));onProgress(index+1,frames);
    }
    source.close();if(signal?.aborted)throw new Error('Export cancelled.');await output.finalize();complete=true;
    if(!output.target.buffer?.byteLength)throw new Error('The encoder produced an empty video.');
    return {blob:new Blob([output.target.buffer],{type:format==='mp4'?'video/mp4':'video/webm'}),frames,fps,holdFrames,transparent,format};
  }finally{if(!complete&&output.state!=='canceled')await output.cancel().catch(()=>{});}
}
