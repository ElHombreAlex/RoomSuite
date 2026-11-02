'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),model=require('../PaintRoom/model.js');

test('pressure strokes validate consistently and remain explicit in SVG and vector handoff',()=>{
  const project=model.empty(()=> 'layer','Pressure',200,140),stroke={id:'pen',type:'stroke',points:[{x:30,y:70,pressure:.1},{x:170,y:70,pressure:1}],color:'#ff0000',width:40,opacity:.4,erase:false};project.layers[0].objects.push(stroke);
  assert.doesNotThrow(()=>model.validate(project));assert.match(model.svg(project),/stroke="none" fill="#ff0000"/);assert.throws(()=>model.toVector(project),/Pressure-sensitive/);
  const partial=structuredClone(project);delete partial.layers[0].objects[0].points[1].pressure;assert.throws(()=>model.validate(partial),/Pressure/);
  const invalid=structuredClone(project);invalid.layers[0].objects[0].points[0].pressure=1.01;assert.throws(()=>model.validate(invalid),/pressure/i);
  const legacy=structuredClone(project);for(const p of legacy.layers[0].objects[0].points)delete p.pressure;assert.doesNotThrow(()=>model.validate(legacy));assert.match(model.svg(legacy),/fill="none"/);
});

test('symmetry reflects around canvas axes even for translated, rotated and scaled layers',()=>{
  const project=model.empty(()=> 'layer','Mirror',200,140),layer=project.layers[0];Object.assign(layer,{x:12,y:-9,scale:1.3,rotation:27,pivotX:80,pivotY:75});
  const point={x:42,y:48,pressure:.35},copies=model.mirrorStrokePoints([point],project,layer,'both');assert.equal(copies.length,4);assert.ok(copies.every(items=>items[0].pressure===.35));
  const world=p=>{const a=layer.rotation*Math.PI/180,x=(p.x-layer.pivotX)*layer.scale,y=(p.y-layer.pivotY)*layer.scale;return {x:layer.pivotX+layer.x+x*Math.cos(a)-y*Math.sin(a),y:layer.pivotY+layer.y+x*Math.sin(a)+y*Math.cos(a)};};
  const source=world(point),expected=[[source.x,source.y],[200-source.x,source.y],[source.x,140-source.y],[200-source.x,140-source.y]];copies.forEach((items,i)=>{const actual=world(items[0]);assert.ok(Math.abs(actual.x-expected[i][0])<1e-9);assert.ok(Math.abs(actual.y-expected[i][1])<1e-9);});assert.throws(()=>model.mirrorStrokePoints([point],project,layer,'diagonal'),/symmetry/);
});

test('editable layer masks are validated and vector transfer cannot silently discard them',()=>{
  const project=model.empty(()=> 'layer','Mask',200,140),layer=project.layers[0];layer.mask={mode:'hide',points:[{x:20,y:20},{x:100,y:20},{x:100,y:100},{x:20,y:100}]};layer.objects.push({type:'rect',x:0,y:0,x2:200,y2:140,color:'#ff0000',width:1,fill:'#ff0000',opacity:1});assert.doesNotThrow(()=>model.validate(project));assert.match(model.svg(project),/fill-rule="evenodd"/);assert.throws(()=>model.toVector(project),/Masked layers/);layer.mask.points.pop();layer.mask.points.pop();assert.throws(()=>model.validate(project),/mask/i);
});
