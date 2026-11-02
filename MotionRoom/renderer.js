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
    const images=new Map(),fonts=new Map(),assets=new Map(),missing=[];let remaining=40000000;
    const expanded=MotionModel.expand(project);
    async function imageFor(data,key=data){if(images.has(key))return images.get(key);const image=await decoded(data),pixels=image.naturalWidth*image.naturalHeight;if(!pixels||pixels>remaining)throw Object.assign(new Error('Images and visible layers exceed the 40 million pixel budget.'),{code:'MOTION_PIXEL_BUDGET'});remaining-=pixels;images.set(key,image);return image;}
    if(project.sourceType==='paint'){
      const data=new Set(project.layers.filter(layer=>layer.kind==='paint').flatMap(layer=>project.source.layers[layer.sourceIndex].objects.filter(object=>object.type==='image').map(object=>object.data)));
      for(const value of data)await imageFor(value);
    }
    const result=[];
    for(const font of project.fonts||[])fonts.set(font.id,await loadFont(font));
    for(const layer of expanded)if(layer.kind==='text'&&['Bricolage Grotesque','Gelasio'].includes(layer.text.font)){const text=layer.text,faces=await document.fonts.load(`${text.style} ${text.weight} ${text.fontSize}px "${text.font}"`);if(!faces.length)throw new Error('The bundled font '+text.font+' could not be loaded.');}
    const usedAssets=new Set(expanded.filter(layer=>layer.kind==='image').map(layer=>layer.image.assetId));for(const asset of project.assets||[])if(usedAssets.has(asset.id)){if(asset.data)assets.set(asset.id,await imageFor(asset.data));else{let url;try{const key='shared:'+asset.sharedPath;if(images.has(key))assets.set(asset.id,images.get(key));else{const file=await RoomShared.get(asset.sharedPath,{maxBytes:20*1024*1024});url=URL.createObjectURL(file);assets.set(asset.id,await imageFor(url,key));}}catch(error){if(error.code==='MOTION_PIXEL_BUDGET')throw error;assets.set(asset.id,null);missing.push({id:asset.id,sharedPath:asset.sharedPath});}finally{if(url)URL.revokeObjectURL(url);}}}
    const byId=new Map();
    for(const layer of expanded){
      let item;if(layer.kind==='paint')item=await paintLayer(project,project.source.layers[layer.sourceIndex],images,remaining);
      else if(layer.kind==='vector')item=await vectorLayer(project.source.objects[layer.sourceIndex],1000,700,remaining);
      else if(layer.kind==='text')item={anchor:{x:layer.text.x,y:layer.text.y},font:fonts.get(layer.text.font)||layer.text.font};
      else if(layer.kind==='shape')item={anchor:{x:layer.shape.x+layer.shape.width/2,y:layer.shape.y+layer.shape.height/2}};
      else if(layer.kind==='image')item={anchor:{x:layer.image.x+layer.image.width/2,y:layer.image.y+layer.image.height/2},image:assets.get(layer.image.assetId)};
      else if(layer.kind==='lens')item={anchor:{x:layer.lens.x,y:layer.lens.y}};
      else item={anchor:{x:layer.group.x,y:layer.group.y}};
      byId.set(layer.id,item);if(item.canvas)remaining-=item.canvas.width*item.canvas.height;
    }
    for(const layer of project.layers)result.push(byId.get(layer.id));result.fonts=fonts;result.byId=byId;result.missing=missing;return result;
  }
  const textLayouts=new Map();
  const characters=text=>typeof Intl.Segmenter==='function'?[...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text)].map(part=>part.segment):Array.from(text);
  function layoutText(ctx,text,font){
    const cacheKey=JSON.stringify([text.content,text.fontSize,text.style,text.weight,text.lineHeight,text.width,text.height,text.padding,text.autoFit,font]);if(textLayouts.has(cacheKey))return textLayouts.get(cacheKey);
    const chars=characters(text.content),padding=text.padding||0,available=text.width?Math.max(1,text.width-padding*2):Infinity;
    function measure(size){
      ctx.font=`${text.style} ${text.weight} ${size}px "${font}"`;const lines=[];let start=0;
      while(start<=chars.length){
        let end=start;while(end<chars.length&&chars[end]!=='\n')end++;
        if(start===end)lines.push({start,end,text:''});
        let pos=start;
        while(pos<end){let low=pos,high=end;while(low<high){const middle=Math.ceil((low+high)/2);if(ctx.measureText(chars.slice(pos,middle).join('')).width<=available)low=middle;else high=middle-1;}const i=low;let lastSpace=-1;if(i<end)for(let j=i-1;j>=pos;j--)if(/\s/.test(chars[j])){lastSpace=j;break;}
          let stop=i===end?end:lastSpace>=pos?lastSpace:Math.max(pos+1,i);lines.push({start:pos,end:stop,text:chars.slice(pos,stop).join('')});pos=stop;while(pos<end&&/\s/.test(chars[pos]))pos++;
        }
        if(end===chars.length)break;start=end+1;
      }
      const width=Math.max(0,...lines.map(line=>ctx.measureText(line.text).width)),height=lines.length*size*text.lineHeight;
      return {lines,width,height,overflow:(!!text.width&&padding*2>=text.width||width>available+.01||!!text.height&&height+padding*2>text.height+.01)};
    }
    let size=text.fontSize,layout=measure(size);
    if(text.autoFit&&layout.overflow){let low=1,high=size;for(let i=0;i<14;i++){const mid=(low+high)/2;if(measure(mid).overflow)high=mid;else low=mid;}size=low;layout=measure(size);}
    const result={...layout,chars,fontSize:size,padding};if(textLayouts.size>=256)textLayouts.delete(textLayouts.keys().next().value);textLayouts.set(cacheKey,result);return result;
  }
  function intrinsicBounds(layer,item,ctx){
    if(layer.kind==='shape'||layer.kind==='image'){const s=layer[layer.kind];return {x:-s.width/2,y:-s.height/2,width:s.width,height:s.height};}
    if(layer.kind==='lens')return {x:-layer.lens.radius,y:-layer.lens.radius,width:layer.lens.radius*2,height:layer.lens.radius*2};
    if(layer.kind==='group'){const g=layer.group;return {x:-(g.width||0)/2,y:-(g.height||0)/2,width:g.width||0,height:g.height||0};}
    if(layer.kind==='text'){const t=layer.text,l=layoutText(ctx,t,item.font),width=t.width||l.width,height=t.height||l.height;return {x:t.align==='center'?-width/2:t.align==='right'?-width:0,y:0,width,height,textLayout:l};}
    if(item.paint)return {x:item.paint.left-item.paint.px,y:item.paint.top-item.paint.py,width:item.canvas.width,height:item.canvas.height};
    return {x:item.left-item.anchor.x,y:item.top-item.anchor.y,width:item.canvas.width,height:item.canvas.height};
  }
  function frameLayout(layer,content){
    const layout=layer.layout;if(!layout)return null;const padding=layout.padding||0,innerWidth=layout.width-padding*2,innerHeight=layout.height-padding*2,w=Math.max(.001,content.width),h=Math.max(.001,content.height),mode=layout.fit||'none';let scale=mode==='contain'?Math.min(innerWidth/w,innerHeight/h):mode==='cover'?Math.max(innerWidth/w,innerHeight/h):1;scale=Math.max(.001,Math.min(100,scale));const ax={start:0,center:.5,end:1}[layout.alignX||'center'],ay={start:0,center:.5,end:1}[layout.alignY||'center'],box={x:-layout.width/2,y:-layout.height/2,width:layout.width,height:layout.height},inner={x:box.x+padding,y:box.y+padding,width:innerWidth,height:innerHeight};return {box,inner,scale,x:inner.x+(inner.width-content.width*scale)*ax-content.x*scale,y:inner.y+(inner.height-content.height*scale)*ay-content.y*scale,clip:!!layout.clip,overflow:(content.width*scale>innerWidth+.01||content.height*scale>innerHeight+.01)&&!(mode==='cover'&&layout.clip)};
  }
  function bounds(layer,item,ctx){const intrinsic=intrinsicBounds(layer,item,ctx);return frameLayout(layer,intrinsic)?.box||intrinsic;}
  function point(box,anchor,angle=0,round=false){
    const x=box.x+box.width/2,y=box.y+box.height/2,hw=box.width/2,hh=box.height/2;
    if(anchor==='angle'){const a=angle*Math.PI/180,dx=Math.cos(a),dy=Math.sin(a),distance=round?1/Math.sqrt((dx/(hw||1))**2+(dy/(hh||1))**2):Math.min(Math.abs(dx)<1e-9?Infinity:hw/Math.abs(dx),Math.abs(dy)<1e-9?Infinity:hh/Math.abs(dy));return {x:x+(Number.isFinite(distance)?distance:0)*dx,y:y+(Number.isFinite(distance)?distance:0)*dy};}
    return {x:x+(anchor.includes('left')?-hw:anchor.includes('right')?hw:0),y:y+(anchor.includes('top')?-hh:anchor.includes('bottom')?hh:0)};
  }
  function draw(canvas,project,prepared,time,options={}){
    if(canvas.width!==project.width)canvas.width=project.width;if(canvas.height!==project.height)canvas.height=project.height;
    const displaySize=`${project.width}x${project.height}`;if(canvas.dataset.motionSize!==displaySize){canvas.dataset.motionSize=displaySize;canvas.style.width=`min(100%, ${56*project.width/project.height}vh)`;}
    const ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);const background=options.transparent?null:(project.background??(options.opaque?'#ffffff':null));if(background){ctx.fillStyle=background;ctx.fillRect(0,0,canvas.width,canvas.height);}
    const layers=MotionModel.expand(project),byId=new Map(layers.map(layer=>[layer.id,layer])),children=new Map(),poses=new Map();
    for(const layer of layers){const parent=layer.parentId||null;if(!children.has(parent))children.set(parent,[]);children.get(parent).push(layer);}
    function pose(layer){
      if(poses.has(layer.id))return poses.get(layer.id);const item=prepared.byId.get(layer.id),value=MotionModel.sampleAnimated(layer,time,project);let cx=item.anchor.x+value.x,cy=item.anchor.y+value.y,rotation=value.rotation;
      if(layer.attach){const a=layer.attach,target=byId.get(a.targetId),tp=pose(target),tb=bounds(target,prepared.byId.get(target.id),ctx),sb=bounds(layer,item,ctx),ta=point(tb,a.targetAnchor,a.angle||0,target.kind==='lens'||target.kind==='shape'&&target.shape.type==='ellipse'),sa=point(sb,a.selfAnchor);if(a.followRotation)rotation+=tp.rotation;if(a.orientation==='radial')rotation+=a.angle||0;if(a.orientation==='tangent')rotation+=(a.angle||0)+90;
        const tr=tp.rotation*Math.PI/180,sr=rotation*Math.PI/180,tx=(ta.x*Math.cos(tr)-ta.y*Math.sin(tr))*tp.value.scale,ty=(ta.x*Math.sin(tr)+ta.y*Math.cos(tr))*tp.value.scale,sx=(sa.x*Math.cos(sr)-sa.y*Math.sin(sr))*value.scale,sy=(sa.x*Math.sin(sr)+sa.y*Math.cos(sr))*value.scale;
        cx=tp.cx+tx+(a.offsetX||0)-sx+value.x;cy=tp.cy+ty+(a.offsetY||0)-sy+value.y;
      }
      const result={cx,cy,rotation,value};poses.set(layer.id,result);return result;
    }
    function stylePath(box,style){ctx.beginPath();ctx.roundRect(box.x,box.y,Math.max(.001,box.width),Math.max(.001,box.height),Math.min(style.radius||0,box.width/2,box.height/2));}
    function renderLayer(layer){
      if(!layer.visible)return;const item=prepared.byId.get(layer.id);if(!item)throw new Error('Composition resources changed; prepare them again.');const p=pose(layer),value=p.value,style=layer.style||{},contentBox=intrinsicBounds(layer,item,ctx),framing=frameLayout(layer,contentBox),box=framing?.box||contentBox;
      ctx.save();ctx.globalAlpha*=value.opacity*(item.paint?.opacity??1);if(style.blend)ctx.globalCompositeOperation=style.blend;if(style.shadow){ctx.shadowColor=style.shadow.color;ctx.shadowBlur=style.shadow.blur;ctx.shadowOffsetX=style.shadow.x;ctx.shadowOffsetY=style.shadow.y;}
      ctx.translate(p.cx,p.cy);ctx.rotate(p.rotation*Math.PI/180);ctx.scale(value.scale,value.scale);
      let diagnostic=null;if(options.diagnostics){const matrix=ctx.getTransform(),points=[[box.x,box.y],[box.x+box.width,box.y],[box.x,box.y+box.height],[box.x+box.width,box.y+box.height]].map(([x,y])=>matrix.transformPoint({x,y})),left=Math.min(...points.map(v=>v.x)),top=Math.min(...points.map(v=>v.y)),right=Math.max(...points.map(v=>v.x)),bottom=Math.max(...points.map(v=>v.y));diagnostic={id:layer.id,kind:layer.kind,opacity:ctx.globalAlpha,matrix:{a:matrix.a,b:matrix.b,c:matrix.c,d:matrix.d,e:matrix.e,f:matrix.f},bounds:{x:left,y:top,width:right-left,height:bottom-top},...(contentBox.textLayout?{textOverflow:contentBox.textLayout.overflow}:{}),...(framing?{layoutOverflow:framing.overflow}:{})};options.diagnostics.push(diagnostic);}
      if(framing){ctx.save();if(framing.clip){ctx.beginPath();ctx.rect(framing.inner.x,framing.inner.y,framing.inner.width,framing.inner.height);ctx.clip();}ctx.translate(framing.x,framing.y);ctx.scale(framing.scale,framing.scale);if(diagnostic&&layer.kind==='group'){const matrix=ctx.getTransform();diagnostic.matrix={a:matrix.a,b:matrix.b,c:matrix.c,d:matrix.d,e:matrix.e,f:matrix.f};}}
      if(layer.kind==='group'){
        if(style.clip){stylePath(contentBox,style);ctx.clip();}ctx.translate(-item.anchor.x,-item.anchor.y);for(const child of children.get(layer.id)||[])renderLayer(child);ctx.translate(item.anchor.x,item.anchor.y);
      }else if(layer.kind==='lens'){
        let scratch=scratchCanvases.get(canvas);if(!scratch){scratch=makeCanvas(canvas.width,canvas.height);scratchCanvases.set(canvas,scratch);}if(scratch.width!==canvas.width)scratch.width=canvas.width;if(scratch.height!==canvas.height)scratch.height=canvas.height;
        const sc=scratch.getContext('2d');sc.clearRect(0,0,scratch.width,scratch.height);sc.drawImage(canvas,0,0);const lens=layer.lens,matrix=ctx.getTransform(),center=matrix.transformPoint({x:0,y:0}),source=matrix.transformPoint({x:lens.offsetX,y:lens.offsetY});
        if(diagnostic){const small=makeCanvas(16,16),probe=small.getContext('2d',{willReadFrequently:true}),r=lens.radius*Math.hypot(matrix.a,matrix.b)/value.zoom;probe.drawImage(scratch,source.x-r,source.y-r,r*2,r*2,0,0,16,16);const pixels=probe.getImageData(0,0,16,16).data;let sum=0,squares=0;for(let i=0;i<pixels.length;i+=4){const v=(pixels[i]+pixels[i+1]+pixels[i+2])/3;sum+=v;squares+=v*v;}diagnostic.lensVariation=Math.sqrt(Math.max(0,squares/256-(sum/256)**2));}
        ctx.save();ctx.beginPath();ctx.arc(0,0,lens.radius,0,Math.PI*2);ctx.clip();ctx.setTransform(1,0,0,1,0,0);ctx.drawImage(scratch,center.x-source.x*value.zoom,center.y-source.y*value.zoom,canvas.width*value.zoom,canvas.height*value.zoom);ctx.restore();
        if(lens.strokeWidth){ctx.beginPath();ctx.arc(0,0,lens.radius,0,Math.PI*2);ctx.strokeStyle=lens.stroke;ctx.lineWidth=lens.strokeWidth;ctx.stroke();}
      }else{
        if(style.clip||layer.kind==='image'&&(style.radius||layer.image.fit==='cover')){stylePath(contentBox,style);ctx.save();ctx.clip();}
        if(item.paint){ctx.save();ctx.rotate(item.paint.rotation*Math.PI/180);ctx.scale(item.paint.scale,item.paint.scale);ctx.drawImage(item.canvas,item.paint.left-item.paint.px,item.paint.top-item.paint.py);ctx.restore();}
        else if(layer.kind==='vector')ctx.drawImage(item.canvas,item.left-item.anchor.x,item.top-item.anchor.y);
        else if(layer.kind==='image'){const image=layer.image,fit=image.fit||'fill',box=contentBox;if(!item.image){ctx.fillStyle='#f3e9e9';ctx.fillRect(box.x,box.y,box.width,box.height);ctx.strokeStyle='#aa5555';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(box.x,box.y);ctx.lineTo(box.x+box.width,box.y+box.height);ctx.moveTo(box.x+box.width,box.y);ctx.lineTo(box.x,box.y+box.height);ctx.stroke();}else{const iw=item.image.naturalWidth,ih=item.image.naturalHeight;if(fit==='fill')ctx.drawImage(item.image,box.x,box.y,box.width,box.height);else{const scale=fit==='cover'?Math.max(box.width/iw,box.height/ih):Math.min(box.width/iw,box.height/ih),w=iw*scale,h=ih*scale;ctx.drawImage(item.image,-w/2,-h/2,w,h);}}}
        else if(layer.kind==='shape'){const shape=layer.shape,box=contentBox;ctx.beginPath();if(shape.type==='ellipse')ctx.ellipse(0,0,shape.width/2,shape.height/2,0,0,Math.PI*2);else ctx.roundRect(box.x,box.y,box.width,box.height,Math.min(style.radius??shape.radius,box.width/2,box.height/2));if(shape.fill){ctx.fillStyle=shape.fill;ctx.fill();}if(shape.strokeWidth){ctx.strokeStyle=shape.stroke;ctx.lineWidth=shape.strokeWidth;ctx.stroke();}}
        else if(layer.kind==='text'){const text=layer.text,box=contentBox,l=box.textLayout,visible=Math.floor(l.chars.length*value.reveal+1e-8);ctx.font=`${text.style} ${text.weight} ${l.fontSize}px "${item.font}"`;ctx.textAlign=text.align;ctx.textBaseline='top';ctx.fillStyle=text.color;const x=text.align==='left'?box.x+l.padding:text.align==='right'?box.x+box.width-l.padding:box.x+box.width/2;l.lines.forEach((line,i)=>ctx.fillText(l.chars.slice(line.start,Math.min(line.end,visible)).join(''),x,l.padding+i*l.fontSize*text.lineHeight));}
        if(style.clip||layer.kind==='image'&&(style.radius||layer.image.fit==='cover'))ctx.restore();
      }
      if(framing)ctx.restore();if(style.border&&box.width&&box.height){ctx.shadowColor='transparent';stylePath(box,style);ctx.strokeStyle=style.border.color;ctx.lineWidth=style.border.width;ctx.stroke();}
      ctx.restore();
    }
    for(const layer of children.get(null)||[])renderLayer(layer);
  }
  window.MotionRenderer={prepare,draw,layoutText,bounds};
})();
