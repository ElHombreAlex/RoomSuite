// Optional, bounded browser-side generation. Original media is never modified.
const maxSourceBytes=256*1024*1024,maxOutputBytes=128*1024*1024,maxSeconds=600,maxPixels=16000000;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function json(response){const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error||'The server could not access this media.');return body;}
function cancelled(signal){if(signal?.aborted)throw new Error('Optimized preview cancelled.');}
async function verify(blob,duration,width,height){
  const url=URL.createObjectURL(blob),video=document.createElement('video');video.preload='auto';video.muted=true;
  try{await new Promise((resolve,reject)=>{const timer=setTimeout(()=>finish(new Error('The browser could not verify the optimized preview.')),30000);function finish(error){clearTimeout(timer);video.onloadeddata=null;video.onerror=null;error?reject(error):resolve();}video.onerror=()=>finish(new Error('This browser cannot play the optimized preview.'));video.onloadeddata=()=>finish();video.src=url;video.load();});if(video.videoWidth!==width||video.videoHeight!==height||!Number.isFinite(video.duration)||Math.abs(video.duration-duration)>.2)throw new Error(`The optimized preview has an unexpected size or duration (${video.videoWidth}×${video.videoHeight}, ${video.duration}s; expected ${width}×${height}, ${duration}s).`);}
  finally{video.pause();video.removeAttribute('src');video.load();URL.revokeObjectURL(url);}
}
export async function createProxy(assetId,{signal,onProgress=()=>{}}={}){
  if(!uuid.test(assetId))throw new Error('Invalid video ID.');cancelled(signal);
  const current=await json(await fetch('/api/proxies/'+assetId+'/status',{signal}));if(current.exists)return {...current,already_exists:true};
  const metadata=await json(await fetch('/api/assets/'+assetId+'/metadata',{signal}));if(!String(metadata.type).startsWith('video/')||!Number.isFinite(metadata.size)||metadata.size<=0||metadata.size>maxSourceBytes)throw new Error('Optimized previews support video files up to 256 MiB.');
  let lib;try{lib=await import('/api/render/mediabunny.mjs');}catch{throw new Error('Optimized previews require the optional MCP and headless-rendering components.');}
  const {Input,UrlSource,ALL_FORMATS,Output,BufferTarget,WebMOutputFormat,Conversion,Quality}=lib,input=new Input({formats:ALL_FORMATS,source:new UrlSource(new URL('/api/assets/'+assetId,location.href).href,{getRetryDelay:()=>null})});
  let conversion=null,tooLarge=false;const abort=()=>{if(conversion)void conversion.cancel().catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});
  try{
    const video=await input.getPrimaryVideoTrack(),audio=await input.getPrimaryAudioTrack();if(!video||!await video.canDecode())throw new Error('This browser cannot decode the source video for an optimized preview.');
    const width=video.displayWidth,height=video.displayHeight;if(!width||!height||width*height>maxPixels)throw new Error('Optimized previews support video up to 16 megapixels.');
    const tracks=[video,...(audio?[audio]:[])],first=await input.getFirstTimestamp(tracks),duration=await input.computeDuration(tracks);if(!Number.isFinite(first)||Math.abs(first)>.1)throw new Error('This video has an unusual starting timestamp. Use the original preview.');if(!Number.isFinite(duration)||duration<=0||duration>maxSeconds)throw new Error('Optimized previews support videos up to 10 minutes.');
    const scale=Math.min(1,640/width,640/height),outWidth=Math.max(2,Math.floor(width*scale/2)*2),outHeight=Math.max(2,Math.floor(height*scale/2)*2),target=new BufferTarget(),output=new Output({format:new WebMOutputFormat(),target});
    conversion=await Conversion.init({input,output,tracks:'primary',copy:false,showWarnings:false,video:{width:outWidth,height:outHeight,fit:'contain',codec:'vp8',quality:new Quality({bitrate:800000}),keyFrameInterval:1,forceTranscode:true,allowTransformationMetadata:false},audio:{codec:'opus',quality:new Quality({bitrate:96000}),forceTranscode:true}});
    if(!conversion.isValid||!conversion.utilizedTracks.includes(video)||(audio&&!conversion.utilizedTracks.includes(audio)))throw new Error('This browser cannot preserve the video and audio in an optimized preview.');
    target.on('write',({end})=>{if(end>maxOutputBytes&&!tooLarge){tooLarge=true;void conversion.cancel().catch(()=>{});}});conversion.onProgress=value=>onProgress(Math.max(0,Math.min(1,value)));
    cancelled(signal);try{await conversion.execute();}catch(error){if(tooLarge)throw new Error('The optimized preview exceeds 128 MiB.');cancelled(signal);throw error;}cancelled(signal);
    if(!target.buffer?.byteLength||target.buffer.byteLength>maxOutputBytes)throw new Error('The optimized preview is empty or exceeds 128 MiB.');
    let blob=new Blob([target.buffer],{type:'video/webm'});if(globalThis.RoomWebM)try{blob=await RoomWebM.withDuration(blob,duration);}catch{}await verify(blob,duration,outWidth,outHeight);cancelled(signal);
    onProgress(1);const result=await json(await fetch('/api/proxies/'+assetId,{method:'POST',headers:{'Content-Type':'video/webm','X-Cliproom-Request':'1'},body:blob,signal}));return {...result,width:outWidth,height:outHeight,duration};
  }finally{signal?.removeEventListener('abort',abort);input.dispose();}
}
