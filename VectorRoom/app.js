'use strict';
const $ = id => document.getElementById(id);
const svg = $('artboard'), NS = 'http://www.w3.org/2000/svg';
const uid = () => crypto.randomUUID();
const clone = value => structuredClone(value);
let objects = [], selected = null, tool = 'select', draft = null, gesture = null, undo = [], redo = [];
function status(text, error = false) { $('status').textContent = text; $('status').classList.toggle('error', error); }
function el(name, attrs = {}) { const node = document.createElementNS(NS, name); for (const [key,value] of Object.entries(attrs)) node.setAttribute(key, String(value)); return node; }
function saveUndo(before) { if (before === JSON.stringify(objects)) return; undo.push(before); if (undo.length > 60) undo.shift(); redo = []; }
function change(fn) { const before = JSON.stringify(objects); fn(); saveUndo(before); render(); }
function selectedObject() { return objects.find(item => item.id === selected); }
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
function createObject(item, defs) {
  const g = el('g', { 'data-id': item.id }); let shape;
  if (item.opacity !== undefined) g.setAttribute('opacity', item.opacity);
  if (item.rotation && Number.isFinite(item.pivotX) && Number.isFinite(item.pivotY)) g.setAttribute('transform', `rotate(${item.rotation} ${item.pivotX} ${item.pivotY})`);
  const colors = paint(item, defs);
  if (item.type === 'rect') shape = el('rect', { x: item.x, y: item.y, width: item.width, height: item.height, ...colors });
  if (item.type === 'ellipse') shape = el('ellipse', { cx: item.x + item.width / 2, cy: item.y + item.height / 2, rx: item.width / 2, ry: item.height / 2, ...colors });
  if (item.type === 'line') shape = el('line', { x1: item.x, y1: item.y, x2: item.x2, y2: item.y2, ...colors, fill: 'none' });
  if (item.type === 'path') shape = el('path', { d: pathData(item.points, item.closed), ...colors });
  if (item.type === 'image') shape = el('image', { x:item.x, y:item.y, width:item.width, height:item.height, href:item.data, preserveAspectRatio:'none' });
  if (item.type === 'text') { shape = el('text', { x: item.x, y: item.y, 'font-size': item.fontSize, 'font-family': item.font, ...colors }); shape.textContent = item.text; }
  if (shape) g.append(shape);
  return g;
}
function render() {
  svg.replaceChildren(); const defs = el('defs'); svg.append(defs);
  for (const item of objects) svg.append(createObject(item, defs));
  if (draft) svg.append(createObject(draft, defs));
  const item = selectedObject();
  if (item) {
    const group = [...svg.querySelectorAll('g[data-id]')].find(node => node.dataset.id === item.id);
    if (group) {
      try {
        const box = group.getBBox(), controls = el('g', { class: 'controls' });
        if (group.hasAttribute('transform')) controls.setAttribute('transform', group.getAttribute('transform'));
        controls.append(el('rect', { x: box.x - 5, y: box.y - 5, width: Math.max(10, box.width + 10), height: Math.max(10, box.height + 10), fill: 'none', stroke: '#8067e5', 'stroke-width': 2, 'stroke-dasharray': '6 5', class: 'art-outline' }));
        if (tool === 'select') {
          const cx = box.x + box.width / 2, y = box.y - 28;
          controls.append(el('line', { x1:cx, y1:box.y-5, x2:cx, y2:y, stroke:'#8067e5', 'stroke-width':2, class:'art-outline' }));
          controls.append(el('circle', { cx, cy:y, r:8, fill:'#fff', stroke:'#8067e5', 'stroke-width':2, 'data-action':'rotate', class:'art-control' }));
          controls.append(el('rect', { x:box.x+box.width-7, y:box.y+box.height-7, width:14, height:14, fill:'#fff', stroke:'#8067e5', 'stroke-width':2, 'data-action':'resize', class:'art-control' }));
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
  $('undo').disabled = !undo.length;
  $('redo').disabled = !redo.length;
  for (const id of ['delete','raise','lower','duplicate']) $(id).disabled = !item;
  $('properties').classList.toggle('hidden', !item); $('inspectorHint').classList.toggle('hidden', !!item);
  $('selectionInfo').textContent = item ? 'Selected ' + item.type + ' · Drag to move or edit its properties.' : 'Choose a tool to get started.';
  $('layers').replaceChildren();
  if (!objects.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = 'Your layers will appear here.'; $('layers').append(empty); }
  [...objects].reverse().forEach((object, reverseIndex) => {
    const row = document.createElement('div'); row.className = 'list-item' + (selected === object.id ? ' active' : '');
    const icon = document.createElement('span'); icon.className = 'layer-icon'; icon.textContent = ({ rect:'▭', ellipse:'◯', line:'╱', path:'⌁', text:'T', image:'▧' })[object.type];
    const button = document.createElement('button'); button.className = 'item-main'; button.textContent = object.type === 'text' ? object.text.slice(0, 28) : object.type.charAt(0).toUpperCase() + object.type.slice(1) + ' ' + (objects.length - reverseIndex);
    button.addEventListener('click', () => { selected = object.id; tool = 'select'; updateTools(); render(); });
    row.append(icon, button); $('layers').append(row);
  });
  if (item) {
    $('rotation').value = Math.round((item.rotation || 0) * 10) / 10; $('opacity').value = Math.round((item.opacity ?? 1) * 100);
    for (const key of ['fillMode','fill','fill2','stroke','strokeWidth']) $(key).value = item[key];
    $('paintSettings').classList.toggle('hidden', item.type === 'image');$('geometry').classList.toggle('hidden', item.type === 'path');
    $('sizeFields').classList.toggle('hidden', !['rect','ellipse','image'].includes(item.type));
    $('textFields').classList.toggle('hidden', item.type !== 'text');
    if (item.type !== 'path') { $('x').value = Math.round(item.x); $('y').value = Math.round(item.y); }
    if (['rect','ellipse','image'].includes(item.type)) { $('width').value = Math.round(item.width); $('height').value = Math.round(item.height); }
    if (item.type === 'text') { $('text').value = item.text; $('fontSize').value = item.fontSize; $('font').value = item.font; }
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
  if (item.type === 'path') for (const p of item.points) { p.x += dx; p.y += dy; p.inX += dx; p.inY += dy; p.outX += dx; p.outY += dy; }
  else { item.x += dx; item.y += dy; if (item.type === 'line') { item.x2 += dx; item.y2 += dy; } }
  if (Number.isFinite(item.pivotX)) { item.pivotX += dx; item.pivotY += dy; }
}
function ensurePivot(item) {
  if (Number.isFinite(item.pivotX) && Number.isFinite(item.pivotY)) return;
  const group = [...svg.querySelectorAll('g[data-id]')].find(node => node.dataset.id === item.id);
  const box = group.getBBox(); item.pivotX = box.x + box.width / 2; item.pivotY = box.y + box.height / 2; item.rotation ??= 0;
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
    const item=selectedObject(),group=[...svg.querySelectorAll('g[data-id]')].find(node=>node.dataset.id===item.id),b=group.getBBox(),box={x:b.x,y:b.y,width:b.width,height:b.height};
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
    selected = group ? group.dataset.id : null; render();
    if (selected && tool === 'select') { gesture = { mode:'move', start:p, before, original:clone(selectedObject()) }; svg.setPointerCapture(event.pointerId); }
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
    const index = objects.findIndex(object => object.id === selected); objects[index] = clone(gesture.original);
    moveItem(objects[index], p.x - gesture.start.x, p.y - gesture.start.y);
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
  gesture = null; render();
});
svg.addEventListener('pointercancel', () => { if (!gesture) return; if (gesture.before) objects = JSON.parse(gesture.before); else if (draft) draft.points.pop(); gesture = null; render(); });
function finishPath(close) {
  if (!draft || draft.points.length < 2) return status('Add at least two points to the path.', true);
  const before = JSON.stringify(objects); draft.closed = close; if (close) draft.fillMode = 'solid';
  objects.push(draft); selected = draft.id; draft = null; saveUndo(before); tool = 'select'; updateTools(); render(); status('Path created. Use Edit nodes to adjust its points and handles.');
}
$('finishPath').addEventListener('click', () => finishPath(false)); $('closePath').addEventListener('click', () => finishPath(true));
$('cancelPath').addEventListener('click', () => { draft = null; render(); status('Path cancelled.'); });
$('delete').addEventListener('click', () => { change(() => { objects = objects.filter(item => item.id !== selected); selected = null; }); });
$('duplicate').addEventListener('click', () => { const item=selectedObject(); if (!item || objects.length >= 1000) return; change(() => { const copy=clone(item); copy.id=uid(); moveItem(copy,20,20); objects.splice(objects.indexOf(item)+1,0,copy); selected=copy.id; }); });
$('raise').addEventListener('click', () => change(() => { const i = objects.findIndex(o => o.id === selected); if (i >= 0 && i < objects.length - 1) [objects[i],objects[i + 1]] = [objects[i + 1],objects[i]]; }));
$('lower').addEventListener('click', () => change(() => { const i = objects.findIndex(o => o.id === selected); if (i > 0) [objects[i],objects[i - 1]] = [objects[i - 1],objects[i]]; }));
$('undo').addEventListener('click', () => { if (!undo.length) return; redo.push(JSON.stringify(objects)); objects = JSON.parse(undo.pop()); if (!selectedObject()) selected = null; draft = null; render(); status('Edit undone.'); });
$('redo').addEventListener('click', () => { if (!redo.length) return; undo.push(JSON.stringify(objects)); objects=JSON.parse(redo.pop()); if (!selectedObject()) selected=null; draft=null; render(); status('Edit restored.'); });
for (const key of ['fillMode','fill','fill2','stroke','strokeWidth','x','y','width','height','text','fontSize','font','rotation','opacity']) $(key).addEventListener('change', () => {
  const item = selectedObject(); if (!item) return;
  change(() => {
    if (['strokeWidth','x','y','width','height','fontSize','rotation','opacity'].includes(key)) {
      let value = Number($(key).value); if (!Number.isFinite(value)) return;
      if (key === 'rotation') { ensurePivot(item); value = Math.max(-36000,Math.min(36000,value)); }
      if (key === 'opacity') value = Math.max(0,Math.min(100,value)) / 100;
      if (key === 'strokeWidth') value = Math.max(0, Math.min(100, value));
      if (key === 'fontSize') value = Math.max(8, Math.min(400, value));
      if (key === 'width' || key === 'height') value = Math.max(1, value);
      if ((key === 'width' || key === 'height') && Number.isFinite(item.pivotX)) item[key === 'width' ? 'pivotX' : 'pivotY'] += (value-item[key])/2;
      if ((key === 'x' || key === 'y') && Number.isFinite(item.pivotX)) item[key === 'x' ? 'pivotX' : 'pivotY'] += value-item[key];
      if (item.type === 'line' && (key === 'x' || key === 'y')) { const delta = value - item[key]; item[key + '2'] += delta; }
      item[key] = value;
    } else item[key] = key === 'text' ? $(key).value.slice(0, 500) : $(key).value;
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
  const num = v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 100000;
  return doc.objects.map(object => {
    if (!object || !['rect','ellipse','line','path','text','image'].includes(object.type) || !['none','solid','gradient'].includes(object.fillMode) || !color(object.fill) || !color(object.fill2) || !color(object.stroke) || !num(object.strokeWidth) || object.strokeWidth < 0 || object.strokeWidth > 100) throw new Error('A project object is invalid.');
    const item = { id:uid(), type:object.type, fillMode:object.fillMode, fill:object.fill, fill2:object.fill2, stroke:object.stroke, strokeWidth:object.strokeWidth };
    if (object.opacity !== undefined) { if (!num(object.opacity) || object.opacity < 0 || object.opacity > 1) throw new Error('Object opacity is invalid.'); item.opacity=object.opacity; }
    if (object.rotation !== undefined || object.pivotX !== undefined || object.pivotY !== undefined) {
      if (!num(object.rotation) || !num(object.pivotX) || !num(object.pivotY) || Math.abs(object.rotation)>36000) throw new Error('Object rotation is invalid.');
      item.rotation=object.rotation; item.pivotX=object.pivotX; item.pivotY=object.pivotY;
    }
    if (item.type === 'path') {
      if (!Array.isArray(object.points) || object.points.length < 2 || object.points.length > 5000) throw new Error('A path is invalid.');
      item.points = object.points.map(p => { if (!p || !['x','y','inX','inY','outX','outY'].every(key => num(p[key]))) throw new Error('A path point is invalid.'); return { x:p.x,y:p.y,inX:p.inX,inY:p.inY,outX:p.outX,outY:p.outY }; }); item.closed = !!object.closed;
    } else {
      if (!num(object.x) || !num(object.y)) throw new Error('An object position is invalid.'); item.x = object.x; item.y = object.y;
      if (['rect','ellipse','image'].includes(item.type)) { if (!num(object.width) || !num(object.height) || object.width <= 0 || object.height <= 0) throw new Error('An object size is invalid.'); item.width = object.width; item.height = object.height; }
      if(item.type==='image'){if(typeof object.data!=='string'||object.data.length>28*1024*1024||!/^data:image\/(png|jpeg|webp|gif|avif);base64,[a-z0-9+/=]+$/i.test(object.data))throw new Error('An embedded image is invalid.');item.data=object.data;}
      if (item.type === 'line') { if (!num(object.x2) || !num(object.y2)) throw new Error('A line is invalid.'); item.x2 = object.x2; item.y2 = object.y2; }
      if (item.type === 'text') { if (typeof object.text !== 'string' || object.text.length > 500 || !num(object.fontSize) || object.fontSize < 8 || object.fontSize > 400 || !['sans-serif','serif','monospace'].includes(object.font)) throw new Error('Text is invalid.'); item.text = object.text; item.fontSize = object.fontSize; item.font = object.font; }
    }
    return item;
  });
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
  else if (selected && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) { event.preventDefault(); const step=event.shiftKey?10:1; change(()=>moveItem(selectedObject(),event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0,event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0)); }
  else if (event.key === 'Delete' && selected) $('delete').click();
  else if (event.key === 'Enter' && tool === 'pen' && draft) finishPath(false);
  else if (event.key === 'Escape' && draft) { draft = null; render(); }
});
window.addEventListener('beforeunload', event => { if (objects.length || draft) { event.preventDefault(); event.returnValue = ''; } });
updateTools(); render();
