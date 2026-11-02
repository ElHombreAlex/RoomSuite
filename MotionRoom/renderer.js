'use strict';
(function(){
  const NS='http://www.w3.org/2000/svg';
  const makeCanvas=(width,height)=>{const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;return canvas;};
  async function decoded(data){const image=new Image();image.src=data;try{await image.decode();}catch{throw new Error('An embedded image could not be decoded.');}return image;}
  function strokePath(o){
    if(o.points[0].pressure!==undefined)return new Path2D(PaintModel.strokeOutline(o.points,o.width));
    const path=new Path2D();path.moveTo(o.points[0].x,o.points[0].y);if(o.points.length===1)path.lineTo(o.points[0].x+.001,o.points[0].y);else for(const p of o.points.slice(1))path.lineTo(p.x,p.y);return path;
  }
  function paintObject(c,o,images){
    c.save();c.globalAlpha=o.opacity;
    if(o.type==='stroke'){
      c.globalCompositeOperation=o.erase?'destination-out':'source-over';
      if(o.points[0].pressure!==undefined){c.fillStyle=o.color;c.fill(strokePath(o));}
      else{c.strokeStyle=o.color;c.lineWidth=o.width;c.lineCap='round';c.lineJoin='round';c.stroke(strokePath(o));}
    }else if(o.type==='path'){
      c.strokeStyle=o.color;c.lineWidth=o.width;c.lineCap='round';c.lineJoin='round';c.beginPath();c.moveTo(o.points[0].x,o.points[0].y);
      for(let i=1;i<o.points.length;i++){const a=o.points[i-1],b=o.points[i];c.bezierCurveTo(a.outX,a.outY,b.inX,b.inY,b.x,b.y);}
      if(o.closed&&o.points.length>1){const a=o.points.at(-1),b=o.points[0];c.bezierCurveTo(a.outX,a.outY,b.inX,b.inY,b.x,b.y);c.closePath();}
      if(o.fill&&o.points.length>1){c.fillStyle=o.fill;c.fill();}if(o.stroke!==false)c.stroke();
    }else if(o.type==='image')c.drawImage(images.get(o.data),o.x,o.y,o.width,o.height);
    else{
      const x=Math.min(o.x,o.x2),y=Math.min(o.y,o.y2),w=Math.abs(o.x2-o.x),h=Math.abs(o.y2-o.y);c.strokeStyle=o.color;c.lineWidth=o.width;c.lineCap='round';c.lineJoin='round';c.beginPath();
      if(o.type==='rect')c.rect(x,y,w,h);else if(o.type==='ellipse')c.ellipse(x+w/2,y+h/2,Math.max(.001,w/2),Math.max(.001,h/2),0,0,Math.PI*2);else{c.moveTo(o.x,o.y);c.lineTo(o.x2,o.y2);}
      if(o.fill&&o.type!=='line'){c.fillStyle=o.fill;c.fill();}if(o.stroke!==false)c.stroke();
    }c.restore();
  }
  async function paintLayer(project,layer,images,budget){
    const {width,height}=project.source,local=makeCanvas(width,height),lc=local.getContext('2d',{willReadFrequently:true});
    for(const object of layer.objects)paintObject(lc,object,images);
    if(layer.mask){const clearMask={...layer.mask,mode:layer.mask.mode==='show'?'hide':'show'};lc.save();lc.clip(new Path2D(PaintModel.maskPath(clearMask,width,height)),'evenodd');lc.clearRect(0,0,width,height);lc.restore();}
    const pixels=lc.getImageData(0,0,width,height).data;let left=width,top=height,right=-1,bottom=-1;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(pixels[(y*width+x)*4+3]){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
    if(right<0){left=0;top=0;right=0;bottom=0;}
    const w=right-left+1,h=bottom-top+1;if(w*h>budget)throw new Error('The visible artwork exceeds the 40 million pixel layer budget.');
    const trimmed=makeCanvas(w,h);trimmed.getContext('2d').drawImage(local,left,top,w,h,0,0,w,h);local.width=local.height=1;
    const px=layer.pivotX??width/2,py=layer.pivotY??height/2;
    return {canvas:trimmed,anchor:{x:px+layer.x,y:py+layer.y},paint:{px,py,left,top,opacity:layer.opacity,rotation:layer.rotation,scale:layer.scale}};
  }
  async function vectorLayer(item,width,height,budget){
    const svg=document.createElementNS(NS,'svg');svg.setAttribute('xmlns',NS);svg.setAttribute('width',width);svg.setAttribute('height',height);svg.setAttribute('viewBox',`0 0 ${width} ${height}`);
    const defs=document.createElementNS(NS,'defs'),group=VectorGraphics.createObject(item,defs);svg.append(defs,group);
    // Measure the full object, including parts outside the artboard, before
    // rasterizing it. That allows motion to bring off-canvas objects into view.
    svg.style.position='fixed';svg.style.left='-100000px';svg.style.top='0';svg.style.visibility='hidden';document.body.append(svg);
    let bounds;
    try{
      const box=group.getBBox(),matrix=group.transform.baseVal.consolidate()?.matrix,pad=(item.strokeWidth||0)/2+3;
      const points=[[box.x-pad,box.y-pad],[box.x+box.width+pad,box.y-pad],[box.x-pad,box.y+box.height+pad],[box.x+box.width+pad,box.y+box.height+pad]].map(([x,y])=>matrix?{x:matrix.a*x+matrix.c*y+matrix.e,y:matrix.b*x+matrix.d*y+matrix.f}:{x,y});
      const left=Math.floor(Math.min(...points.map(p=>p.x))),top=Math.floor(Math.min(...points.map(p=>p.y))),right=Math.ceil(Math.max(...points.map(p=>p.x))),bottom=Math.ceil(Math.max(...points.map(p=>p.y)));
      bounds={left,top,width:Math.max(1,right-left),height:Math.max(1,bottom-top)};
    }finally{svg.remove();}
    if(!Object.values(bounds).every(Number.isFinite)||bounds.width>16384||bounds.height>16384||bounds.width*bounds.height>budget)throw new Error('This vector artwork is too large to animate as separate objects here.');
    svg.removeAttribute('style');svg.setAttribute('width',bounds.width);svg.setAttribute('height',bounds.height);svg.setAttribute('viewBox',`${bounds.left} ${bounds.top} ${bounds.width} ${bounds.height}`);
    const url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)],{type:'image/svg+xml'}));
    try{
      const image=await decoded(url),canvas=makeCanvas(bounds.width,bounds.height);canvas.getContext('2d').drawImage(image,0,0);
      return {canvas,left:bounds.left,top:bounds.top,anchor:{x:bounds.left+bounds.width/2,y:bounds.top+bounds.height/2}};
    }finally{URL.revokeObjectURL(url);}
  }
  const loadedFonts=new Map(),scratchCanvases=new WeakMap();
  async function loadFont(font){
    const binary=atob(font.data.slice(font.data.indexOf(',')+1)),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0)),digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
    const key=Array.from(digest,b=>b.toString(16).padStart(2,'0')).join(''),family='MotionRoom-'+key;
    if(!loadedFonts.has(key)){try{const face=new FontFace(family,bytes);await face.load();if(loadedFonts.size>=32){const oldest=loadedFonts.keys().next().value;document.fonts.delete(loadedFonts.get(oldest));loadedFonts.delete(oldest);}document.fonts.add(face);loadedFonts.set(key,face);}catch{throw new Error('Could not load the embedded font “'+font.name+'”.');}}
    return family;
  }
  async function prepare(project){
    const images=new Map(),fonts=new Map(),assets=new Map();let remaining=40000000;
    async function imageFor(data){if(images.has(data))return images.get(data);const image=await decoded(data),pixels=image.naturalWidth*image.naturalHeight;if(!pixels||pixels>remaining)throw new Error('Embedded images and visible layers exceed the 40 million pixel budget.');remaining-=pixels;images.set(data,image);return image;}
    if(project.sourceType==='paint'){
      const data=new Set(project.layers.filter(layer=>layer.kind==='paint').flatMap(layer=>project.source.layers[layer.sourceIndex].objects.filter(object=>object.type==='image').map(object=>object.data)));
      for(const value of data)await imageFor(value);
    }
    const result=[];
    for(const font of project.fonts||[])fonts.set(font.id,await loadFont(font));
    for(const layer of project.layers)if(layer.kind==='text'&&['Bricolage Grotesque','Gelasio'].includes(layer.text.font)){const text=layer.text,faces=await document.fonts.load(`${text.style} ${text.weight} ${text.fontSize}px "${text.font}"`);if(!faces.length)throw new Error('The bundled font '+text.font+' could not be loaded.');}
    const usedAssets=new Set(project.layers.filter(layer=>layer.kind==='image').map(layer=>layer.image.assetId));for(const asset of project.assets||[])if(usedAssets.has(asset.id))assets.set(asset.id,await imageFor(asset.data));
    for(const layer of project.layers){
      let item;if(layer.kind==='paint')item=await paintLayer(project,project.source.layers[layer.sourceIndex],images,remaining);
      else if(layer.kind==='vector')item=await vectorLayer(project.source.objects[layer.sourceIndex],1000,700,remaining);
      else if(layer.kind==='text')item={anchor:{x:layer.text.x,y:layer.text.y},font:fonts.get(layer.text.font)||layer.text.font};
      else if(layer.kind==='shape')item={anchor:{x:layer.shape.x+layer.shape.width/2,y:layer.shape.y+layer.shape.height/2}};
      else if(layer.kind==='image')item={anchor:{x:layer.image.x+layer.image.width/2,y:layer.image.y+layer.image.height/2},image:assets.get(layer.image.assetId)};
      else item={anchor:{x:layer.lens.x,y:layer.lens.y}};
      result.push(item);if(item.canvas)remaining-=item.canvas.width*item.canvas.height;
    }
    result.fonts=fonts;return result;
  }
  function draw(canvas,project,prepared,time,options={}){
    if(canvas.width!==project.width)canvas.width=project.width;if(canvas.height!==project.height)canvas.height=project.height;
    // Size both small and tall artwork to the available stage without
    // stretching the element, so pointer coordinates stay aligned with pixels.
    const displaySize=`${project.width}x${project.height}`;if(canvas.dataset.motionSize!==displaySize){canvas.dataset.motionSize=displaySize;canvas.style.width=`min(100%, ${68*project.width/project.height}vh)`;}
    const ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);const background=options.transparent?null:(project.background??(options.opaque?'#ffffff':null));if(background){ctx.fillStyle=background;ctx.fillRect(0,0,canvas.width,canvas.height);}
    project.layers.forEach((layer,index)=>{
      if(!layer.visible)return;const item=prepared[index],value=MotionModel.sample(layer,time),cx=item.anchor.x+value.x,cy=item.anchor.y+value.y;
      if(layer.kind==='lens'){
        let scratch=scratchCanvases.get(canvas);if(!scratch){scratch=makeCanvas(canvas.width,canvas.height);scratchCanvases.set(canvas,scratch);}if(scratch.width!==canvas.width)scratch.width=canvas.width;if(scratch.height!==canvas.height)scratch.height=canvas.height;
        const sc=scratch.getContext('2d');sc.clearRect(0,0,scratch.width,scratch.height);sc.drawImage(canvas,0,0);const lens=layer.lens,zoom=value.zoom,sx=cx+lens.offsetX,sy=cy+lens.offsetY;
        ctx.save();ctx.globalAlpha=value.opacity;ctx.translate(cx,cy);ctx.rotate(value.rotation*Math.PI/180);ctx.scale(value.scale,value.scale);ctx.save();ctx.beginPath();ctx.arc(0,0,lens.radius,0,Math.PI*2);ctx.clip();ctx.drawImage(scratch,-sx*zoom,-sy*zoom,canvas.width*zoom,canvas.height*zoom);ctx.restore();if(lens.strokeWidth){ctx.beginPath();ctx.arc(0,0,lens.radius,0,Math.PI*2);ctx.strokeStyle=lens.stroke;ctx.lineWidth=lens.strokeWidth;ctx.stroke();}ctx.restore();return;
      }
      ctx.save();ctx.globalAlpha=value.opacity*(item.paint?.opacity??1);ctx.translate(cx,cy);ctx.rotate(value.rotation*Math.PI/180);ctx.scale(value.scale,value.scale);
      if(item.paint){ctx.rotate(item.paint.rotation*Math.PI/180);ctx.scale(item.paint.scale,item.paint.scale);ctx.drawImage(item.canvas,item.paint.left-item.paint.px,item.paint.top-item.paint.py);}
      else if(layer.kind==='vector')ctx.drawImage(item.canvas,item.left-item.anchor.x,item.top-item.anchor.y);
      else if(layer.kind==='image'){const image=layer.image;ctx.drawImage(item.image,-image.width/2,-image.height/2,image.width,image.height);}
      else if(layer.kind==='shape'){const shape=layer.shape;ctx.beginPath();if(shape.type==='ellipse')ctx.ellipse(0,0,shape.width/2,shape.height/2,0,0,Math.PI*2);else ctx.roundRect(-shape.width/2,-shape.height/2,shape.width,shape.height,Math.min(shape.radius,shape.width/2,shape.height/2));if(shape.fill){ctx.fillStyle=shape.fill;ctx.fill();}if(shape.strokeWidth){ctx.strokeStyle=shape.stroke;ctx.lineWidth=shape.strokeWidth;ctx.stroke();}}
      else if(layer.kind==='text'){const text=layer.text,graphemes=typeof Intl.Segmenter==='function'?[...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text.content)].map(part=>part.segment):Array.from(text.content),shown=graphemes.slice(0,Math.floor(graphemes.length*value.reveal+1e-8)).join('');ctx.font=`${text.style} ${text.weight} ${text.fontSize}px "${item.font}"`;ctx.textAlign=text.align;ctx.textBaseline='top';ctx.fillStyle=text.color;shown.split('\n').forEach((line,i)=>ctx.fillText(line,0,i*text.fontSize*text.lineHeight));}
      ctx.restore();
    });
  }
  window.MotionRenderer={prepare,draw};
})();
