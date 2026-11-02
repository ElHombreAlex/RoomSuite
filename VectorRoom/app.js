'use strict';
const $ = id => document.getElementById(id);
const svg = $('artboard'), NS = 'http://www.w3.org/2000/svg';
const uid = () => crypto.randomUUID();
const clone = value => structuredClone(value);
let objects = [], selected = null, tool = 'select', draft = null, gesture = null, undo = [], redo = [];
let selection=new Set(),guides=null,objectNodes=new Map();
function status(text, error = false) { $('status').textContent = text; $('status').classList.toggle('error', error); }
function el(name, attrs = {}) { const node = document.createElementNS(NS, name); for (const [key,value] of Object.entries(attrs)) node.setAttribute(key, String(value)); return node; }
function saveUndo(before) { if (before === JSON.stringify(objects)) return; undo.push(before); if (undo.length > 60) undo.shift(); redo = []; }
function change(fn) { const before = JSON.stringify(objects); fn(); saveUndo(before); render(); }
function selectedObject() { return objects.find(item => item.id === selected); }
function selectionUnit(id){const item=objects.find(object=>object.id===id);return !item?[]:item.groupId?objects.filter(object=>object.groupId===item.groupId).map(object=>object.id):[id];}
function choose(id,add=false){const members=selectionUnit(id);if(!add)selection.clear();if(add&&members.length&&members.every(member=>selection.has(member)))for(const member of members)selection.delete(member);else for(const member of members)selection.add(member);selected=selection.has(id)?id:[...selection].at(-1)||null;}
function syncSelection(){const valid=new Set(objects.map(item=>item.id));for(const id of selection)if(!valid.has(id))selection.delete(id);if(!selected||!valid.has(selected)){selected=null;selection.clear();}else if(!selection.has(selected)){selection.clear();for(const id of selectionUnit(selected))selection.add(id);}}
function selectedUnits(){const units=new Map();for(const item of objects){if(!selection.has(item.id))continue;const key=item.groupId?'g:'+item.groupId:'o:'+item.id;if(!units.has(key))units.set(key,[]);units.get(key).push(item);}return [...units.values()];}
function style(type) { return { id: uid(), type, fillMode: type === 'line' || type === 'path' ? 'none' : 'solid', fill: '#a895e9', fill2: '#f7bcb5', stroke: '#302a3e', strokeWidth: type === 'text' ? 0 : 2 }; }
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
function render() {
  syncSelection();
  svg.replaceChildren(); const defs = el('defs'); svg.append(defs);objectNodes=new Map();
  for (const item of objects){const node=createObject(item,defs);objectNodes.set(item.id,node);svg.append(node);}
  if (draft) svg.append(createObject(draft, defs));
  const item = selectedObject();
  if (item && selection.size===1) {
    const group = objectNodes.get(item.id);
    if (group) {
      try {
        const box = group.getBBox(), controls = el('g', { class: 'controls' });
        if (group.hasAttribute('transform')) controls.setAttribute('transform', group.getAttribute('transform'));
        controls.append(el('rect', { x: box.x - 5, y: box.y - 5, width: Math.max(10, box.width + 10), height: Math.max(10, box.height + 10), fill: 'none', stroke: '#8067e5', 'stroke-width': 2, 'stroke-dasharray': '6 5', class: 'art-outline' }));
        if (tool === 'select') {
          const cx = box.x + box.width / 2, y = box.y - 28;
          controls.append(el('line', { x1:cx, y1:box.y-5, x2:cx, y2:y, stroke:'#8067e5', 'stroke-width':2, class:'art-outline' }));
          controls.append(el('circle', { cx, cy:y, r:8, fill:'#fff', stroke:'#8067e5', 'stroke-width':2, 'data-action':'rotate', class:'art-control' }));
          if(item.type!=='boolean')controls.append(el('rect', { x:box.x+box.width-7, y:box.y+box.height-7, width:14, height:14, fill:'#fff', stroke:'#8067e5', 'stroke-width':2, 'data-action':'resize', class:'art-control' }));
        }
        if (tool === 'nodes' && item.type === 'path') item.points.forEach((point, index) => {
          for (const side of ['in','out']) {
            controls.append(el('line', { x1: point.x, y1: point.y, x2: point[side + 'X'], y2: point[side + 'Y'], stroke: '#b3a2ed', 'stroke-width': 2, class: 'art-outline' }));
            controls.append(el('circle', { cx: point[side + 'X'], cy: point[side + 'Y'], r: 6, fill: '#fff', stroke: '#8067e5', 'stroke-width': 2, 'data-action': side, 'data-index': index, class: 'art-control' }));
          }
          controls.append(el('circle', { cx: point.x, cy: point.y, r: 8, fill: '#8067e5', stroke: '#fff', 'stroke-width': 2, 'data-action': 'node', 'data-index': index, class: 'art-control' }));
        });
        svg.append(controls);
      } catch {}
    }
  }
  if(selection.size>1)for(const id of selection){const group=objectNodes.get(id);if(!group)continue;try{const box=group.getBBox(),controls=el('g',{class:'controls'});if(group.hasAttribute('transform'))controls.setAttribute('transform',group.getAttribute('transform'));controls.append(el('rect',{x:box.x-5,y:box.y-5,width:Math.max(10,box.width+10),height:Math.max(10,box.height+10),fill:'none',stroke:'#8067e5','stroke-width':2,'stroke-dasharray':'6 5',class:'art-outline'}));svg.append(controls);}catch{}}
  if(guides){const overlay=el('g',{class:'controls'});if(guides.x!==null)overlay.append(el('line',{x1:guides.x,y1:0,x2:guides.x,y2:700,stroke:'#e24e9c','stroke-width':1.5,'stroke-dasharray':'5 4',class:'art-outline'}));if(guides.y!==null)overlay.append(el('line',{x1:0,y1:guides.y,x2:1000,y2:guides.y,stroke:'#e24e9c','stroke-width':1.5,'stroke-dasharray':'5 4',class:'art-outline'}));svg.append(overlay);}
  $('undo').disabled = !undo.length;
  $('redo').disabled = !redo.length;
  for (const id of ['delete','raise','lower','duplicate']) $(id).disabled = !item;
  $('properties').classList.toggle('hidden', !item||selection.size!==1); $('inspectorHint').classList.toggle('hidden', !!item&&selection.size===1);
  $('inspectorHint').textContent=selection.size>1?'Select one object to change its properties.':'Select an object to change its properties.';
  const unitCount=selectedUnits().length;$('groupObjects').disabled=selection.size<2||unitCount<2;$('ungroupObjects').disabled=![...selection].some(id=>objects.find(item=>item.id===id)?.groupId);for(const button of document.querySelectorAll('[data-arrange]'))button.disabled=unitCount<(['horizontal','vertical'].includes(button.dataset.arrange)?3:2);
  for(const button of document.querySelectorAll('[data-boolean]'))button.disabled=selection.size!==2||unitCount!==2;$('releaseBoolean').disabled=selection.size!==1||item?.type!=='boolean';
  $('selectionInfo').textContent = selection.size>1?'Selected '+selection.size+' objects · Drag to move them together.':item ? 'Selected ' + item.type + ' · Drag to move or edit its properties.' : 'Choose a tool to get started.';
  $('layers').replaceChildren();
  if (!objects.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = 'Your layers will appear here.'; $('layers').append(empty); }
  [...objects].reverse().forEach((object, reverseIndex) => {
    const row = document.createElement('div'); row.className = 'list-item' + (selection.has(object.id) ? ' active' : '');
    const icon = document.createElement('span'); icon.className = 'layer-icon'; icon.textContent = ({ rect:'▭', ellipse:'◯', line:'╱', path:'⌁', text:'T', image:'▧',boolean:'◧' })[object.type];
    const button = document.createElement('button'); button.className = 'item-main'; button.textContent = object.type === 'text' ? object.text.slice(0, 28) : object.type.charAt(0).toUpperCase() + object.type.slice(1) + ' ' + (objects.length - reverseIndex);
    button.addEventListener('click', event => { choose(object.id,event.shiftKey); tool = 'select'; updateTools(); render(); });
    const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=selection.has(object.id);checkbox.setAttribute('aria-label','Select '+(object.type==='text'?object.text.slice(0,28):object.type+' '+(objects.length-reverseIndex)));checkbox.addEventListener('change',()=>{choose(object.id,true);tool='select';updateTools();render();});
    row.append(checkbox,icon, button); $('layers').append(row);
  });
  if (item) {
    $('rotation').value = Math.round((item.rotation || 0) * 10) / 10; $('opacity').value = Math.round((item.opacity ?? 1) * 100);
    for (const key of ['fillMode','fill','fill2','stroke','strokeWidth']) $(key).value = item[key];
    $('paintSettings').classList.toggle('hidden', item.type === 'image');$('geometry').classList.toggle('hidden', item.type === 'path'||item.type==='boolean');for(const key of ['fillMode','fill2','stroke','strokeWidth'])$(key).disabled=item.type==='boolean';
    $('sizeFields').classList.toggle('hidden', !['rect','ellipse','image'].includes(item.type));
    $('textFields').classList.toggle('hidden', item.type !== 'text');
    if (item.type !== 'path'&&item.type!=='boolean') { $('x').value = Math.round(item.x); $('y').value = Math.round(item.y); }
    if (['rect','ellipse','image'].includes(item.type)) { $('width').value = Math.round(item.width); $('height').value = Math.round(item.height); }
    if (item.type === 'text') { $('text').value = item.text; $('fontSize').value = item.fontSize; $('font').value = item.font; $('fontWeight').value=item.fontWeight||'normal';$('fontStyle').value=item.fontStyle||'normal';$('textAlign').value=item.textAlign||'left';$('lineHeight').value=item.lineHeight||1.2;$('letterSpacing').value=item.letterSpacing||0; }
  }
}
function updateTools() {
  document.querySelectorAll('[data-tool]').forEach(button => button.classList.toggle('active', button.dataset.tool === tool));
  $('penActions').classList.toggle('hidden', tool !== 'pen');
  const hints = { select:'Drag to move, or use the handles to resize and rotate. Hold Shift to keep proportions or snap rotation.', rect:'Drag to draw a rectangle.', ellipse:'Drag to draw an ellipse.', line:'Drag to draw a line.', text:'Click to add text, then change the words in Properties.', pen:'Click points; drag a point to bend its curve. Finish when ready.', nodes:'Select a path, then drag its points and handles.' };
  $('toolHint').textContent = hints[tool];
}
function point(event) {
  const rect = svg.getBoundingClientRect(); let x = (event.clientX - rect.left) / rect.width * 1000, y = (event.clientY - rect.top) / rect.height * 700;
  if ($('snap').checked) { x = Math.round(x / 10) * 10; y = Math.round(y / 10) * 10; }
  return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
}
function moveItem(item, dx, dy) {
  if(item.type==='boolean')for(const child of item.children)moveItem(child,dx,dy);
  else if (item.type === 'path') for (const p of item.points) { p.x += dx; p.y += dy; p.inX += dx; p.inY += dy; p.outX += dx; p.outY += dy; }
  else { item.x += dx; item.y += dy; if (item.type === 'line') { item.x2 += dx; item.y2 += dy; } }
  if (Number.isFinite(item.pivotX)) { item.pivotX += dx; item.pivotY += dy; }
}
function objectBounds(item){const node=objectNodes.get(item.id);if(!node)throw new Error('Object bounds are unavailable.');const box=node.getBBox(),root=svg.getScreenCTM(),screen=node.getScreenCTM();if(!root||!screen)throw new Error('Object bounds are unavailable.');const matrix=root.inverse().multiply(screen),points=[[box.x,box.y],[box.x+box.width,box.y],[box.x,box.y+box.height],[box.x+box.width,box.y+box.height]].map(([x,y])=>({x:matrix.a*x+matrix.c*y+matrix.e,y:matrix.b*x+matrix.d*y+matrix.f})),xs=points.map(p=>p.x),ys=points.map(p=>p.y);return {x:Math.min(...xs),y:Math.min(...ys),right:Math.max(...xs),bottom:Math.max(...ys)};}
function unionBounds(boxes){if(!boxes.length)throw new Error('Select an object first.');return {x:Math.min(...boxes.map(box=>box.x)),y:Math.min(...boxes.map(box=>box.y)),right:Math.max(...boxes.map(box=>box.right)),bottom:Math.max(...boxes.map(box=>box.bottom))};}
function snapTargets(){const x=[0,500,1000],y=[0,350,700];for(const item of objects){if(selection.has(item.id))continue;const b=objectBounds(item);x.push(b.x,(b.x+b.right)/2,b.right);y.push(b.y,(b.y+b.bottom)/2,b.bottom);}return {x,y};}
function snapMovement(box,targets,dx,dy){const closest=(values,candidates)=>{let best=null;for(const target of candidates)for(const value of values){const delta=target-value;if(Math.abs(delta)<=6&&(!best||Math.abs(delta)<Math.abs(best.delta)))best={delta,target};}return best;},x=closest([box.x+dx,(box.x+box.right)/2+dx,box.right+dx],targets.x),y=closest([box.y+dy,(box.y+box.bottom)/2+dy,box.bottom+dy],targets.y);return {dx:dx+(x?.delta||0),dy:dy+(y?.delta||0),guides:{x:x?.target??null,y:y?.target??null}};}
function arrange(action){const units=selectedUnits(),needed=['horizontal','vertical'].includes(action)?3:2;if(units.length<needed)throw new Error('Select at least '+needed+' separate objects or groups.');const entries=units.map(items=>({items,box:unionBounds(items.map(objectBounds))})),overall=unionBounds(entries.map(entry=>entry.box)),offsets=new Map();
  if(['horizontal','vertical'].includes(action)){const horizontal=action==='horizontal',start=horizontal?'x':'y',end=horizontal?'right':'bottom';entries.sort((a,b)=>(a.box[start]+a.box[end])-(b.box[start]+b.box[end]));const gap=(overall[end]-overall[start]-entries.reduce((total,entry)=>total+entry.box[end]-entry.box[start],0))/(entries.length-1);let cursor=overall[start];for(const entry of entries){offsets.set(entry,horizontal?{x:cursor-entry.box.x,y:0}:{x:0,y:cursor-entry.box.y});cursor+=entry.box[end]-entry.box[start]+gap;}}
  else for(const entry of entries){const b=entry.box,dx=action==='left'?overall.x-b.x:action==='right'?overall.right-b.right:action==='center'?(overall.x+overall.right-b.x-b.right)/2:0,dy=action==='top'?overall.y-b.y:action==='bottom'?overall.bottom-b.bottom:action==='middle'?(overall.y+overall.bottom-b.y-b.bottom)/2:0;if(!['left','right','center','top','bottom','middle'].includes(action))throw new Error('Unknown arrangement.');offsets.set(entry,{x:dx,y:dy});}
  change(()=>{for(const entry of entries){const delta=offsets.get(entry);for(const item of entry.items)moveItem(item,delta.x,delta.y);}});return {units:units.length,objects:selection.size};}
