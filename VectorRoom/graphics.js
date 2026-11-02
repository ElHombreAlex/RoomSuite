'use strict';
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.VectorGraphics=factory();})(typeof globalThis==='object'?globalThis:this,function(){
const NS='http://www.w3.org/2000/svg';
const uid=()=>globalThis.crypto.randomUUID();
function el(name,attrs={}){const node=document.createElementNS(NS,name);for(const [key,value] of Object.entries(attrs))node.setAttribute(key,String(value));return node;}
function pathData(points, closed) {
  if (!points.length) return '';
  let d = 'M ' + points[0].x + ' ' + points[0].y;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    d += ' C ' + a.outX + ' ' + a.outY + ' ' + b.inX + ' ' + b.inY + ' ' + b.x + ' ' + b.y;
  }
  if (closed && points.length > 1) { const a = points[points.length - 1], b = points[0]; d += ' C ' + a.outX + ' ' + a.outY + ' ' + b.inX + ' ' + b.inY + ' ' + b.x + ' ' + b.y + ' Z'; }
  return d;
}
function paint(item, defs) {
  let fill = item.fillMode === 'none' ? 'none' : item.fill;
  if (item.fillMode === 'gradient') {
    const gradient = el('linearGradient', { id: 'gradient-' + item.id, x1: '0%', y1: '0%', x2: '100%', y2: '100%' });
    gradient.append(el('stop', { offset: '0%', 'stop-color': item.fill }), el('stop', { offset: '100%', 'stop-color': item.fill2 })); defs.append(gradient);
    fill = 'url(#gradient-' + item.id + ')';
  }
  return { fill, stroke: item.strokeWidth ? item.stroke : 'none', 'stroke-width': item.strokeWidth, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
}
function booleanBounds(children){let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;for(const item of children){let x=Infinity,y=Infinity,r=-Infinity,b=-Infinity;const add=(px,py)=>{x=Math.min(x,px);y=Math.min(y,py);r=Math.max(r,px);b=Math.max(b,py);};if(item.type==='path')for(const point of item.points){add(point.x,point.y);add(point.inX,point.inY);add(point.outX,point.outY);}else{add(item.x,item.y);add(item.x+item.width,item.y+item.height);}const a=(item.rotation||0)*Math.PI/180,cos=Math.cos(a),sin=Math.sin(a),px=item.pivotX||0,py=item.pivotY||0;for(const [cx,cy]of [[x,y],[x,b],[r,y],[r,b]]){const dx=cx-px,dy=cy-py,tx=px+dx*cos-dy*sin,ty=py+dx*sin+dy*cos;left=Math.min(left,tx);top=Math.min(top,ty);right=Math.max(right,tx);bottom=Math.max(bottom,ty);}}if(![left,top,right,bottom].every(Number.isFinite)||right-left>4096||bottom-top>4096)throw new Error('Combined shapes must fit within a 4096 × 4096 area.');return {x:left-2,y:top-2,width:Math.max(4,right-left+4),height:Math.max(4,bottom-top+4)};}
function createObject(item, defs, operand=false) {
  const g = el('g', operand?{}:{ 'data-id': item.id }); let shape;
  if(item.groupId&&!operand)g.setAttribute('data-group-id',item.groupId);
  if (item.opacity !== undefined) g.setAttribute('opacity', item.opacity);
  if (item.rotation && Number.isFinite(item.pivotX) && Number.isFinite(item.pivotY)) g.setAttribute('transform', `rotate(${item.rotation} ${item.pivotX} ${item.pivotY})`);
  const colors = paint(item, defs);
  if(item.type==='boolean'){
    const area=booleanBounds(item.children),shapeFor=(child,color)=>createObject({...child,fillMode:'solid',fill:color,fill2:color,strokeWidth:0,opacity:1},defs,true),mask=(suffix,child,invert)=>{const id='boolean-'+item.id+'-'+suffix,node=el('mask',{id,maskUnits:'userSpaceOnUse',maskContentUnits:'userSpaceOnUse',...area,style:'mask-type:luminance'});if(invert)node.append(el('rect',{...area,fill:'#ffffff'}));node.append(shapeFor(child,invert?'#000000':'#ffffff'));defs.append(node);return 'url(#'+id+')';},[lower,upper]=item.children;
    if(item.operation==='union')g.append(shapeFor(lower,item.fill),shapeFor(upper,item.fill));
    else if(item.operation==='intersect'||item.operation==='subtract'){const result=shapeFor(lower,item.fill);result.setAttribute('mask',mask('upper',upper,item.operation==='subtract'));g.append(result);}
    else if(item.operation==='exclude'){const a=shapeFor(lower,item.fill),b=shapeFor(upper,item.fill);a.setAttribute('mask',mask('upper',upper,true));b.setAttribute('mask',mask('lower',lower,true));g.append(a,b);}return g;
  }
  if (item.type === 'rect') shape = el('rect', { x: item.x, y: item.y, width: item.width, height: item.height, ...colors });
  if (item.type === 'ellipse') shape = el('ellipse', { cx: item.x + item.width / 2, cy: item.y + item.height / 2, rx: item.width / 2, ry: item.height / 2, ...colors });
  if (item.type === 'line') shape = el('line', { x1: item.x, y1: item.y, x2: item.x2, y2: item.y2, ...colors, fill: 'none' });
  if (item.type === 'path') shape = el('path', { d: pathData(item.points, item.closed), ...colors });
  if (item.type === 'image') shape = el('image', { x:item.x, y:item.y, width:item.width, height:item.height, href:item.data, preserveAspectRatio:'none' });
  if (item.type === 'text') {
    shape = el('text', { x:item.x, y:item.y, 'font-size':item.fontSize, 'font-family':item.font, 'font-weight':item.fontWeight||'normal', 'font-style':item.fontStyle||'normal', 'text-anchor':({left:'start',center:'middle',right:'end'})[item.textAlign||'left'], 'letter-spacing':item.letterSpacing||0, ...colors });
    item.text.split('\n').forEach((line,index)=>{const span=el('tspan',{x:item.x,dy:index?(item.lineHeight||1.2)+'em':0});span.textContent=line||'\u200b';shape.append(span);});
  }
  if (shape) g.append(shape);
  return g;
}

function validateDocument(doc) {
  if (!doc || doc.format !== 'vectorroom' || doc.version !== 1 || !Array.isArray(doc.objects) || doc.objects.length > 1000) throw new Error('Not a supported VectorRoom project.');
  const color = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
  const num = v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 100000,ids=new Set(),validId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(value);
  const parseObject=object=>{
    if (!object || !['rect','ellipse','line','path','text','image','boolean'].includes(object.type) || !['none','solid','gradient'].includes(object.fillMode) || !color(object.fill) || !color(object.fill2) || !color(object.stroke) || !num(object.strokeWidth) || object.strokeWidth < 0 || object.strokeWidth > 100) throw new Error('A project object is invalid.');
    const objectId=validId(object.id)&&!ids.has(object.id)?object.id:uid();ids.add(objectId);const item = { id:objectId, type:object.type, fillMode:object.fillMode, fill:object.fill, fill2:object.fill2, stroke:object.stroke, strokeWidth:object.strokeWidth };
    if(object.groupId!==undefined){if(!validId(object.groupId))throw new Error('An object group is invalid.');item.groupId=object.groupId;}
    if (object.opacity !== undefined) { if (!num(object.opacity) || object.opacity < 0 || object.opacity > 1) throw new Error('Object opacity is invalid.'); item.opacity=object.opacity; }
    if (object.rotation !== undefined || object.pivotX !== undefined || object.pivotY !== undefined) {
      if (!num(object.rotation) || !num(object.pivotX) || !num(object.pivotY) || Math.abs(object.rotation)>36000) throw new Error('Object rotation is invalid.');
      item.rotation=object.rotation; item.pivotX=object.pivotX; item.pivotY=object.pivotY;
    }
    if(item.type==='boolean'){
      if(!['union','intersect','subtract','exclude'].includes(object.operation)||object.fillMode!=='solid'||object.strokeWidth!==0||!Array.isArray(object.children)||object.children.length!==2||object.children.some(child=>!child||!['rect','ellipse','path'].includes(child.type)))throw new Error('A combined shape is invalid.');item.operation=object.operation;item.children=object.children.map(parseObject);if(item.children.some(child=>child.groupId||child.type==='path'&&!child.closed||child.fillMode!=='solid'||child.strokeWidth!==0||(child.opacity??1)!==1))throw new Error('A combined shape source is invalid.');booleanBounds(item.children);
    } else if (item.type === 'path') {
      if (!Array.isArray(object.points) || object.points.length < 2 || object.points.length > 5000) throw new Error('A path is invalid.');
      item.points = object.points.map(p => { if (!p || !['x','y','inX','inY','outX','outY'].every(key => num(p[key]))) throw new Error('A path point is invalid.'); return { x:p.x,y:p.y,inX:p.inX,inY:p.inY,outX:p.outX,outY:p.outY }; }); item.closed = !!object.closed;
    } else {
      if (!num(object.x) || !num(object.y)) throw new Error('An object position is invalid.'); item.x = object.x; item.y = object.y;
      if (['rect','ellipse','image'].includes(item.type)) { if (!num(object.width) || !num(object.height) || object.width <= 0 || object.height <= 0) throw new Error('An object size is invalid.'); item.width = object.width; item.height = object.height; }
      if(item.type==='image'){if(typeof object.data!=='string'||object.data.length>28*1024*1024||!/^data:image\/(png|jpeg|webp|gif|avif);base64,[a-z0-9+/=]+$/i.test(object.data))throw new Error('An embedded image is invalid.');item.data=object.data;}
      if (item.type === 'line') { if (!num(object.x2) || !num(object.y2)) throw new Error('A line is invalid.'); item.x2 = object.x2; item.y2 = object.y2; }
      if (item.type === 'text') {
        if (typeof object.text !== 'string' || object.text.length > 500 || !num(object.fontSize) || object.fontSize < 8 || object.fontSize > 400 || !['sans-serif','serif','monospace','Arial','Georgia','Verdana','Times New Roman','Trebuchet MS','Courier New'].includes(object.font)) throw new Error('Text is invalid.');
        if(object.fontWeight!==undefined&&!['normal','bold'].includes(object.fontWeight)||object.fontStyle!==undefined&&!['normal','italic'].includes(object.fontStyle)||object.textAlign!==undefined&&!['left','center','right'].includes(object.textAlign)||object.lineHeight!==undefined&&(!num(object.lineHeight)||object.lineHeight<.8||object.lineHeight>3)||object.letterSpacing!==undefined&&(!num(object.letterSpacing)||object.letterSpacing< -5||object.letterSpacing>30))throw new Error('Text styling is invalid.');
        item.text=object.text;item.fontSize=object.fontSize;item.font=object.font;
        for(const key of ['fontWeight','fontStyle','textAlign','lineHeight','letterSpacing'])if(object[key]!==undefined)item[key]=object[key];
      }
    }
    return item;
  };return doc.objects.map(parseObject);
}

return {createObject,validateDocument,booleanBounds};
});
