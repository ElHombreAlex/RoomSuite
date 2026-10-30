'use strict';
const { test }=require('node:test');
const assert=require('node:assert/strict');
const Paint=require('../PaintRoom/model');
const T=require('../cliproom/public/timeline');
const WebM=require('../cliproom/public/webm-duration');
const crypto=require('node:crypto');

test('PaintRoom keeps fill-only shapes outline-free in SVG and editable VectorRoom transfer',()=>{
  const state=Paint.empty(()=>crypto.randomUUID(),'Artwork',1000,700);
  state.layers[0].objects.push({type:'ellipse',x:100,y:100,x2:300,y2:200,opacity:1,color:'#765ee8',width:8,fill:'#a89472',stroke:false});
  assert.match(Paint.svg(state),/stroke="none"/);
  const vector=Paint.toVector(state);assert.equal(vector.format,'vectorroom');assert.equal(vector.objects.length,2);
  const shape=vector.objects[1];assert.equal(shape.fill,'#a89472');assert.equal(shape.strokeWidth,0);assert.equal(shape.points.length,4);assert.equal(shape.closed,true);
  state.layers[0].objects[0].opacity=.4;assert.equal(Paint.toVector(state).objects[1].opacity,.4);
  state.layers[0].objects[0].stroke=true;assert.match(Paint.svg(state),/stroke="#765ee8"/);assert.throws(()=>Paint.toVector(state),/translucent object/);
  state.layers[0].opacity=.5;assert.throws(()=>Paint.toVector(state),/opaque layers/);
});
test('adjacent fractional frame clips cover every frame without changing the intended duration',()=>{
  const clips=Array.from({length:120},(_,i)=>({start:i/12,in:0,out:(i+1)/12-i/12,rate:1}));
  assert.ok(Math.abs(T.end(clips.at(-1))-10)<1e-12);
  for(let i=0;i<300;i++)assert.ok(clips.some(c=>T.active(c,i/30)),'missing frame '+i);
  assert.equal(T.active(clips.at(-1),10),false);
});
test('streaming WebM duration is inserted without changing media bytes',async()=>{
  const input=Buffer.from('1a45dfa3801853806701ffffffffffffff1549a966872ad7b1830f42401f43b67501ffffffffffffff','hex');
  const result=Buffer.from(await (await WebM.withDuration(new Blob([input],{type:'video/webm'}),2.5)).arrayBuffer());
  const marker=result.indexOf(Buffer.from('448988','hex'));assert.ok(marker>0);assert.equal(result.readDoubleBE(marker+3),2500);assert.equal(result[21],0x92);
  assert.deepEqual(result.subarray(marker+11),input.subarray(marker));
  const again=Buffer.from(await (await WebM.withDuration(new Blob([result],{type:'video/webm'}),3)).arrayBuffer());assert.equal(again.length,result.length);assert.equal(again.readDoubleBE(marker+3),3000);
  const seek=Buffer.from('1a45dfa3801853806701ffffffffffffff114d9b74801549a966872ad7b1830f42401f43b67501ffffffffffffff','hex');
  await assert.rejects(WebM.withDuration(new Blob([seek],{type:'video/webm'}),1),/seek offsets/);
});
