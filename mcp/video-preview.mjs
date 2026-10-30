import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inputPath } from './files.mjs';
import { withRoom } from './rooms.mjs';
import { attachPreview } from './preview.mjs';

const bundle=path.resolve(path.dirname(fileURLToPath(import.meta.resolve('mediabunny'))),'../../bundles/mediabunny.min.mjs');

// Read actual decoded samples from the exported file, not the editable timeline.
export async function previewVideo(args,signal){
  const file=await inputPath(args.input);
  return withRoom('/cliproom/','Cliproom',signal,async page=>{
    await page.route('**/__roomsuite_preview_mediabunny.mjs',route=>route.fulfill({path:bundle,contentType:'text/javascript'}));
    await page.evaluate(()=>{const input=document.createElement('input');input.type='file';input.id='roomsuiteVideoPreview';document.body.append(input);});
    await page.locator('#roomsuiteVideoPreview').setInputFiles(file);
    const output=await page.evaluate(async args=>{
      const {Input,BlobSource,ALL_FORMATS,CanvasSink}=await import('/__roomsuite_preview_mediabunny.mjs');
      const file=document.querySelector('#roomsuiteVideoPreview').files[0],input=new Input({source:new BlobSource(file),formats:ALL_FORMATS});
      try{
        const videos=await input.getVideoTracks(),audio=await input.getAudioTracks(),video=await input.getPrimaryVideoTrack();
        if(!video)throw new Error('The file has no video track.');
        if(!await video.canDecode())throw new Error('This browser cannot decode the video codec.');
        const start=await video.getFirstTimestamp(),end=await video.computeDuration(),duration=await input.computeDuration(),metadataDuration=await input.getDurationFromMetadata();
        const width=await video.getDisplayWidth(),height=await video.getDisplayHeight(),codec=await video.getCodec(),audioTracks=await Promise.all(audio.map(async track=>({number:track.number,codec:await track.getCodec()})));
        for(const time of args.times)if(time<Math.max(0,start)||time>=end)throw new Error('Requested time '+time+' is outside the video track ['+Math.max(0,start)+', '+end+').');
        const single=args.times.length===1,limit=args.max_dimension||1024,columns=single?1:Math.min(args.columns||3,args.times.length),rows=Math.ceil(args.times.length/columns),cell=400,header=single?0:36,oneScale=Math.min(1,limit/Math.max(width,height));
        const sheet=document.createElement('canvas');sheet.width=single?Math.max(1,Math.round(width*oneScale)):columns*cell;sheet.height=single?Math.max(1,Math.round(height*oneScale)):rows*(cell+header);const ctx=sheet.getContext('2d');ctx.fillStyle='#f2f0f7';ctx.fillRect(0,0,sheet.width,sheet.height);ctx.fillStyle='#292539';ctx.font='16px sans-serif';ctx.textBaseline='middle';
        const sorted=args.times.map((time,index)=>({time,index})).sort((a,b)=>a.time-b.time||a.index-b.index),frames=new Array(sorted.length),sink=new CanvasSink(video,{width:single?sheet.width:Math.min(width,640),poolSize:2});let i=0;
        for await(const frame of sink.canvasesAtTimestamps(sorted.map(item=>item.time))){const item=sorted[i++];if(!frame)throw new Error('No decoded frame is available at '+item.time+' seconds.');const x=(item.index%columns)*cell,y=Math.floor(item.index/columns)*(cell+header),canvas=frame.canvas,s=Math.min(cell/canvas.width,cell/canvas.height);if(single)ctx.drawImage(canvas,0,0,sheet.width,sheet.height);else ctx.drawImage(canvas,x+(cell-canvas.width*s)/2,y+(cell-canvas.height*s)/2,canvas.width*s,canvas.height*s);if(header){ctx.fillStyle='#292539';ctx.fillText((item.index+1)+'. '+item.time.toFixed(3)+' s → '+frame.timestamp.toFixed(3)+' s',x+8,y+cell+header/2,cell-16);}frames[item.index]={requested_time:item.time,presentation_time:frame.timestamp,duration:frame.duration};}
        let result=sheet,s=Math.min(1,limit/Math.max(sheet.width,sheet.height));if(s<1){result=document.createElement('canvas');result.width=Math.max(1,Math.round(sheet.width*s));result.height=Math.max(1,Math.round(sheet.height*s));result.getContext('2d').drawImage(sheet,0,0,result.width,result.height);}
        let encoded=result.toDataURL('image/png');while(encoded.length>1400000&&Math.max(result.width,result.height)>256){const smaller=document.createElement('canvas');smaller.width=Math.max(1,Math.round(result.width*.8));smaller.height=Math.max(1,Math.round(result.height*.8));smaller.getContext('2d').drawImage(result,0,0,smaller.width,smaller.height);result=smaller;encoded=result.toDataURL('image/png');}
        const data=encoded.slice(encoded.indexOf(',')+1),bytes=Math.floor(data.length*3/4)-(data.endsWith('==')?2:data.endsWith('=')?1:0);
        return {name:file.name,bytes:file.size,mime_type:file.type||'application/octet-stream',width,height,video_codec:codec,video_tracks:videos.length,audio_tracks:audioTracks,video_start_seconds:start,video_end_seconds:end,duration_seconds:duration,metadata_duration_seconds:metadataDuration,frames,preview:{data,width:result.width,height:result.height,bytes,mime_type:'image/png'}};
      }finally{input.dispose();}
    },args);
    const {preview,...metadata}=output;return attachPreview(metadata,preview);
  });
}
