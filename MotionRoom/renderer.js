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
  async function paintLayer(project,layer,images){
    const {width,height}=project,local=makeCanvas(width,height),lc=local.getContext('2d');
    for(const object of layer.objects)paintObject(lc,object,images);
    if(layer.mask){const clearMask={...layer.mask,mode:layer.mask.mode==='show'?'hide':'show'};lc.save();lc.clip(new Path2D(PaintModel.maskPath(clearMask,width,height)),'evenodd');lc.clearRect(0,0,width,height);lc.restore();}
    const px=layer.pivotX??width/2,py=layer.pivotY??height/2;
    return {canvas:local,anchor:{x:px+layer.x,y:py+layer.y},paint:{px,py,opacity:layer.opacity,rotation:layer.rotation,scale:layer.scale}};
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
  async function prepare(project){
    // Keep retained layer bitmaps bounded, including large imported artwork.
    if(project.sourceType==='paint'&&project.width*project.height*project.layers.length>40000000)throw new Error('This artwork is too large to animate as separate layers here. Reduce its dimensions or number of layers.');
    const images=new Map();
    if(project.sourceType==='paint'){
      const data=new Set(project.source.layers.flatMap(layer=>layer.objects.filter(object=>object.type==='image').map(object=>object.data)));
      for(const value of data)images.set(value,await decoded(value));
    }
    const result=[];let remaining=40000000;
    for(const layer of project.layers){
      const item=project.sourceType==='paint'?await paintLayer(project,project.source.layers[layer.sourceIndex],images):await vectorLayer(project.source.objects[layer.sourceIndex],project.width,project.height,remaining);result.push(item);remaining-=item.canvas.width*item.canvas.height;
    }
    return result;
  }
  function draw(canvas,project,prepared,time){
    if(canvas.width!==project.width)canvas.width=project.width;if(canvas.height!==project.height)canvas.height=project.height;
    // Size both small and tall artwork to the available stage without
    // stretching the element, so pointer coordinates stay aligned with pixels.
    const displaySize=`${project.width}x${project.height}`;if(canvas.dataset.motionSize!==displaySize){canvas.dataset.motionSize=displaySize;canvas.style.width=`min(100%, ${68*project.width/project.height}vh)`;}
    const ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);ctx.fillStyle=project.background;ctx.fillRect(0,0,canvas.width,canvas.height);
    project.layers.forEach((layer,index)=>{if(!layer.visible)return;const item=prepared[index],value=MotionModel.sample(layer,time);ctx.save();ctx.globalAlpha=value.opacity*(item.paint?.opacity??1);ctx.translate(item.anchor.x+value.x,item.anchor.y+value.y);ctx.rotate(value.rotation*Math.PI/180);ctx.scale(value.scale,value.scale);if(item.paint){ctx.rotate(item.paint.rotation*Math.PI/180);ctx.scale(item.paint.scale,item.paint.scale);ctx.drawImage(item.canvas,-item.paint.px,-item.paint.py);}else ctx.drawImage(item.canvas,item.left-item.anchor.x,item.top-item.anchor.y);ctx.restore();});
  }
  window.MotionRenderer={prepare,draw};
})();
