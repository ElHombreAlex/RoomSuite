(() => {
  'use strict';
  const base = new URL('./vendor/vision/', document.baseURI).href;
  let segmentSession, inpaintSession;
  const canvas = (w,h) => {const c=document.createElement('canvas');c.width=w;c.height=h;return c;};
  const limit = (n,a,b) => Math.max(a,Math.min(b,n));
  function runtime(){if(!window.ort)throw new Error('The local image engine could not load.');ort.env.wasm.wasmPaths={mjs:base+'ort-wasm-simd-threaded.module.js',wasm:base+'ort-wasm-simd-threaded.wasm'};ort.env.wasm.numThreads=1;ort.env.wasm.proxy=true;return ort;}
  async function localFile(name){const response=await fetch(new URL(name,base));if(!response.ok)throw new Error('A local image model could not be loaded.');return new Uint8Array(await response.arrayBuffer());}
  async function foregroundSession(progress){if(!segmentSession){segmentSession=(async()=>{progress('Loading the local subject model…');const model=await localFile('u2netp.onnx');return runtime().InferenceSession.create(model,{executionProviders:['wasm']});})().catch(e=>{segmentSession=null;throw e;});}return segmentSession;}
  async function cleanupSession(progress){if(!inpaintSession){inpaintSession=(async()=>{const model=new Uint8Array(62074990);let offset=0;for(let i=1;i<=4;i++){progress(`Loading local cleanup model (${i}/4)…`);const part=await localFile(`lama.part${i}.bin`);if(offset+part.length>model.length)throw new Error('The local cleanup model is incomplete.');model.set(part,offset);offset+=part.length;}if(offset!==model.length)throw new Error('The local cleanup model is incomplete.');progress('Preparing the local cleanup model…');return runtime().InferenceSession.create(model,{executionProviders:['wasm']});})().catch(e=>{inpaintSession=null;throw e;});}return inpaintSession;}
  async function foreground(source,progress=()=>{}){
    const session=await foregroundSession(progress),size=320,input=canvas(size,size),ctx=input.getContext('2d',{willReadFrequently:true});ctx.drawImage(source,0,0,size,size);const data=ctx.getImageData(0,0,size,size).data,plane=size*size,tensor=new Float32Array(plane*3),means=[.485,.456,.406],std=[.229,.224,.225];let max=0;for(let i=0;i<data.length;i+=4)max=Math.max(max,data[i],data[i+1],data[i+2]);max=Math.max(1,max);for(let i=0;i<plane;i++)for(let ch=0;ch<3;ch++)tensor[ch*plane+i]=(data[i*4+ch]/max-means[ch])/std[ch];
    progress('Finding the subject on this device…');const result=await session.run({[session.inputNames[0]]:new ort.Tensor('float32',tensor,[1,3,size,size])}),values=result[session.outputNames[0]].data;let min=Infinity,peak=-Infinity;for(const v of values){if(Number.isFinite(v)){min=Math.min(min,v);peak=Math.max(peak,v);}}if(!Number.isFinite(min)||peak-min<1e-7)throw new Error('The subject model could not find a clear foreground.');const saliency=canvas(size,size),sc=saliency.getContext('2d'),pixels=sc.createImageData(size,size);for(let i=0;i<plane;i++){const v=Math.round(limit((values[i]-min)/(peak-min),0,1)*255);pixels.data[i*4]=pixels.data[i*4+1]=pixels.data[i*4+2]=v;pixels.data[i*4+3]=255;}sc.putImageData(pixels,0,0);return saliency;
  }
  function contrastTextRegions(source){
    const scale=Math.min(1,1400/Math.max(source.width,source.height)),w=Math.max(1,Math.round(source.width*scale)),h=Math.max(1,Math.round(source.height*scale)),scan=canvas(w,h),ctx=scan.getContext('2d',{willReadFrequently:true});ctx.drawImage(source,0,0,w,h);const rgba=ctx.getImageData(0,0,w,h).data,regions=[];
    for(const bright of [true,false]){const visited=new Uint8Array(w*h),queue=new Int32Array(w*h),components=[],minPixels=Math.max(20,Math.round(w*h*.00010));const matches=i=>{const p=i*4;return rgba[p+3]>128&&(bright?Math.min(rgba[p],rgba[p+1],rgba[p+2])>=245:Math.max(rgba[p],rgba[p+1],rgba[p+2])<=18);};for(let start=0;start<w*h;start++){if(visited[start]||!matches(start))continue;let head=0,tail=0,minX=w,minY=h,maxX=0,maxY=0;queue[tail++]=start;visited[start]=1;while(head<tail){const i=queue[head++],x=i%w,y=(i/w)|0;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);for(const n of [x>0?i-1:-1,x<w-1?i+1:-1,y>0?i-w:-1,y<h-1?i+w:-1])if(n>=0&&!visited[n]&&matches(n)){visited[n]=1;queue[tail++]=n;}}const cw=maxX-minX+1,ch=maxY-minY+1;if(tail>=minPixels&&ch>=8&&ch<h*.65&&cw<w*.65&&cw/ch<5&&tail/(cw*ch)>.08)components.push({x:minX,y:minY,w:cw,h:ch,pixels:queue.slice(0,tail)});}
      components.sort((a,b)=>a.x-b.x);const groups=[];for(const box of components){let g=groups.find(g=>{const overlap=Math.min(g.y+g.h,box.y+box.h)-Math.max(g.y,box.y),gap=Math.max(box.x-(g.x+g.w),g.x-(box.x+box.w),0);return overlap>Math.min(g.h,box.h)*.35&&gap<Math.max(g.h,box.h)*1.15;});if(!g){g={x:box.x,y:box.y,w:box.w,h:box.h,members:[]};groups.push(g);}g.members.push(box);const right=Math.max(g.x+g.w,box.x+box.w),bottom=Math.max(g.y+g.h,box.y+box.h);g.x=Math.min(g.x,box.x);g.y=Math.min(g.y,box.y);g.w=right-g.x;g.h=bottom-g.y;}
      for(const g of groups){if(g.members.length<3||g.w<g.h*1.25||g.h<12||g.w>w*.95)continue;const maxH=Math.max(...g.members.map(b=>b.h));if(g.members.filter(b=>b.h>=maxH*.35).length<3)continue;const mask=canvas(w,h),mc=mask.getContext('2d'),image=mc.createImageData(w,h);for(const member of g.members)for(const i of member.pixels){image.data[i*4]=image.data[i*4+1]=image.data[i*4+2]=255;image.data[i*4+3]=255;}mc.putImageData(image,0,0);const full=canvas(source.width,source.height),fc=full.getContext('2d');fc.imageSmoothingEnabled=false;fc.drawImage(mask,0,0,source.width,source.height);const pad=Math.max(3,g.h*.03);regions.push({x:Math.max(0,(g.x-pad)/scale),y:Math.max(0,(g.y-pad)/scale),w:Math.min(source.width,(g.x+g.w+pad)/scale)-Math.max(0,(g.x-pad)/scale),h:Math.min(source.height,(g.y+g.h+pad)/scale)-Math.max(0,(g.y-pad)/scale),hintMask:full,color:bright?[250,250,250]:[5,5,5]});}
    }
    return regions.sort((a,b)=>b.w*b.h-a.w*a.h).slice(0,10);
  }
  function reflected(v,n){if(n<=1)return 0;const period=2*n;let k=((v%period)+period)%period;return k<n?k:period-1-k;}
  async function inpaint(source,mask,region,progress=()=>{},options={}){
    const w=source.width,h=source.height,size=512,src=mask.getContext('2d',{willReadFrequently:true}).getImageData(0,0,w,h).data,raw=new Uint8Array(w*h);
    for(let i=0;i<raw.length;i++)raw[i]=src[i*4+3]>32?1:0;
    const padding=limit(Math.round(options.padding??Math.max(2,Math.min(8,(region?.h||50)*.04))),0,24),feather=limit(Math.round(options.feather??2),0,16),binary=PixelCleanup.dilate(raw,w,h,padding);
    let minX=w,minY=h,maxX=-1,maxY=-1;for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(binary[y*w+x]){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}if(maxX<minX)throw new Error('Select some letters before previewing the cleanup.');
    const alpha=PixelCleanup.feather(binary,w,h,feather),plan=PixelCleanup.plan({minX,minY,maxX,maxY}),{side,tiles}=plan,session=await cleanupSession(progress),sourceCtx=source.getContext('2d',{willReadFrequently:true}),original=sourceCtx.getImageData(0,0,w,h),out=canvas(w,h),oc=out.getContext('2d'),image=oc.createImageData(w,h);image.data.set(original.data);
    const bw=maxX-minX+1,weights=new Uint16Array(bw*(maxY-minY+1)),plane=size*size;
    for(let tile=0;tile<tiles.length;tile++){
      const {left,top}=tiles[tile],tensor=new Float32Array(plane*4);
      for(let y=0;y<size;y++)for(let x=0;x<size;x++){
        const sx=Math.floor(left+(x+.5)*side/size),sy=Math.floor(top+(y+.5)*side/size),rx=reflected(sx,w),ry=reflected(sy,h),p=(ry*w+rx)*4,t=y*size+x;
        // Max-pool the source mask so downscaling a tile cannot lose thin strokes.
        const x0=Math.max(0,Math.floor(left+x*side/size)),x1=Math.min(w,Math.ceil(left+(x+1)*side/size)),y0=Math.max(0,Math.floor(top+y*side/size)),y1=Math.min(h,Math.ceil(top+(y+1)*side/size));let masked=false;
        for(let yy=y0;yy<y1&&!masked;yy++)for(let xx=x0;xx<x1;xx++)if(binary[yy*w+xx]){masked=true;break;}
        for(let ch=0;ch<3;ch++)tensor[ch*plane+t]=masked?0:original.data[p+ch]/255;tensor[3*plane+t]=masked?1:0;
      }
      progress(`Rebuilding the background on this device (${tile+1}/${tiles.length})…`);
      const result=await session.run({[session.inputNames[0]]:new ort.Tensor('float32',tensor,[1,4,size,size])}),values=result[session.outputNames[0]].data,generated=canvas(size,size),gc=generated.getContext('2d'),patch=gc.createImageData(size,size);
      for(let i=0;i<plane;i++){for(let ch=0;ch<3;ch++)patch.data[i*4+ch]=Math.round(limit(values[ch*plane+i],0,1)*255);patch.data[i*4+3]=255;}gc.putImageData(patch,0,0);
      const scaled=canvas(side,side),sc=scaled.getContext('2d',{willReadFrequently:true});sc.drawImage(generated,0,0,side,side);const pixels=sc.getImageData(0,0,side,side).data;
      const x0=Math.max(minX,left,0),x1=Math.min(maxX+1,left+side,w),y0=Math.max(minY,top,0),y1=Math.min(maxY+1,top+side,h);
      for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const index=y*w+x;if(!binary[index])continue;const wi=(y-minY)*bw+x-minX,edge=Math.min(x-left+.5,y-top+.5,left+side-x-.5,top+side-y-.5),weight=Math.max(1,Math.round(255*limit(edge/(side*.2),0,1))),total=weights[wi]+weight,p=index*4,q=((y-top)*side+x-left)*4;for(let ch=0;ch<3;ch++)image.data[p+ch]=Math.round((image.data[p+ch]*weights[wi]+pixels[q+ch]*weight)/total);weights[wi]=total;}
    }
    for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){const i=y*w+x,p=i*4,blend=alpha[i]/255;if(!binary[i])continue;for(let ch=0;ch<3;ch++)image.data[p+ch]=Math.round(original.data[p+ch]*(1-blend)+image.data[p+ch]*blend);image.data[p+3]=original.data[p+3];}
    oc.putImageData(image,0,0);return out;
  }
  window.PixelVision={foreground,inpaint,contrastTextRegions};
})();