function groupSelection(){if(selectedUnits().length<2)throw new Error('Select at least two separate objects or groups.');const groupId=uid();change(()=>{for(const item of objects)if(selection.has(item.id))item.groupId=groupId;});return {group_id:groupId,objects:selection.size};}
function ungroupSelection(){if(!objects.some(item=>selection.has(item.id)&&item.groupId))throw new Error('Select a group first.');change(()=>{for(const item of objects)if(selection.has(item.id))delete item.groupId;});return {objects:selection.size};}
function booleanSelection(operation){if(!['union','intersect','subtract','exclude'].includes(operation))throw new Error('Unknown shape operation.');const indexes=objects.map((item,index)=>selection.has(item.id)?index:-1).filter(index=>index>=0);if(indexes.length!==2||indexes[1]!==indexes[0]+1)throw new Error('Select two adjacent layers for a shape operation.');const children=indexes.map(index=>objects[index]);if(children.some(item=>item.groupId||!['rect','ellipse','path'].includes(item.type)||item.type==='path'&&!item.closed||item.fillMode!=='solid'||item.strokeWidth!==0||(item.opacity??1)!==1))throw new Error('Use two ungrouped, solid closed shapes without outlines or transparency.');booleanBounds(children);const result={id:uid(),type:'boolean',operation,children:clone(children),fillMode:'solid',fill:children[0].fill,fill2:children[0].fill,stroke:'#000000',strokeWidth:0,opacity:1};change(()=>{objects.splice(indexes[0],2,result);selection=new Set([result.id]);selected=result.id;});return {result_id:result.id,operation};}
function releaseBoolean(){const item=selectedObject();if(selection.size!==1||item?.type!=='boolean')throw new Error('Select one combined shape first.');const children=clone(item.children),angle=(item.rotation||0)*Math.PI/180,cos=Math.cos(angle),sin=Math.sin(angle),px=item.pivotX||0,py=item.pivotY||0;for(const child of children){if(!angle)continue;const oldX=child.pivotX??0,oldY=child.pivotY??0,dx=oldX-px,dy=oldY-py,newX=px+dx*cos-dy*sin,newY=py+dx*sin+dy*cos,rotation=(child.rotation||0)+(item.rotation||0);if(Math.abs(rotation)>36000)throw new Error('Reduce rotation before releasing these shapes.');moveItem(child,newX-oldX,newY-oldY);child.pivotX=newX;child.pivotY=newY;child.rotation=rotation;}change(()=>{const index=objects.indexOf(item);objects.splice(index,1,...children);selection=new Set(children.map(child=>child.id));selected=children.at(-1).id;});return {released_ids:children.map(child=>child.id)};}
$('groupObjects').onclick=()=>{try{groupSelection();status('Selection grouped.');}catch(error){status(error.message,true);}};$('ungroupObjects').onclick=()=>{try{ungroupSelection();status('Selection ungrouped.');}catch(error){status(error.message,true);}};for(const button of document.querySelectorAll('[data-arrange]'))button.onclick=()=>{try{arrange(button.dataset.arrange);status('Selection arranged.');}catch(error){status(error.message,true);}};
for(const button of document.querySelectorAll('[data-boolean]'))button.onclick=()=>{try{booleanSelection(button.dataset.boolean);status('Shapes combined. Release them to edit the sources.');}catch(error){status(error.message,true);}};$('releaseBoolean').onclick=()=>{try{releaseBoolean();status('Original shapes released.');}catch(error){status(error.message,true);}};
function visibleProperties(item){const {id,type,groupId,data,children,points,...properties}=item;return properties;}
window.VectorOperations={
  inspect({id,index,includeNodes=false}={}){if(id!==undefined&&index!==undefined)throw new Error('Provide an object ID or index, not both.');if(includeNodes&&id===undefined&&index===undefined)throw new Error('Select one object when requesting path nodes.');const found=objects.map((item,i)=>({item,index:i})).filter(entry=>(id===undefined||entry.item.id===id)&&(index===undefined||entry.index===index));if((id!==undefined||index!==undefined)&&!found.length)throw new Error('The selected object was not found.');return found.map(({item,index})=>({index,id:item.id,type:item.type,...(item.groupId?{group_id:item.groupId}:{}),bounds:objectBounds(item),properties:visibleProperties(item),...(item.type==='path'?{node_count:item.points.length,...(includeNodes?{nodes:clone(item.points)}:{})}:{})}));},
  update({id,index,properties}){
    if((id===undefined)===(index===undefined))throw new Error('Provide one object ID or index.');
    const item=id===undefined?objects[index]:objects.find(value=>value.id===id);
    if(!item)throw new Error('The selected object was not found.');
    if(item.groupId)throw new Error('Ungroup the object before editing its properties.');
    if(!properties||typeof properties!=='object'||Array.isArray(properties)||!Object.keys(properties).length)throw new Error('Provide properties to update.');
    const allowed=['rotation','opacity',...(!['image'].includes(item.type)?['fill']:[]),...(!['image','boolean'].includes(item.type)?['fillMode','fill2','stroke','strokeWidth']:[]),...(!['path','boolean'].includes(item.type)?['x','y']:[]),...(['rect','ellipse','image'].includes(item.type)?['width','height']:[]),...(item.type==='line'?['x2','y2']:[]),...(item.type==='path'?['points','closed']:[]),...(item.type==='text'?['text','fontSize','font','fontWeight','fontStyle','textAlign','lineHeight','letterSpacing']:[])];
    for(const key of Object.keys(properties))if(!allowed.includes(key))throw new Error('Property '+key+' is not available for '+item.type+' objects.');
    const before=JSON.stringify(objects),oldUndo=undo.slice(),oldRedo=redo.slice(),previous=visibleProperties(item);
    try{
      selection=new Set([item.id]);selected=item.id;render();
      change(()=>{for(const [key,value] of Object.entries(properties))if(key!=='rotation')setProperty(item,key,clone(value));if(properties.rotation!==undefined){render();setProperty(item,'rotation',properties.rotation);}validateDocument({format:'vectorroom',version:1,objects});});
      return {object_id:item.id,changed:before!==JSON.stringify(objects),before:previous,after:visibleProperties(item),updated:Object.keys(properties)};
    }catch(error){objects=JSON.parse(before);undo=oldUndo;redo=oldRedo;render();throw error;}
  },
  apply({ids,indices,action,dx=0,dy=0,snap=false}){if((Array.isArray(ids)===Array.isArray(indices)))throw new Error('Provide object IDs or indices, not both.');const targets=ids||indices.map(index=>objects[index]?.id);if(!targets.length||targets.length>1000||new Set(targets).size!==targets.length||targets.some(id=>!objects.some(item=>item.id===id)))throw new Error('Invalid object selection.');selection.clear();for(const id of targets)for(const member of selectionUnit(id))selection.add(member);selected=targets.at(-1);render();const before=JSON.stringify(objects),oldUndo=undo.slice(),oldRedo=redo.slice();let details={};try{if(action==='group')details=groupSelection();else if(action==='ungroup')details=ungroupSelection();else if(['union','intersect','subtract','exclude'].includes(action))details=booleanSelection(action);else if(action==='release')details=releaseBoolean();else if(action==='move'){if(!Number.isFinite(dx)||!Number.isFinite(dy)||Math.abs(dx)>100000||Math.abs(dy)>100000)throw new Error('Invalid move distance.');if(snap){const box=unionBounds(objects.filter(item=>selection.has(item.id)).map(objectBounds)),result=snapMovement(box,snapTargets(),dx,dy);dx=result.dx;dy=result.dy;details.guides=result.guides;}change(()=>{for(const item of objects)if(selection.has(item.id))moveItem(item,dx,dy);});details.dx=dx;details.dy=dy;}else details=arrange(action);validateDocument({format:'vectorroom',version:1,objects});return {action,changed:before!==JSON.stringify(objects),selected_ids:[...selection],...details};}catch(error){objects=JSON.parse(before);undo=oldUndo;redo=oldRedo;render();throw error;}}
};
function ensurePivot(item) {
  if (Number.isFinite(item.pivotX) && Number.isFinite(item.pivotY)) return;
  const group = objectNodes.get(item.id);
  const box = group.getBBox(); item.pivotX = box.x + box.width / 2; item.pivotY = box.y + box.height / 2; item.rotation ??= 0;
}
function setProperty(item,key,value){
  if(key==='rotation')ensurePivot(item);
  if((key==='width'||key==='height')&&Number.isFinite(item.pivotX))item[key==='width'?'pivotX':'pivotY']+=(value-item[key])/2;
  if((key==='x'||key==='y')&&Number.isFinite(item.pivotX))item[key==='x'?'pivotX':'pivotY']+=value-item[key];
  if(item.type==='line'&&(key==='x'||key==='y'))item[key+'2']+=value-item[key];
  item[key]=value;
}
function localPoint(item, p) {
  if (!item.rotation || !Number.isFinite(item.pivotX)) return p;
  const a = -item.rotation * Math.PI / 180, dx = p.x - item.pivotX, dy = p.y - item.pivotY;
  return {x:item.pivotX + dx*Math.cos(a) - dy*Math.sin(a), y:item.pivotY + dx*Math.sin(a) + dy*Math.cos(a)};
}
function resizeItem(item,box,sx,sy) {
  const x=v=>box.x+(v-box.x)*sx,y=v=>box.y+(v-box.y)*sy;
  if(item.type==='text'){const size=Math.max(8,Math.min(400,item.fontSize*sx));sx=sy=size/item.fontSize;item.x=x(item.x);item.y=y(item.y);item.fontSize=size;}
  else if(item.type==='path')for(const p of item.points){p.x=x(p.x);p.y=y(p.y);p.inX=x(p.inX);p.inY=y(p.inY);p.outX=x(p.outX);p.outY=y(p.outY);}
  else {item.x=x(item.x);item.y=y(item.y);if(item.type==='line'){item.x2=x(item.x2);item.y2=y(item.y2);}else{item.width=Math.max(.01,item.width*sx);item.height=Math.max(.01,item.height*sy);}}
  return {sx,sy};
}
document.querySelectorAll('[data-tool]').forEach(button => button.addEventListener('click', () => {
  if (draft && button.dataset.tool !== 'pen') { draft = null; status('Unfinished path discarded.'); }
  tool = button.dataset.tool; updateTools(); render();
}));
svg.addEventListener('pointerdown', event => {
  if (!event.isPrimary || event.button !== 0 || gesture) return;
  const p = point(event), before = JSON.stringify(objects);
  if (tool === 'pen') {
    if (!draft) draft = { ...style('path'), points: [], closed: false };
    draft.points.push({ x:p.x, y:p.y, inX:p.x, inY:p.y, outX:p.x, outY:p.y });
    gesture = { mode:'pen', start:p, index:draft.points.length - 1 }; svg.setPointerCapture(event.pointerId); render(); return;
  }
  const action = event.target.dataset.action;
  if (tool === 'select' && action === 'resize' && selectedObject()) {
    const item=selectedObject(),group=objectNodes.get(item.id),b=group.getBBox(),box={x:b.x,y:b.y,width:b.width,height:b.height};
    ensurePivot(item); gesture={mode:'resize',before,box,start:localPoint(item,p),original:clone(item)};svg.setPointerCapture(event.pointerId);return;
  }
  if (tool === 'select' && action === 'rotate' && selectedObject()) {
    const item = selectedObject(); ensurePivot(item);
    gesture = { mode:'rotate', before, original:clone(item), angle:Math.atan2(p.y-item.pivotY,p.x-item.pivotX) }; svg.setPointerCapture(event.pointerId); return;
  }
  if (tool === 'nodes' && action && selectedObject()?.type === 'path') {
    gesture = { mode:action, index:Number(event.target.dataset.index), start:localPoint(selectedObject(),p), before, original:clone(selectedObject()) }; svg.setPointerCapture(event.pointerId); return;
  }
  const group = event.target.closest('g[data-id]');
  if (tool === 'select' || tool === 'nodes') {
    const id=group?.dataset.id||null;if(!id||event.shiftKey||!selection.has(id)||tool==='nodes')choose(id,tool==='select'&&event.shiftKey);render();
    if (id&&selection.has(id)&&tool==='select') { const originals=objects.filter(item=>selection.has(item.id)).map(clone),box=$('snapGuides').checked?unionBounds(originals.map(objectBounds)):null,targets=box?snapTargets():null;gesture={mode:'move',start:p,before,originals,box,targets};svg.setPointerCapture(event.pointerId); }
    return;
  }
  if (tool === 'text') {
    change(() => { const item = { ...style('text'), x:p.x, y:p.y, text:'Hello there', fontSize:56, font:'sans-serif' }; item.fill = '#302a3e'; objects.push(item); selected = item.id; });
    tool = 'select'; updateTools(); render(); return;
  }
  const item = { ...style(tool), x:p.x, y:p.y, width:1, height:1, x2:p.x, y2:p.y };
  objects.push(item); selected = item.id; gesture = { mode:'draw', start:p, before }; svg.setPointerCapture(event.pointerId); render();
});
svg.addEventListener('pointermove', event => {
  if (!gesture) return; const p = point(event);
  if (gesture.mode === 'pen') {
    const a = draft.points[gesture.index]; a.outX = p.x; a.outY = p.y; a.inX = a.x - (p.x - a.x); a.inY = a.y - (p.y - a.y); render(); return;
  }
  const item = selectedObject(); if (!item) return;
  if (gesture.mode === 'draw') {
    item.x = Math.min(gesture.start.x, p.x); item.y = Math.min(gesture.start.y, p.y);
    item.width = Math.max(1, Math.abs(p.x - gesture.start.x)); item.height = Math.max(1, Math.abs(p.y - gesture.start.y));
    if (item.type === 'line') { item.x = gesture.start.x; item.y = gesture.start.y; item.x2 = p.x; item.y2 = p.y; }
  } else if (gesture.mode === 'move') {
    let dx=p.x-gesture.start.x,dy=p.y-gesture.start.y;if(gesture.box){const snapped=snapMovement(gesture.box,gesture.targets,dx,dy);dx=snapped.dx;dy=snapped.dy;guides=snapped.guides;}for(const original of gesture.originals){const index=objects.findIndex(object=>object.id===original.id);if(index<0)continue;objects[index]=clone(original);moveItem(objects[index],dx,dy);}
  } else if (gesture.mode === 'resize') {
    const index=objects.findIndex(object=>object.id===selected),original=gesture.original,local=localPoint(original,p),box=gesture.box;
    let sx=box.width>0?Math.max(.01,1+(local.x-gesture.start.x)/box.width):1,sy=box.height>0?Math.max(.01,1+(local.y-gesture.start.y)/box.height):1;
    if(event.shiftKey||original.type==='text'){const scale=Math.abs(sx-1)>=Math.abs(sy-1)?sx:sy;sx=sy=scale;}
    const resized=objects[index]=clone(original),scale=resizeItem(resized,box,sx,sy),center={x:box.x+box.width*scale.sx/2,y:box.y+box.height*scale.sy/2},a=(original.rotation||0)*Math.PI/180,dx=center.x-original.pivotX,dy=center.y-original.pivotY;
    const tx=dx*Math.cos(a)-dy*Math.sin(a)-dx,ty=dx*Math.sin(a)+dy*Math.cos(a)-dy;moveItem(resized,tx,ty);resized.pivotX=center.x+tx;resized.pivotY=center.y+ty;
  } else if (gesture.mode === 'rotate') {
    let angle = (gesture.original.rotation || 0) + (Math.atan2(p.y-item.pivotY,p.x-item.pivotX)-gesture.angle)*180/Math.PI;
    if (event.shiftKey) angle = Math.round(angle / 15) * 15;
    item.rotation = Math.round(angle * 10) / 10;
  } else {
    const local = localPoint(gesture.original,p), node = item.points[gesture.index], original = gesture.original.points[gesture.index], dx = local.x - gesture.start.x, dy = local.y - gesture.start.y;
    if (gesture.mode === 'node') { node.x = original.x + dx; node.y = original.y + dy; node.inX = original.inX + dx; node.inY = original.inY + dy; node.outX = original.outX + dx; node.outY = original.outY + dy; }
    else { node[gesture.mode + 'X'] = local.x; node[gesture.mode + 'Y'] = local.y; }
  }
  render();
});
svg.addEventListener('pointerup', () => {
  if (!gesture) return;
  if (gesture.mode !== 'pen') {
    const item = selectedObject();
    if (gesture.mode === 'draw' && item && ((item.type === 'line' && item.x === item.x2 && item.y === item.y2) || (item.type !== 'line' && item.width <= 1 && item.height <= 1))) { objects = JSON.parse(gesture.before); selected = null; }
    saveUndo(gesture.before);
  }
  gesture = null;guides=null; render();
});
svg.addEventListener('pointercancel', () => { if (!gesture) return; if (gesture.before) objects = JSON.parse(gesture.before); else if (draft) draft.points.pop(); gesture = null;guides=null; render(); });
function finishPath(close) {
  if (!draft || draft.points.length < 2) return status('Add at least two points to the path.', true);
  const before = JSON.stringify(objects); draft.closed = close; if (close) draft.fillMode = 'solid';
  objects.push(draft); selected = draft.id; draft = null; saveUndo(before); tool = 'select'; updateTools(); render(); status('Path created. Use Edit nodes to adjust its points and handles.');
}
$('finishPath').addEventListener('click', () => finishPath(false)); $('closePath').addEventListener('click', () => finishPath(true));
$('cancelPath').addEventListener('click', () => { draft = null; render(); status('Path cancelled.'); });
$('delete').addEventListener('click', () => { change(() => { objects = objects.filter(item => !selection.has(item.id)); selection.clear();selected = null; }); });
$('duplicate').addEventListener('click', () => { const items=objects.filter(item=>selection.has(item.id));if(!items.length||objects.length+items.length>1000)return;change(()=>{const groups=new Map(),copies=items.map(item=>{const copy=clone(item);copy.id=uid();if(copy.type==='boolean')for(const child of copy.children)child.id=uid();if(copy.groupId){if(!groups.has(copy.groupId))groups.set(copy.groupId,uid());copy.groupId=groups.get(copy.groupId);}moveItem(copy,20,20);return copy;});objects.push(...copies);selection=new Set(copies.map(item=>item.id));selected=copies.at(-1).id;}); });
$('raise').addEventListener('click', () => change(() => {for(let i=objects.length-2;i>=0;i--)if(selection.has(objects[i].id)&&!selection.has(objects[i+1].id))[objects[i],objects[i+1]]=[objects[i+1],objects[i]];}));
$('lower').addEventListener('click', () => change(() => {for(let i=1;i<objects.length;i++)if(selection.has(objects[i].id)&&!selection.has(objects[i-1].id))[objects[i],objects[i-1]]=[objects[i-1],objects[i]];}));
$('undo').addEventListener('click', () => { if (!undo.length) return; redo.push(JSON.stringify(objects)); objects = JSON.parse(undo.pop()); if (!selectedObject()) selected = null; draft = null; render(); status('Edit undone.'); });
$('redo').addEventListener('click', () => { if (!redo.length) return; undo.push(JSON.stringify(objects)); objects=JSON.parse(redo.pop()); if (!selectedObject()) selected=null; draft=null; render(); status('Edit restored.'); });
for (const key of ['fillMode','fill','fill2','stroke','strokeWidth','x','y','width','height','text','fontSize','font','fontWeight','fontStyle','textAlign','lineHeight','letterSpacing','rotation','opacity']) $(key).addEventListener('change', () => {
  const item = selectedObject(); if (!item) return;
  change(() => {
    if (['strokeWidth','x','y','width','height','fontSize','lineHeight','letterSpacing','rotation','opacity'].includes(key)) {
      let value = Number($(key).value); if (!Number.isFinite(value)) return;
      if (key === 'rotation') value = Math.max(-36000,Math.min(36000,value));
      if (key === 'opacity') value = Math.max(0,Math.min(100,value)) / 100;
      if (key === 'strokeWidth') value = Math.max(0, Math.min(100, value));
      if (key === 'fontSize') value = Math.max(8, Math.min(400, value));
      if (key === 'lineHeight') value = Math.max(.8, Math.min(3, value));
      if (key === 'letterSpacing') value = Math.max(-5, Math.min(30, value));
      if (key === 'width' || key === 'height') value = Math.max(1, value);
      setProperty(item,key,value);
    } else setProperty(item,key,key === 'text' ? $(key).value.slice(0, 500) : $(key).value);
  });
});
function download(blob, name) { const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
function exportedSvg() {
  const copy = svg.cloneNode(true); copy.querySelectorAll('.controls').forEach(node => node.remove()); copy.setAttribute('xmlns', NS);
  if (draft) [...copy.querySelectorAll('g[data-id]')].filter(node => node.dataset.id === draft.id).forEach(node => node.remove());
  return new Blob([new XMLSerializer().serializeToString(copy)], { type:'image/svg+xml' });
}
function pngBlob() {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(exportedSvg()), image = new Image();
    image.onload = () => { const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 700; canvas.getContext('2d').drawImage(image,0,0); URL.revokeObjectURL(url); canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG export failed.')), 'image/png'); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not render this artwork.')); }; image.src = url;
  });
}
$('exportSvg').addEventListener('click', () => { download(exportedSvg(), 'vectorroom-artwork.svg'); status('SVG exported.'); });
$('exportPng').addEventListener('click', async () => { try { download(await pngBlob(), 'vectorroom-artwork.png'); status('PNG exported.'); } catch (error) { status(error.message, true); } });
$('send').addEventListener('click', async () => {
  try { $('send').disabled = true; const blob = await pngBlob(); await RoomHandoff.send(blob, 'vectorroom-artwork.png', 5, $('status'), $('openCliproom')); }
  catch (error) { status(error.message, true); } finally { $('send').disabled = false; }
});
$('save').addEventListener('click', () => { download(new Blob([JSON.stringify({ format:'vectorroom', version:1, objects })], { type:'application/json' }), 'artwork.vectorroom'); status('Project saved.'); });
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
async function openProjectFile(file) {
  if (!file) return;
  try { if (file.size > 32 * 1024 * 1024) throw new Error('Project file is too large.'); const next = validateDocument(JSON.parse(await file.text())); change(() => { objects = next; selected = null; draft = null; }); status('Project opened.'); }
  catch (error) { status('Could not open project: ' + error.message, true); }
}
async function openVectorFile(file){if(!file)return;if(!file.type.startsWith('image/'))return openProjectFile(file);try{
  if(file.size>20*1024*1024)throw new Error('Images must be 20 MB or smaller.');const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Could not read the image.'));reader.readAsDataURL(file);});
  if(!/^data:image\/(png|jpeg|webp|gif|avif);base64,/i.test(data))throw new Error('Choose a PNG, JPEG, WebP, GIF or AVIF image.');const image=new Image();image.src=data;await image.decode();const scale=Math.min(1000/image.naturalWidth,700/image.naturalHeight),width=image.naturalWidth*scale,height=image.naturalHeight*scale;
  change(()=>{const item={...style('image'),x:(1000-width)/2,y:(700-height)/2,width,height,data};objects.push(item);selected=item.id;});status('Image added as a flattened layer.');
  }catch(error){status('Could not open image: '+error.message,true);}}
