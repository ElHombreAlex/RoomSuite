'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const Paint=require('../PaintRoom/model.js');

test('legacy object IDs are deterministic, unique, and preserved in clones',()=>{
  const project=Paint.empty(()=> 'layer','Legacy',100,100),base={type:'rect',x:10,y:10,x2:30,y2:30,color:'#000000',width:2,opacity:1,fill:'#ff0000',stroke:false};
  project.layers[0].objects=[{...base},{...base,id:'legacy-0-0'}];Paint.validate(project);
  const first=Paint.ensureIds(structuredClone(project)),second=Paint.ensureIds(structuredClone(project));
  assert.deepEqual(first,second);assert.equal(first.layers[0].objects[0].id,'legacy-0-0-1');assert.equal(first.layers[0].objects[1].id,'legacy-0-0');
  const copy=structuredClone(first);copy.name='Frame two';assert.deepEqual(copy.layers[0].objects.map(o=>o.id),first.layers[0].objects.map(o=>o.id));
  copy.layers[0].objects[1].id=copy.layers[0].objects[0].id;assert.throws(()=>Paint.validate(copy),/unique/);
});
test('Bézier paths and layer pivots agree in editable VectorRoom and SVG output',()=>{
  const project=Paint.empty(()=> 'layer','Curve',100,100);project.background=null;const layer=project.layers[0];layer.pivotX=25;layer.pivotY=25;layer.rotation=90;layer.objects.push({id:'jaw',name:'Jaw',type:'path',points:[{x:25,y:25,inX:25,inY:25,outX:30,outY:25},{x:50,y:25,inX:45,inY:25,outX:50,outY:25}],closed:false,opacity:1,color:'#123456',width:2,fill:null,stroke:true});
  Paint.validate(project);const svg=Paint.svg(project);assert.match(svg,/translate\(25 25\) rotate\(90\)/);assert.match(svg,/C30 25 45 25 50 25/);
  const vector=Paint.toVector(project).objects[0];assert.equal(vector.type,'path');assert.equal(vector.points.length,2);assert.ok(Math.abs(vector.points[1].x-325)<1e-8);assert.ok(Math.abs(vector.points[1].y-350)<1e-8);
  layer.objects[0].points[0].inX=Infinity;assert.throws(()=>Paint.validate(project),/Bézier/);
});
