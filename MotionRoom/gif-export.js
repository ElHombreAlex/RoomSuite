import {GIFEncoder,quantize,applyPalette} from '/api/render/gifenc.mjs';

// GIF stores delays in centiseconds and uses a maximum of 256 colors per frame.
// Bound pixel work and output memory because the encoder keeps the GIF in RAM.
export async function renderGif({canvas,project,prepared,fps=project.fps,holdFrames=project.holdFrames,signal,onProgress=()=>{}}){
  if(prepared.missing?.length)throw new Error('Relink missing shared images before exporting: '+prepared.missing.map(item=>item.sharedPath).join(', '));
  if(!Number.isInteger(fps)||fps<1||fps>60||!Number.isInteger(holdFrames)||holdFrames<1||holdFrames>60)throw new Error('Invalid GIF export settings.');
  const frames=Math.ceil(project.duration*fps-1e-9),pixels=project.width*project.height;
  if(pixels>4194304||pixels*frames>200000000)throw new Error('GIF export is limited to 4 megapixels per frame and 200 million total frame pixels; reduce dimensions, frame rate or duration.');
  const gif=GIFEncoder(),ctx=canvas.getContext('2d',{willReadFrequently:true});let elapsed=0;
  for(let index=0;index<frames;index++){
    if(signal?.aborted)throw new Error('Export cancelled.');
    const sample=Math.floor(index/holdFrames)*holdFrames/fps;
    MotionRenderer.draw(canvas,project,prepared,sample,{opaque:true});
    const rgba=ctx.getImageData(0,0,project.width,project.height).data,palette=quantize(rgba,256),indexed=applyPalette(rgba,palette);
    const end=Math.min(project.duration,(index+1)/fps),endCs=Math.round(end*100),delayCs=Math.max(1,endCs-elapsed);elapsed+=delayCs;
    gif.writeFrame(indexed,project.width,project.height,{palette,delay:delayCs*10,repeat:0});
    if(gif.bytesView().byteLength>64*1024*1024)throw new Error('GIF output exceeds 64 MiB; reduce dimensions, frame rate or duration.');
    onProgress(index+1,frames);await new Promise(resolve=>setTimeout(resolve,0));
  }
  if(signal?.aborted)throw new Error('Export cancelled.');gif.finish();
  return {blob:new Blob([gif.bytesView()],{type:'image/gif'}),frames,fps,holdFrames,transparent:false,format:'gif',encodedDuration:elapsed/100};
}