$('openProject').addEventListener('change', async event => { const file=event.target.files[0];event.target.value='';await openVectorFile(file); });
$('openSharedVector').addEventListener('click',async()=>{try{const file=await RoomShared.choose(['.vectorroom','image/*']);if(file)await openVectorFile(file);}catch(e){status(e.message,true);}});
$('fetchPaint').addEventListener('click', async () => {
  const root=$('paintProjects'), message=$('paintProjectsStatus'); root.replaceChildren(); message.textContent='Loading saved artwork…'; $('paintProjectsDialog').showModal();
  try {
    const response=await fetch('/api/paint/projects'); if (!response.ok) throw new Error('Could not load PaintRoom projects.');
    const data=await response.json(); message.textContent=data.projects.length ? 'Choose a saved project to add its editable objects.' : 'No saved PaintRoom projects yet.';
    for (const entry of data.projects) {
      const button=document.createElement('button'); button.className='btn block paint-project'; button.textContent=entry.name;
      button.addEventListener('click', async () => {
        try {
          button.disabled=true; message.textContent='Fetching artwork…';
          const response=await fetch('/api/paint/projects/'+encodeURIComponent(entry.id)); if(!response.ok) throw new Error('Could not read this project.');
          const project=await response.json(), converted=validateDocument(PaintModel.toVector(project.state));
          if(objects.length+converted.length>1000) throw new Error('Adding these objects would exceed the 1,000 object limit.');
          change(()=>{objects.push(...converted); selected=converted.at(-1)?.id||null;}); $('paintProjectsDialog').close();
          status(`Added ${converted.length} editable object(s) from ${entry.name}.`);
        } catch(error) { message.textContent=error.message; } finally { button.disabled=false; }
      }); root.append(button);
    }
  } catch(error) { message.textContent=error.message; }
});
$('closePaintProjects').addEventListener('click', ()=>$('paintProjectsDialog').close());
$('saveSharedVector').addEventListener('click',async()=>{try{const path=await RoomShared.save(await pngBlob(),'vectorroom-artwork.png');if(path)status('Saved to shared files: '+path);}catch(e){status(e.message,true);}});
$('saveSharedVectorProject').addEventListener('click',async()=>{try{const path=await RoomShared.save(new Blob([JSON.stringify({format:'vectorroom',version:1,objects})],{type:'application/json'}),'artwork.vectorroom');if(path)status('Saved to shared files: '+path);}catch(e){status(e.message,true);}});
(async()=>{try{const file=await RoomShared.fromQuery();if(file)await openVectorFile(file);}catch(e){status(e.message,true);}})();
document.addEventListener('keydown', event => {
  if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); $(event.shiftKey?'redo':'undo').click(); }
  else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); $('redo').click(); }
  else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') { event.preventDefault(); $('duplicate').click(); }
  else if (selected && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) { event.preventDefault(); const step=event.shiftKey?10:1; change(()=>{for(const item of objects)if(selection.has(item.id))moveItem(item,event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0,event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0);}); }
  else if (event.key === 'Delete' && selected) $('delete').click();
  else if (event.key === 'Enter' && tool === 'pen' && draft) finishPath(false);
  else if (event.key === 'Escape' && draft) { draft = null; render(); }
});
window.addEventListener('beforeunload', event => { if (objects.length || draft) { event.preventDefault(); event.returnValue = ''; } });
updateTools(); render();
