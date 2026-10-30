// MCP content blocks are kept separate from structured JSON output.
export const imageContent=Symbol('roomsuite.imageContent');
export function attachPreview(result,preview){
  const {data,...metadata}=preview;
  return {...result,preview:metadata,[imageContent]:[{type:'image',mimeType:'image/png',data}]};
}

// All rendering happens in the same isolated RoomSuite browser session as the
// editor. The preview is bounded in size and is never written to the workspace.
export async function previewOnPage(page,spec){
  return page.evaluate(async spec=>{
    const limit=spec.maxDimension||1024;
    async function paint(project){
      setProject(project.state,uid(),0);await Promise.all(project.state.layers.flatMap(layer=>layer.objects.filter(o=>o.type==='image').map(o=>imageFor(o.data).decode())));draw();return canvas;
    }
    let result=document.createElement('canvas');
    if(spec.kind==='paint'){
      const source=await paint(spec.projects[0]),scale=Math.min(1,limit/Math.max(source.width,source.height));result.width=Math.max(1,Math.round(source.width*scale));result.height=Math.max(1,Math.round(source.height*scale));result.getContext('2d').drawImage(source,0,0,result.width,result.height);
    }else if(spec.kind==='sheet'){
      const columns=Math.min(spec.columns||3,spec.projects.length),rows=Math.ceil(spec.projects.length/columns),cell=400,header=36;
      result.width=columns*cell;result.height=rows*(cell+header);const ctx=result.getContext('2d');ctx.fillStyle='#f2f0f7';ctx.fillRect(0,0,result.width,result.height);ctx.font='16px sans-serif';ctx.textBaseline='middle';
      for(let i=0;i<spec.projects.length;i++){
        const project=spec.projects[i],source=await paint(project),x=(i%columns)*cell,y=Math.floor(i/columns)*(cell+header),scale=Math.min((cell-20)/source.width,(cell-20)/source.height);
        const w=source.width*scale,h=source.height*scale;ctx.fillStyle='#ffffff';ctx.fillRect(x+10,y+10,cell-20,cell-20);ctx.drawImage(source,x+(cell-w)/2,y+(cell-h)/2,w,h);
        ctx.fillStyle='#292539';ctx.fillText((i+1)+'. '+project.state.name.slice(0,40),x+12,y+cell+header/2,cell-24);
        surfaces.clear();images.clear();
      }
      const scale=Math.min(1,limit/Math.max(result.width,result.height));if(scale<1){const resized=document.createElement('canvas');resized.width=Math.max(1,Math.round(result.width*scale));resized.height=Math.max(1,Math.round(result.height*scale));resized.getContext('2d').drawImage(result,0,0,resized.width,resized.height);result=resized;}
    }else{
      const blob=spec.kind==='vector'?await pngBlob():document.querySelector('#roomsuitePreviewFile').files[0];
      const bitmap=await createImageBitmap(blob);try{if(bitmap.width*bitmap.height>64000000)throw new Error('Image dimensions are too large to preview.');const scale=Math.min(1,limit/Math.max(bitmap.width,bitmap.height));result.width=Math.max(1,Math.round(bitmap.width*scale));result.height=Math.max(1,Math.round(bitmap.height*scale));result.getContext('2d').drawImage(bitmap,0,0,result.width,result.height);}finally{bitmap.close();}
    }
    let encoded=result.toDataURL('image/png');
    while(encoded.length>1400000&&Math.max(result.width,result.height)>256){const smaller=document.createElement('canvas');smaller.width=Math.max(1,Math.round(result.width*.8));smaller.height=Math.max(1,Math.round(result.height*.8));smaller.getContext('2d').drawImage(result,0,0,smaller.width,smaller.height);result=smaller;encoded=result.toDataURL('image/png');}
    const data=encoded.slice(encoded.indexOf(',')+1),bytes=Math.floor(data.length*3/4)-(data.endsWith('==')?2:data.endsWith('=')?1:0);
    return {data,width:result.width,height:result.height,bytes,mime_type:'image/png'};
  },spec);
}
